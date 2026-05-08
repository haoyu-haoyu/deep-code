#!/usr/bin/env bun
/**
 * Perf baseline runner — Phase 0 of TODO.md.
 *
 * Run via:  npm run perf:baseline --workspace @deepcode-ai/deep-code
 *           (or: bun scripts/perf-baseline.mjs)
 *
 * Measures the metrics we can collect without an interactive terminal:
 *   - cold_start_version_ms : `node deepcode.js version` end-to-end
 *   - resume_load_1k_msgs_ms : direct loadTranscriptFile() against fixture
 *
 * Each metric is run N=3 times. We report min / median / max so a noisy
 * single sample doesn't fool the comparison. Variance > 10% warns.
 *
 * Interactive metrics (keystroke→paint, scroll FPS, bash first chunk)
 * still need a real pty session — they appear in the report as TODO
 * placeholders and will be filled by Tier S/A tasks that gain matching
 * instrumentation hooks.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(packageRoot, 'test', 'fixtures')
const fixturePath = join(fixtureDir, 'large-session-1k-msgs.jsonl')
const args = parseArgs(process.argv.slice(2))
const repeatsArg = args.repeats ?? '3'
const repeats = Number(repeatsArg)
if (!Number.isInteger(repeats) || repeats < 1) {
  console.error(
    `--repeats must be a positive integer (got ${JSON.stringify(repeatsArg)})`,
  )
  process.exit(2)
}
const writeJson = args.json
const verbose = args.verbose === '1' || args.verbose === 'true'

// Hard ceiling for any single child-process probe. If a probe wedges
// (e.g. version command stuck on a TLS handshake against a fake API
// key), the timeout kills it so safeMeasure() can downgrade the
// metric to an error placeholder instead of stalling the entire
// baseline run forever. 60s leaves headroom for 10x current cold-start
// while still bounding catastrophic failure modes. Declared up here
// (not next to runNode) so module top-level await safeMeasure() calls
// don't trip a TDZ when runNode reads it before the const initializes.
const NODE_PROBE_TIMEOUT_MS = 60_000

if (!existsSync(fixturePath)) {
  log(`Fixture missing — generating at ${fixturePath}`)
  await runNode(['scripts/perf/generate-fixture.mjs', '--count=1000'])
}

const results = []

results.push(await safeMeasure('cold_start_version_ms', repeats, async () => {
  const t0 = performance.now()
  await runNode(['deepcode.js', 'version'], { stdoutTo: 'ignore' })
  return performance.now() - t0
}))

results.push(await safeMeasure('cold_start_status_ms', repeats, async () => {
  const t0 = performance.now()
  await runNode(['deepcode.js', 'status'], {
    stdoutTo: 'ignore',
    extraEnv: {
      DEEPSEEK_API_KEY: 'sk-perf-noop',
      // status hits a few network probes (cache-stats / GrowthBook); on
      // offline machines we want the metric to FAIL CLEANLY (recorded as
      // an error placeholder) rather than abort the whole baseline.
      DEEPCODE_OFFLINE: '1',
    },
  })
  return performance.now() - t0
}))

results.push(
  await safeMeasure('jsonl_tail_100_msgs_ms', repeats, async () => {
    // S4 streaming-resume metric: time to extract just the last 100
    // records from a 1k-msg JSONL file by reading from the end. This
    // is what session resume needs to render a first paint quickly.
    // Upper-bound is whatever loadTranscriptFile takes (currently
    // dominated by parseJSONL + chain reconstruction); the streaming
    // path should be much smaller.
    const { parseJsonlTail } = await import(
      `${packageRoot}/src/utils/streamingJsonl.mjs`
    )
    const t0 = performance.now()
    const tail = await parseJsonlTail(fixturePath, 100)
    const elapsed = performance.now() - t0
    if (tail.length !== 100) {
      throw new Error(`expected 100 tail records, got ${tail.length}`)
    }
    return elapsed
  }),
)

results.push(
  await safeMeasure('jsonl_parse_1k_msgs_ms', repeats, async () => {
    // Mirror the production parseJSONL fallback in src/utils/json.ts. Bun
    // 1.2.x doesn't ship Bun.JSONL.parseChunk in the public API yet, so
    // the production code path falls back to indexOf-based scanning over
    // a Buffer. We measure that same path so optimizing parseJSONL later
    // shows up here without code drift.
    //
    // Read AND wrap in Buffer outside the timed section — production
    // parseJSONLBuffer() receives the readFile() output directly, so
    // including the Uint8Array→Buffer copy here would inflate the metric
    // versus the real call path.
    const bytes = await Bun.file(fixturePath).bytes()
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const t0 = performance.now()
    const count = parseJsonlBufferReference(buf)
    const elapsed = performance.now() - t0
    if (count === 0) {
      throw new Error(`Parsed 0 entries from fixture — regenerate via npm run perf:fixture`)
    }
    return elapsed
  }),
)

results.push(placeholder('keystroke_to_paint_p50_ms', 'pending — needs pty'))
results.push(placeholder('keystroke_to_paint_p99_ms', 'pending — needs pty'))
results.push(placeholder('scroll_1k_fps', 'pending — needs pty'))
results.push(placeholder('bash_first_chunk_ms', 'pending — needs Tier S1 instrumentation'))

printReport(results)

if (writeJson) {
  const out = {
    runAt: new Date().toISOString(),
    repeats,
    metrics: results,
  }
  const path = resolve(writeJson)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(out, null, 2))
  log(`JSON report → ${path}`)
}

const noisy = results.filter(
  r => r.kind === 'measured' && r.coefficientOfVariation > 0.1,
)
if (noisy.length > 0) {
  log(
    `WARN: ${noisy.length} metric(s) have CV > 10% — re-run on a quieter machine ` +
      `or accept the higher variance. Noisy: ${noisy.map(r => r.label).join(', ')}`,
  )
}

/**
 * Wrap measure() in try/catch so a single broken probe (e.g., offline
 * environment failing the cold-start commands) records an error
 * placeholder instead of aborting the whole baseline. The caller still
 * gets every other metric measured.
 */
