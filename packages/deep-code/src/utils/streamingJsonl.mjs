/**
 * Streaming JSONL helpers for tail-first / reverse parsing.
 *
 * The use case is session resume: a 1k-message transcript file (≈1.2 MB)
 * is read in full by loadTranscriptFile() before the UI can render
 * anything, blocking the first paint by 100-300 ms even though the user
 * only needs the most-recent few dozen messages on screen. These helpers
 * parse from the END of the file backward in fixed-size chunks, yielding
 * complete JSONL records as soon as enough bytes accumulate to span them.
 *
 * Pure JS / no `src/*` imports so this module is loadable directly by
 * `node --test` without the Bun-build harness.
 */

import { open } from 'node:fs/promises'

const DEFAULT_CHUNK_SIZE = 64 * 1024 // 64 KB
const NEWLINE = 0x0a // '\n'

// Hard cap on the carry-forward buffer to prevent OOM on pathological
// single-line files (e.g. a 1 GB minified JSON dump emitted as a
// single record). Matches the 100 MB ceiling already used by the
// synchronous parseJSONL path in src/utils/json.ts so the streaming
// helper isn't stricter or more permissive than its synchronous twin.
// Throws when exceeded so the caller knows their file is malformed.
const DEFAULT_MAX_BUFFERED_BYTES = 100 * 1024 * 1024 // 100 MB

// UTF-8 BOM bytes — stripped from the FORWARD-most record so callers
// don't get a parse-error sentinel on a BOM-prefixed file. The
// synchronous parseJSONL has the same handling.
const UTF8_BOM_0 = 0xef
const UTF8_BOM_1 = 0xbb
const UTF8_BOM_2 = 0xbf

/**
 * Yields parsed JSONL entries in REVERSE order (last record first) by
 * reading the file backward in fixed-size chunks. Splits at LF
 * boundaries; carries an unparsed prefix forward across chunk reads
 * so multi-chunk records aren't dropped. Skips blank lines silently.
 *
 * Entries that don't parse as JSON are yielded as
 * `{ __jsonlParseError: true, raw, error }` rather than thrown — the
 * caller decides whether to keep going or abort. Mirrors what the
 * synchronous parseJSONL upstream does (skip + log).
 */
