import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compareScript = join(packageRoot, 'scripts', 'perf-compare.mjs')

async function runCompare(argv) {
  return await new Promise((resolveProc, rejectProc) => {
    const child = spawn('node', [compareScript, ...argv], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => (stdout += c.toString()))
    child.stderr.on('data', c => (stderr += c.toString()))
    child.on('exit', code => resolveProc({ code, stdout, stderr }))
    child.on('error', rejectProc)
  })
}

async function writeReport(metrics) {
  const dir = await mkdtemp(join(tmpdir(), 'perf-compare-'))
  const path = join(dir, 'report.json')
  writeFileSync(
    path,
    JSON.stringify({ runAt: new Date().toISOString(), repeats: 3, metrics }),
  )
  return path
}

function measured(label, median) {
  return {
    kind: 'measured',
    label,
    samples: [median - 0.1, median, median + 0.1],
    min: median - 0.1,
    median,
    max: median + 0.1,
    mean: median,
    stddev: 0.1,
    coefficientOfVariation: 0.05,
  }
}

function placeholder(label) {
  return { kind: 'placeholder', label, note: 'pending' }
}

function errored(label, reason = 'probe failed') {
  return { kind: 'error', label, reason }
}

test('perf-compare exits 0 when metrics are unchanged', async () => {
  const base = await writeReport([measured('m1', 100), measured('m2', 50)])
  const head = await writeReport([measured('m1', 100), measured('m2', 50)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /m1[\s\S]*ok/)
})

test('perf-compare exits 1 on a regression beyond threshold', async () => {
  // 100ms → 130ms = +30%, exceeds default 20% threshold.
  const base = await writeReport([measured('cold_start_status_ms', 100)])
  const head = await writeReport([measured('cold_start_status_ms', 130)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 1, `expected exit 1, got ${result.code}`)
  assert.match(result.stderr, /1 metric\(s\) regressed/)
  assert.match(result.stdout, /cold_start_status_ms[\s\S]*regressed/)
})

test('perf-compare exits 0 on a regression UNDER the noise floor', async () => {
  // 1.0ms → 2.5ms = +150% but the absolute delta (1.5ms) is below
  // the 2ms noise floor for sub-5ms metrics — no false alarm on
  // microsecond-scale jitter.
  const base = await writeReport([measured('jsonl_tail_100_msgs_ms', 1.0)])
  const head = await writeReport([measured('jsonl_tail_100_msgs_ms', 2.5)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0, `noise-floor metric must not fail CI`)
})

test('perf-compare reports improvements without failing', async () => {
  const base = await writeReport([measured('cold_start_status_ms', 100)])
  const head = await writeReport([measured('cold_start_status_ms', 70)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /improved/)
})

test('perf-compare honours --threshold override', async () => {
  // 100 → 105 = +5%. Default threshold (20%) → ok. Override to 4% → regression.
  const base = await writeReport([measured('cold_start_status_ms', 100)])
  const head = await writeReport([measured('cold_start_status_ms', 105)])
  const lenient = await runCompare([
    `--base=${base}`,
    `--head=${head}`,
    `--threshold=0.20`,
  ])
  assert.equal(lenient.code, 0)
  const strict = await runCompare([
    `--base=${base}`,
    `--head=${head}`,
    `--threshold=0.04`,
  ])
  assert.equal(strict.code, 1, 'tighter threshold should catch the regression')
})

test('perf-compare ignores placeholder vs measured transitions', async () => {
  const base = await writeReport([placeholder('keystroke_to_paint_p99_ms')])
  const head = await writeReport([measured('keystroke_to_paint_p99_ms', 25)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0, 'placeholder→measured is not a regression')
  assert.match(result.stdout, /placeholder/)
})

test('perf-compare reports new and dropped metrics', async () => {
  const base = await writeReport([measured('only_in_base', 10)])
  const head = await writeReport([measured('only_in_head', 10)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /New metrics.*only_in_head/)
  assert.match(result.stdout, /Dropped metrics.*only_in_base/)
})

test('perf-compare writes a JSON diff when --json is passed', async () => {
  const base = await writeReport([measured('m1', 100)])
  const head = await writeReport([measured('m1', 110)])
  const dir = await mkdtemp(join(tmpdir(), 'perf-diff-'))
  const diffPath = join(dir, 'diff.json')
  const result = await runCompare([
    `--base=${base}`,
    `--head=${head}`,
    `--json=${diffPath}`,
  ])
  assert.equal(result.code, 0) // 10% delta, under 20% default
  const diff = JSON.parse(readFileSync(diffPath, 'utf8'))
  assert.equal(diff.threshold, 0.2)
  assert.equal(diff.rows.length, 1)
  assert.equal(diff.rows[0].label, 'm1')
  assert.equal(diff.rows[0].deltaMs, 10)
})

test('perf-compare exits 2 with usage error on missing args', async () => {
  const result = await runCompare([])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Usage:/)
})

test('perf-compare exits 2 on invalid --threshold', async () => {
  const base = await writeReport([measured('m1', 1)])
  const head = await writeReport([measured('m1', 1)])
  const result = await runCompare([
    `--base=${base}`,
    `--head=${head}`,
    `--threshold=2.0`,
  ])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /threshold must be in/)
})

test('perf-compare exit 1 when measured metric becomes error in head', async () => {
  // Codex flagged: a previously measured metric becoming an error
  // (probe broke) silently passed. Now treated as a regression so a
  // broken probe blocks the merge.
  const base = await writeReport([measured('cold_start_status_ms', 100)])
  const head = await writeReport([
    errored('cold_start_status_ms', 'spawn ENOENT'),
  ])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 1, 'measured→error must fail CI')
  assert.match(result.stderr, /became error in head/)
  assert.match(result.stdout, /probe-broken/)
})

test('perf-compare exit 0 when error metric becomes measured (probe fixed)', async () => {
  const base = await writeReport([
    errored('cold_start_status_ms', 'previous probe broken'),
  ])
  const head = await writeReport([measured('cold_start_status_ms', 100)])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0, 'probe getting fixed must not fail CI')
  assert.match(result.stdout, /probe-fixed/)
})

test('perf-compare exit 0 when both sides have an error (still-broken probe)', async () => {
  const base = await writeReport([errored('m1', 'broken')])
  const head = await writeReport([errored('m1', 'broken')])
  const result = await runCompare([`--base=${base}`, `--head=${head}`])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /still-error/)
})

test('perf-compare classifies placeholder ↔ error as placeholder (not probe-fixed)', async () => {
  // Codex caught: placeholder→error and error→placeholder were
  // misclassified as `probe-fixed` because the error branch ran
  // before the placeholder fallback. Neither is a real probe-state
  // change worth flagging — they're just "intentional TODO meets
  // unrelated error in the other report".
  for (const [b, h] of [
    [placeholder('m1'), errored('m1')],
    [errored('m1'), placeholder('m1')],
  ]) {
    const base = await writeReport([b])
    const head = await writeReport([h])
    const result = await runCompare([`--base=${base}`, `--head=${head}`])
    assert.equal(result.code, 0)
    assert.match(
      result.stdout,
      /placeholder/,
      `placeholder ↔ error must report 'placeholder', not 'probe-fixed' ` +
        `(base=${b.kind}, head=${h.kind})`,
    )
    assert.doesNotMatch(
      result.stdout,
      /\bprobe-fixed\b/,
      `placeholder ↔ error must NOT print probe-fixed`,
    )
  }
})

test('perf-compare exits 2 on a malformed report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perf-bad-'))
  const badPath = join(dir, 'bad.json')
  writeFileSync(badPath, '{ not json')
  const result = await runCompare([`--base=${badPath}`, `--head=${badPath}`])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Failed to read/)
})