async function safeMeasure(label, n, fn) {
  try {
    return await measure(label, n, fn)
  } catch (error) {
    return {
      kind: 'error',
      label,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function measure(label, n, fn) {
  // Warm-up run absorbs filesystem cache + module-resolution effects so
  // subsequent samples reflect steady-state cost. Discarded.
  if (verbose) log(`  ${label} warmup`)
  await fn()
  const samples = []
  for (let i = 0; i < n; i++) {
    if (verbose) log(`  ${label} run ${i + 1}/${n}`)
    samples.push(await fn())
  }
  const sorted = [...samples].sort((a, b) => a - b)
  // Proper median: average the two middle samples for even N. Previously
  // sorted[Math.floor(n/2)] returned the UPPER middle for even N, biasing
  // the reported number high.
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length
  const variance =
    samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
  const stddev = Math.sqrt(variance)
  return {
    kind: 'measured',
    label,
    samples,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    mean,
    stddev,
    coefficientOfVariation: mean > 0 ? stddev / mean : 0,
  }
}

function placeholder(label, note) {
  return { kind: 'placeholder', label, note }
}

/**
 * Mirrors the production `parseJSONLBuffer` fallback in
 * src/utils/json.ts:182 for the Bun-without-JSONL case. Counts entries
 * via indexOf scan + JSON.parse over the line range. Kept inline (rather
 * than imported from src/utils/json.ts) because importing src/* paths
 * requires the same path-resolution machinery the build uses, which is
 * more fragile than re-implementing 12 lines.
 */
function parseJsonlBufferReference(buf) {
  let count = 0
  // Skip a UTF-8 BOM if present — production parseJSONL routes through
  // stripBOM() which removes it. Without this, the first JSON.parse()
  // call would fail on the EF BB BF prefix.
  let start =
    buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      ? 3
      : 0
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start)
    const end = nl === -1 ? buf.length : nl
    if (end > start) {
      const slice = buf.subarray(start, end)
      // Skip blank/whitespace-only lines without allocating a string.
      let onlyWs = true
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i]
        if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0d) {
          onlyWs = false
          break
        }
      }
      if (!onlyWs) {
        JSON.parse(slice.toString('utf8'))
        count++
      }
    }
    if (nl === -1) break
    start = nl + 1
  }
  return count
}

function printReport(rows) {
  log('\n=== DeepCode perf baseline ===')
  log(`Date: ${new Date().toISOString()}`)
  log(`Repeats per metric: ${repeats}`)
  log(`Fixture: ${fixturePath}\n`)
  const header = ['metric', 'min', 'median', 'max', 'cv%']
  const widths = header.map(h => h.length)
  const lines = [header]
  for (const r of rows) {
    if (r.kind === 'measured') {
      lines.push([
        r.label,
        r.min.toFixed(1),
        r.median.toFixed(1),
        r.max.toFixed(1),
        (r.coefficientOfVariation * 100).toFixed(1),
      ])
    } else if (r.kind === 'error') {
      lines.push([r.label, '-', '-', '-', `error: ${r.reason}`])
    } else {
      lines.push([r.label, '-', '-', '-', r.note])
    }
  }
  for (const line of lines) {
    line.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], String(cell).length)
    })
  }
  for (const [rowIdx, line] of lines.entries()) {
    log(line.map((cell, i) => String(cell).padEnd(widths[i] + 2)).join(''))
    if (rowIdx === 0) log(widths.map(w => '-'.repeat(w)).join('  '))
  }
  log('')
}

function runNode(argv, opts = {}) {
  return new Promise((resolveCmd, reject) => {
    const child = spawn('node', argv, {
      cwd: packageRoot,
      env: { ...process.env, ...(opts.extraEnv ?? {}) },
      stdio: [
        'ignore',
        opts.stdoutTo === 'ignore' ? 'ignore' : 'inherit',
        opts.stderrTo === 'ignore' ? 'ignore' : 'inherit',
      ],
    })
    let settled = false
    const timeoutMs = opts.timeoutMs ?? NODE_PROBE_TIMEOUT_MS
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new Error(
          `node ${argv.join(' ')} did not exit within ${timeoutMs}ms — killed`,
        ),
      )
    }, timeoutMs)
    timer.unref?.()
    child.on('exit', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolveCmd()
      else reject(new Error(`node ${argv.join(' ')} exited ${code}`))
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
  })
}

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (!m) continue
    out[m[1]] = m[2] ?? '1'
  }
  return out
}

function log(msg) {
  process.stdout.write(`${msg}\n`)
}
