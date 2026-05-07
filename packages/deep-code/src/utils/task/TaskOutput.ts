import { unlink } from 'fs/promises'
import { CircularBuffer } from '../CircularBuffer.js'
import { readBranchedEnvInt } from '../branchedEnv.mjs'
import { logForDebugging } from '../debug.js'
import { readFileRange, tailFile } from '../fsOperations.js'
import { getMaxOutputLength } from '../shell/outputLimits.js'
import { safeJoinLines } from '../stringUtils.js'
import { DiskTaskOutput, getTaskOutputPath } from './diskOutput.js'

const DEFAULT_MAX_MEMORY = 8 * 1024 * 1024 // 8MB
// Bash output polling cadence. Default 200ms (5 Hz) is the sweet spot for
// "feels like real-time" stdout streaming on long commands while keeping
// per-tick CPU well under 1% on typical hardware. Tunable via env for
// users who want the upstream 1Hz behavior back or who want to push the
// rate higher on dev workstations.
const POLL_INTERVAL_ACTIVE_MS = readBranchedEnvInt(
  ['DEEPCODE_BASH_POLL_INTERVAL_MS', 'CLAUDE_CODE_BASH_POLL_INTERVAL_MS'],
  200,
)
// After this many consecutive ticks with no new output bytes, the
// per-task adaptive backoff kicks in: skip every other tick to save CPU
// on commands that hang on I/O for long periods (e.g. interactive
// prompts waiting for input, network-blocked git fetch). Effective rate
// becomes ~POLL_INTERVAL_ACTIVE_MS * 2.
const IDLE_TICK_SKIP_THRESHOLD = readBranchedEnvInt(
  [
    'DEEPCODE_BASH_POLL_IDLE_THRESHOLD',
    'CLAUDE_CODE_BASH_POLL_IDLE_THRESHOLD',
  ],
  5,
)
const PROGRESS_TAIL_BYTES = 4096

type ProgressCallback = (
  lastLines: string,
  allLines: string,
  totalLines: number,
  totalBytes: number,
  isIncomplete: boolean,
) => void

/**
 * Single source of truth for a shell command's output.
 *
 * For bash commands (file mode): both stdout and stderr go directly to
 * a file via stdio fds — neither enters JS. Progress is extracted by
 * polling the file tail. getStderr() returns '' since stderr is
 * interleaved in the output file.
 *
 * For hooks (pipe mode): data flows through writeStdout()/writeStderr()
 * and is buffered in memory, spilling to disk if it exceeds the limit.
 */
export class TaskOutput {
  readonly taskId: string
  readonly path: string
  /** True when stdout goes to a file fd (bypassing JS). False for pipe mode (hooks). */
  readonly stdoutToFile: boolean
  #stdoutBuffer = ''
  #stderrBuffer = ''
  #disk: DiskTaskOutput | null = null
  #recentLines = new CircularBuffer<string>(1000)
  #totalLines = 0
  #totalBytes = 0
  #maxMemory: number
  #onProgress: ProgressCallback | null
  /** Set by getStdout() — true when the file was fully read (≤ maxOutputLength). */
  #outputFileRedundant = false
  /** Set by getStdout() — total file size in bytes. */
  #outputFileSize = 0
  /**
   * Per-instance counters for adaptive polling backoff.
   * #consecutiveEmptyTicks counts ticks during which the output file
   * grew by 0 bytes; once it crosses IDLE_TICK_SKIP_THRESHOLD, the
   * shared poller skips every other tick for this entry. Reset to 0
   * the moment new bytes arrive. #pollSkipParity flips on each tick
   * so the skip pattern is deterministic across multiple idle tasks.
   */
  #consecutiveEmptyTicks = 0
  #pollSkipParity = 0
  /** Last observed total bytes — used to detect zero-growth ticks. */
  #lastSeenBytesTotal = 0
  /**
   * Generation counter incremented each time we issue a new tailFile
   * read AND each time startPolling resets adaptive state. The async
   * .then() callback captures the generation that was current when the
   * read fired; if the entry's generation has advanced (because a
   * later tick fired or polling was restarted), the callback is stale
   * and must NOT mutate the adaptive bookkeeping — otherwise a slow
   * tailFile resolving after stopPolling/startPolling would corrupt
   * the freshly reset counters.
   */
  #pollGeneration = 0

  // --- Shared poller state ---

