import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(
  packageRoot,
  'test',
  'fixtures',
  'large-session-1k-msgs.jsonl',
)

test('perf fixture exists and has 2000 lines', { concurrency: false }, () => {
  assert.equal(
    existsSync(fixturePath),
    true,
    `fixture missing — run \`npm run perf:fixture\` (writes to ${fixturePath})`,
  )
  const content = readFileSync(fixturePath, 'utf8')
  const lines = content.split('\n').filter(line => line.length > 0)
  assert.equal(lines.length, 2000, 'fixture should have exactly 2000 entries')
})

test(
  'fixture lines parse as JSONL with valid Anthropic-shape entries',
  { concurrency: false },
  () => {
    const content = readFileSync(fixturePath, 'utf8')
    const lines = content.split('\n').filter(line => line.length > 0)
    let userCount = 0
    let assistantCount = 0
    for (const line of lines) {
      const entry = JSON.parse(line)
      assert.ok(
        entry.uuid,
        'every JSONL entry must have a uuid for chain reconstruction',
      )
      assert.ok(
        entry.timestamp,
        'every JSONL entry must have an ISO timestamp',
      )
      assert.ok(entry.type === 'user' || entry.type === 'assistant')
      if (entry.type === 'user') userCount++
      else assistantCount++
    }
    assert.equal(userCount, 1000)
    assert.equal(assistantCount, 1000)
  },
)

test(
  'perf:baseline script executes successfully and reports measured metrics',
  { concurrency: false, timeout: 240_000 },
  async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'deepcode-perf-'))
    const reportPath = join(tmp, 'baseline.json')
    await new Promise((resolveProc, rejectProc) => {
      const child = spawn(
        'bun',
        ['scripts/perf-baseline.mjs', `--json=${reportPath}`, '--repeats=1'],
        { cwd: packageRoot, stdio: 'pipe' },
      )
      let stderr = ''
      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
      child.on('exit', code => {
        if (code === 0) resolveProc()
        else rejectProc(new Error(`bun exited ${code}\nstderr:\n${stderr}`))
      })
      child.on('error', rejectProc)
    })
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.ok(Array.isArray(report.metrics))

    // Assert each expected metric appears, regardless of measured/error/
    // placeholder kind. This catches accidentally dropped probes (e.g.
    // someone deletes the cold_start_status_ms block) which `>= 2` would
    // hide. Network-restricted CI may report `error` for cold-start
    // metrics; the jsonl parse metric must be `measured` everywhere.
    const expectedLabels = [
      'deepcode_cold_start_version_ms',
      'deepcode_cold_start_status_ms',
      'deepcode_jsonl_tail_100_msgs_ms',
      'deepcode_jsonl_parse_1k_msgs_ms',
      'deepcode_keystroke_to_paint_p50_ms',
      'deepcode_keystroke_to_paint_p99_ms',
      'deepcode_scroll_1k_fps',
      'deepcode_bash_first_chunk_ms',
    ]
    const labels = report.metrics.map(m => m.label)
    for (const expected of expectedLabels) {
      assert.ok(
        labels.includes(expected),
        `metric "${expected}" missing from report (got: ${labels.join(', ')})`,
      )
    }

    const jsonlMetric = report.metrics.find(
      m => m.label === 'deepcode_jsonl_parse_1k_msgs_ms',
    )
    assert.equal(
      jsonlMetric.kind,
      'measured',
      `jsonl_parse must succeed locally, got ${jsonlMetric.kind} (${jsonlMetric.reason ?? ''})`,
    )
    assert.ok(
      jsonlMetric.median > 0 && jsonlMetric.median < 1000,
      `jsonl parse median should be 0-1000ms, got ${jsonlMetric.median}`,
    )
    // The cheap, noise-prone jsonl probe is oversampled (NOISY_PROBE_REPEAT_FACTOR
    // in perf-baseline.mjs) so its median survives a transient CI hiccup. Even at
    // --repeats=1 it must collect more than one sample.
    assert.ok(
      jsonlMetric.samples.length >= 5,
      `jsonl parse must be oversampled for noise robustness, got ${jsonlMetric.samples.length} sample(s) at --repeats=1`,
    )
    // jsonl_tail is the other cheap, noise-prone probe and must be oversampled
    // too. Assert kind first so the sample-count message below never dereferences
    // `.samples` on an error placeholder (which has no `samples` field).
    const jsonlTailMetric = report.metrics.find(
      m => m.label === 'deepcode_jsonl_tail_100_msgs_ms',
    )
    assert.equal(
      jsonlTailMetric.kind,
      'measured',
      `jsonl_tail must succeed locally, got ${jsonlTailMetric.kind} (${jsonlTailMetric.reason ?? ''})`,
    )
    assert.ok(
      jsonlTailMetric.samples.length >= 5,
      `jsonl tail must be oversampled, got ${jsonlTailMetric.samples.length} sample(s) at --repeats=1`,
    )
    // Oversampling is SELECTIVE: the expensive ~10s cold-start probes must NOT be
    // oversampled, or CI time blows up. The exact contract is that cold-start
    // uses plain `repeats` while jsonl uses repeats * factor, so a measured
    // cold-start must record EXACTLY report.repeats samples (a `< jsonl` check
    // would be fail-open for partial oversampling). Guard for network-restricted
    // CI where a cold-start probe is an error placeholder with no `samples`.
    const coldStartMetric = report.metrics.find(
      m => m.label === 'deepcode_cold_start_version_ms',
    )
    if (coldStartMetric.kind === 'measured') {
      assert.equal(
        coldStartMetric.samples.length,
        report.repeats,
        `cold-start must NOT be oversampled — expected exactly ${report.repeats} sample(s), got ${coldStartMetric.samples.length}`,
      )
    }

    for (const metric of report.metrics.filter(m => m.kind === 'measured')) {
      assert.ok(metric.median > 0, `${metric.label} must have positive median`)
      assert.ok(
        Array.isArray(metric.samples) && metric.samples.length >= 1,
        `${metric.label} must record at least one sample`,
      )
      // The gate compares median, but min/median/max must stay ordered so the
      // report — and any future statistic — is well-formed.
      assert.ok(
        metric.min <= metric.median && metric.median <= metric.max,
        `${metric.label} must satisfy min <= median <= max, got ${metric.min}/${metric.median}/${metric.max}`,
      )
    }
  },
)

test(
  'perf-baseline rejects invalid --repeats values',
  { concurrency: false, timeout: 30_000 },
  async () => {
    const result = await new Promise(resolveProc => {
      const child = spawn(
        'bun',
        ['scripts/perf-baseline.mjs', '--repeats=0'],
        { cwd: packageRoot, stdio: 'pipe' },
      )
      let stderr = ''
      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
      child.on('exit', code => resolveProc({ code, stderr }))
    })
    assert.equal(result.code, 2, 'should exit 2 on invalid --repeats')
    assert.match(result.stderr, /repeats must be a positive integer/i)
  },
)