export async function* parseJsonlReverse(path, options = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new TypeError('chunkSize must be a positive integer')
  }
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
  if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new TypeError('maxBufferedBytes must be a positive integer')
  }

  const fh = await open(path, 'r')
  try {
    const size = (await fh.stat()).size
    if (size === 0) return

    let position = size
    // `tail` is bytes accumulated at the END of the file that haven't
    // yet been flushed as records — kept as a Buffer so multi-byte
    // UTF-8 sequences split across chunk boundaries aren't corrupted.
    let tail = Buffer.alloc(0)
    const buffer = Buffer.alloc(chunkSize)

    while (position > 0) {
      const readSize = Math.min(chunkSize, position)
      const readPosition = position - readSize

      let totalRead = 0
      while (totalRead < readSize) {
        const { bytesRead } = await fh.read(
          buffer,
          totalRead,
          readSize - totalRead,
          readPosition + totalRead,
        )
        if (bytesRead === 0) break
        totalRead += bytesRead
      }
      if (totalRead === 0) break

      // After the inner retry loop, we have `totalRead` bytes from
      // [readPosition, readPosition+totalRead). The next backward
      // iteration must read what comes BEFORE that range — i.e.,
      // start at `readPosition`. Setting position to anything else
      // would either overlap (re-read bytes we already have) or
      // skip unread bytes between readPosition+totalRead and the
      // previous position. On short reads the buffer's tail bytes
      // (totalRead..readSize) may be garbage but we slice to
      // totalRead before concat so they're never observed.
      position = readPosition

      // Combine the freshly-read chunk with any tail carried from the
      // previous iteration. Records may span the boundary; we'll yield
      // every complete record we can find from the END going backward.
      const combined = Buffer.concat([
        buffer.subarray(0, totalRead),
        tail,
      ])

      // If we're not at the start of the file, the FIRST partial record
      // (everything before the first LF) might be incomplete — stash it
      // back into `tail` for the next iteration. At position === 0 we
      // know the whole file is in `combined` so emit everything.
      const firstNewlineIdx = combined.indexOf(NEWLINE)
      // EXPLICIT no-newline case: when we haven't reached the start of
      // the file AND the combined window contains no LF yet, the
      // entire window is one in-flight record; stash it and read
      // more. Falling through to `headStart = -1 + 1 = 0` would
      // incorrectly emit the partial fragment as a parse error.
      if (position > 0 && firstNewlineIdx < 0) {
        if (combined.length > maxBufferedBytes) {
          throw new Error(
            `parseJsonlReverse: single record exceeds maxBufferedBytes ` +
              `(${combined.length} > ${maxBufferedBytes}) — file may be malformed`,
          )
        }
        tail = combined
        continue
      }
      const headStart = position === 0 ? 0 : firstNewlineIdx + 1
      // Carry the un-emittable prefix forward.
      tail = position === 0 ? Buffer.alloc(0) : combined.subarray(0, headStart)
      if (tail.length > maxBufferedBytes) {
        throw new Error(
          `parseJsonlReverse: carry-forward buffer exceeds maxBufferedBytes ` +
            `(${tail.length} > ${maxBufferedBytes}) — file may be malformed`,
        )
      }

      // Walk the emit window from end → start, yielding lines.
      let end = combined.length
      while (end > headStart) {
        // Strip a trailing CR for CRLF terminators.
        let lineEnd = end
        if (combined[lineEnd - 1] === NEWLINE) {
          lineEnd--
          if (lineEnd > headStart && combined[lineEnd - 1] === 0x0d) {
            lineEnd--
          }
        }
        const lineStart = lastIndexOfByte(combined, NEWLINE, lineEnd - 1, headStart)
        let start = lineStart >= 0 ? lineStart + 1 : headStart
        // Strip UTF-8 BOM from the very first record of the file
        // (which appears LAST in the reverse stream because we walk
        // backward). Mirrors the synchronous parseJSONL behavior so
        // BOM-prefixed files don't yield a parse-error sentinel for
        // their first line.
        if (
          position === 0 &&
          start === 0 &&
          combined.length - start >= 3 &&
          combined[0] === UTF8_BOM_0 &&
          combined[1] === UTF8_BOM_1 &&
          combined[2] === UTF8_BOM_2
        ) {
          start = 3
        }
        if (start < lineEnd) {
          const slice = combined.subarray(start, lineEnd)
          // Skip whitespace-only lines without allocating a full string.
          if (!isWhitespaceOnly(slice)) {
            const text = slice.toString('utf8')
            try {
              yield JSON.parse(text)
            } catch (error) {
              yield {
                __jsonlParseError: true,
                raw: text,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }
        }
        end = start
        if (lineStart < 0) break
      }
    }
  } finally {
    await fh.close()
  }
}

/**
 * Read the last `count` JSONL records from a file. Convenience wrapper
 * around parseJsonlReverse — collects entries in REVERSE order, then
 * returns them in FORWARD order (oldest of the tail window first) so
 * callers can append them in display order without an extra reverse.
 */
export async function parseJsonlTail(path, count, options = {}) {
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError('count must be a non-negative integer')
  }
  if (count === 0) return []
  const collected = []
  for await (const entry of parseJsonlReverse(path, options)) {
    collected.push(entry)
    if (collected.length >= count) break
  }
  return collected.reverse()
}

function lastIndexOfByte(buffer, byte, fromIndex, minIndex) {
  for (let i = fromIndex; i >= minIndex; i--) {
    if (buffer[i] === byte) return i
  }
  return -1
}

function isWhitespaceOnly(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]
    // SP, HT, LF, CR
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return false
  }
  return true
}