  /** Registry of all file-mode TaskOutput instances with onProgress callbacks. */
  static #registry = new Map<string, TaskOutput>()
  /** Subset of #registry currently being polled (visibility-driven by React). */
  static #activePolling = new Map<string, TaskOutput>()
  static #pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    taskId: string,
    onProgress: ProgressCallback | null,
    stdoutToFile = false,
    maxMemory: number = DEFAULT_MAX_MEMORY,
  ) {
    this.taskId = taskId
    this.path = getTaskOutputPath(taskId)
    this.stdoutToFile = stdoutToFile
    this.#maxMemory = maxMemory
    this.#onProgress = onProgress

    // Register for polling when stdout goes to a file and progress is needed.
    // Actual polling is started/stopped by React via startPolling/stopPolling.
    if (stdoutToFile && onProgress) {
      TaskOutput.#registry.set(taskId, this)
    }
  }

  /**
   * Begin polling the output file for progress. Called from React
   * useEffect when the progress component mounts.
   */
  static startPolling(taskId: string): void {
    const instance = TaskOutput.#registry.get(taskId)
    if (!instance || !instance.#onProgress) {
      return
    }
    // Reset adaptive counters so a re-started poller doesn't inherit
    // stale idle state and immediately back off. Bumping the generation
    // also invalidates any in-flight tailFile reads from a previous
    // polling session — their .then() callbacks will see a mismatched
    // generation and skip their bookkeeping mutations.
    instance.#consecutiveEmptyTicks = 0
    instance.#pollSkipParity = 0
    instance.#lastSeenBytesTotal = 0
    instance.#pollGeneration++
    TaskOutput.#activePolling.set(taskId, instance)
    if (!TaskOutput.#pollInterval) {
      TaskOutput.#pollInterval = setInterval(
        TaskOutput.#tick,
        POLL_INTERVAL_ACTIVE_MS,
      )
      TaskOutput.#pollInterval.unref()
    }
  }

  /**
   * Stop polling the output file. Called from React useEffect cleanup
   * when the progress component unmounts.
   *
   * Bumps the generation BEFORE removing the entry so any tailFile
   * read still in flight at unmount time will see a stale generation
   * when it resolves and skip both the bookkeeping update AND the
   * onProgress callback. Otherwise a late callback could emit one
   * progress update after React thought polling had stopped.
   */
  static stopPolling(taskId: string): void {
    const instance = TaskOutput.#registry.get(taskId)
    if (instance) {
      instance.#pollGeneration++
    }
    TaskOutput.#activePolling.delete(taskId)
    if (TaskOutput.#activePolling.size === 0 && TaskOutput.#pollInterval) {
      clearInterval(TaskOutput.#pollInterval)
      TaskOutput.#pollInterval = null
    }
  }

  /**
   * Shared tick: reads the file tail for every actively-polled task.
   * Non-async body (.then) to avoid stacking if I/O is slow.
   *
   * Adaptive backoff: an entry that has seen no new output bytes for
   * IDLE_TICK_SKIP_THRESHOLD ticks gets polled every other tick instead
   * of every tick. This keeps the active-stream rate at ~5Hz while
   * dropping idle commands (waiting on user input, blocked I/O, etc.)
   * to ~2.5Hz for negligible CPU cost. As soon as bytes arrive again,
   * the counter resets and full-rate polling resumes.
   */
  static #tick(): void {
    for (const [, entry] of TaskOutput.#activePolling) {
      if (!entry.#onProgress) {
        continue
      }
      // Toggle parity every tick so the skip pattern is interleaved
      // across multiple idle tasks. Without this, idle tasks would all
      // skip the same ticks, doubling the active-tick load.
      entry.#pollSkipParity ^= 1
      if (
        entry.#consecutiveEmptyTicks >= IDLE_TICK_SKIP_THRESHOLD &&
        entry.#pollSkipParity === 0
      ) {
        continue
      }
      // Bump the generation per-tick so out-of-order tailFile
      // resolutions can be detected and dropped. If two reads are in
      // flight and the older one resolves last, its bookkeeping would
      // walk #lastSeenBytesTotal backward and falsely increment
      // #consecutiveEmptyTicks. Generation also gets bumped on
      // startPolling, invalidating any leftover reads from a previous
      // polling session.
      entry.#pollGeneration++
      const gen = entry.#pollGeneration
      void tailFile(entry.path, PROGRESS_TAIL_BYTES).then(
        ({ content, bytesRead, bytesTotal }) => {
          if (!entry.#onProgress) {
            return
          }
          // Stale-callback guard: when a later tick already issued a
          // newer read, this older one MUST drop everything — not
          // just adaptive state but also #totalLines, #totalBytes,
          // and the onProgress emit. Otherwise BashTool / PowerShell
          // could see progress regress to an older snapshot after
          // overlapping polls or a stopPolling/startPolling restart.
          if (gen !== entry.#pollGeneration) {
            return
          }
          // Adaptive bookkeeping: did the file grow this tick?
          if (bytesTotal > entry.#lastSeenBytesTotal) {
            entry.#consecutiveEmptyTicks = 0
            entry.#lastSeenBytesTotal = bytesTotal
          } else {
            entry.#consecutiveEmptyTicks++
          }
          // Always call onProgress even when content is empty, so the
          // progress loop wakes up and can check for backgrounding.
          // Commands like `git log -S` produce no output for long periods.
          if (!content) {
            entry.#onProgress('', '', entry.#totalLines, bytesTotal, false)
            return
          }
          // Count all newlines in the tail and capture slice points for the
          // last 5 and last 100 lines. Uncapped so extrapolation stays accurate
          // for dense output (short lines → >100 newlines in 4KB).
          let pos = content.length
          let n5 = 0
          let n100 = 0
          let lineCount = 0
          while (pos > 0) {
            pos = content.lastIndexOf('\n', pos - 1)
            lineCount++
            if (lineCount === 5) n5 = pos <= 0 ? 0 : pos + 1
            if (lineCount === 100) n100 = pos <= 0 ? 0 : pos + 1
          }
          // lineCount is exact when the whole file fits in PROGRESS_TAIL_BYTES.
          // Otherwise extrapolate from the tail sample; monotone max keeps the
          // counter from going backwards when the tail has longer lines on one tick.
          const totalLines =
            bytesRead >= bytesTotal
              ? lineCount
              : Math.max(
                  entry.#totalLines,
                  Math.round((bytesTotal / bytesRead) * lineCount),
                )
          entry.#totalLines = totalLines
          entry.#totalBytes = bytesTotal
          entry.#onProgress(
            content.slice(n5),
            content.slice(n100),
            totalLines,
            bytesTotal,
            bytesRead < bytesTotal,
          )
        },
        () => {
          // File may not exist yet
        },
      )
    }
  }

  /** Write stdout data (pipe mode only — used by hooks). */
  writeStdout(data: string): void {
    this.#writeBuffered(data, false)
  }

  /** Write stderr data (always piped). */
  writeStderr(data: string): void {
    this.#writeBuffered(data, true)
  }

  #writeBuffered(data: string, isStderr: boolean): void {
    this.#totalBytes += data.length

    this.#updateProgress(data)

    // Write to disk if already overflowed
    if (this.#disk) {
      this.#disk.append(isStderr ? `[stderr] ${data}` : data)
      return
    }

    // Check if this chunk would exceed the in-memory limit
    const totalMem =
      this.#stdoutBuffer.length + this.#stderrBuffer.length + data.length
    if (totalMem > this.#maxMemory) {
      this.#spillToDisk(isStderr ? data : null, isStderr ? null : data)
      return
    }

    if (isStderr) {
      this.#stderrBuffer += data
    } else {
      this.#stdoutBuffer += data
    }
  }

  /**
   * Single backward pass: count all newlines (for totalLines) and extract
   * the last few lines as flat copies (for the CircularBuffer / progress).
   * Only used in pipe mode (hooks). File mode uses the shared poller.
   */
  #updateProgress(data: string): void {
    const MAX_PROGRESS_BYTES = 4096
    const MAX_PROGRESS_LINES = 100

    let lineCount = 0
    const lines: string[] = []
    let extractedBytes = 0
    let pos = data.length

    while (pos > 0) {
      const prev = data.lastIndexOf('\n', pos - 1)
      if (prev === -1) {
        break
      }
      lineCount++
      if (
        lines.length < MAX_PROGRESS_LINES &&
        extractedBytes < MAX_PROGRESS_BYTES
      ) {
        const lineLen = pos - prev - 1
        if (lineLen > 0 && lineLen <= MAX_PROGRESS_BYTES - extractedBytes) {
          const line = data.slice(prev + 1, pos)
          if (line.trim()) {
            lines.push(Buffer.from(line).toString())
            extractedBytes += lineLen
          }
        }
      }
      pos = prev
    }

    this.#totalLines += lineCount

    for (let i = lines.length - 1; i >= 0; i--) {
      this.#recentLines.add(lines[i]!)
    }

    if (this.#onProgress && lines.length > 0) {
      const recent = this.#recentLines.getRecent(5)
      this.#onProgress(
        safeJoinLines(recent, '\n'),
        safeJoinLines(this.#recentLines.getRecent(100), '\n'),
        this.#totalLines,
        this.#totalBytes,
        this.#disk !== null,
      )
    }
  }

  #spillToDisk(stderrChunk: string | null, stdoutChunk: string | null): void {
    this.#disk = new DiskTaskOutput(this.taskId)

    // Flush existing buffers
    if (this.#stdoutBuffer) {
      this.#disk.append(this.#stdoutBuffer)
      this.#stdoutBuffer = ''
    }
    if (this.#stderrBuffer) {
      this.#disk.append(`[stderr] ${this.#stderrBuffer}`)
      this.#stderrBuffer = ''
    }

    // Write the chunk that triggered overflow
    if (stdoutChunk) {
      this.#disk.append(stdoutChunk)
    }
    if (stderrChunk) {
      this.#disk.append(`[stderr] ${stderrChunk}`)
    }
  }

  /**
   * Get stdout. In file mode, reads from the output file.
   * In pipe mode, returns the in-memory buffer or tail from CircularBuffer.
   */
  async getStdout(): Promise<string> {
    if (this.stdoutToFile) {
      return this.#readStdoutFromFile()
    }
    // Pipe mode (hooks) — use in-memory data
    if (this.#disk) {
      const recent = this.#recentLines.getRecent(5)
      const tail = safeJoinLines(recent, '\n')
      const sizeKB = Math.round(this.#totalBytes / 1024)
      const notice = `\nOutput truncated (${sizeKB}KB total). Full output saved to: ${this.path}`
      return tail ? tail + notice : notice.trimStart()
    }
    return this.#stdoutBuffer
  }

  async #readStdoutFromFile(): Promise<string> {
    const maxBytes = getMaxOutputLength()
    try {
      const result = await readFileRange(this.path, 0, maxBytes)
      if (!result) {
        this.#outputFileRedundant = true
        return ''
      }
      const { content, bytesRead, bytesTotal } = result
      // If the file fits, it's fully captured inline and can be deleted.
      // If not, return what we read — processToolResultBlock handles
      // the <persisted-output> formatting and persistence downstream.
      this.#outputFileSize = bytesTotal
      this.#outputFileRedundant = bytesTotal <= bytesRead
      return content
    } catch (err) {
      // Surface the error instead of silently returning empty. An ENOENT here
      // means the output file was deleted while the command was running
      // (historically: cross-session startup cleanup in the same project dir).
      // Returning a diagnostic string keeps the tool_result non-empty, which
      // avoids reminder-only-at-tail confusion downstream and tells the model
      // (and us, via the transcript) what actually happened.
      const code =
        err instanceof Error && 'code' in err ? String(err.code) : 'unknown'
      logForDebugging(
        `TaskOutput.#readStdoutFromFile: failed to read ${this.path} (${code}): ${err}`,
      )
      return `<bash output unavailable: output file ${this.path} could not be read (${code}). This usually means another Claude Code process in the same project deleted it during startup cleanup.>`
    }
  }

  /** Sync getter for ExecResult.stderr */
  getStderr(): string {
    if (this.#disk) {
      return ''
    }
    return this.#stderrBuffer
  }

  get isOverflowed(): boolean {
    return this.#disk !== null
  }

  get totalLines(): number {
    return this.#totalLines
  }

  get totalBytes(): number {
    return this.#totalBytes
  }

  /**
   * True after getStdout() when the output file was fully read.
   * The file content is redundant (fully in ExecResult.stdout) and can be deleted.
   */
  get outputFileRedundant(): boolean {
    return this.#outputFileRedundant
  }

  /** Total file size in bytes, set after getStdout() reads the file. */
  get outputFileSize(): number {
    return this.#outputFileSize
  }

  /** Force all buffered content to disk. Call when backgrounding. */
  spillToDisk(): void {
    if (!this.#disk) {
      this.#spillToDisk(null, null)
    }
  }

  async flush(): Promise<void> {
    await this.#disk?.flush()
  }

  /** Delete the output file (fire-and-forget safe). */
  async deleteOutputFile(): Promise<void> {
    try {
      await unlink(this.path)
    } catch {
      // File may already be deleted or not exist
    }
  }

  clear(): void {
    this.#stdoutBuffer = ''
    this.#stderrBuffer = ''
    this.#recentLines.clear()
    this.#onProgress = null
    this.#disk?.cancel()
    TaskOutput.stopPolling(this.taskId)
    TaskOutput.#registry.delete(this.taskId)
  }
}
