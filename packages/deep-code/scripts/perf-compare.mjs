#!/usr/bin/env node
/**
 * Compare two `perf-baseline --json=...` reports. Reports a diff
 * table and exits non-zero if any measured metric has regressed by
 * more than the configured threshold.
 *
 * Usage:
 *   node scripts/perf-compare.mjs --base=baseline.json --head=head.json
 *   node scripts/perf-compare.mjs --base=... --head=... --threshold=0.20
 *   node scripts/perf-compare.mjs --base=... --head=... --json=diff.json
 *
 * Threshold is a decimal fraction (default 0.20 = 20% regression
 * triggers exit code 1). Variance smoothing: a metric below
 * `--floor-ms` (default 5 ms) is considered noise-dominated and a
 * regression by absolute time below 2 ms is ignored even if the
 * percentage exceeds threshold — keeps CI from flapping on
 * sub-millisecond drift.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

const args = parseArgs(process.argv.slice(2))
const basePath = args.base
const headPath = args.head
const threshold = Number(args.threshold ?? '0.20')
const floorMs = Number(args.floor ?? '5')
const noiseFloorMs = Number(args['noise-floor'] ?? '2')
const writeJson = args.json
const verbose = args.verbose === '1' || args.verbose === 'true'

if (!basePath || !headPath) {
  console.error(
    'Usage: perf-compare.mjs --base=<path> --head=<path> [--threshold=0.20] [--json=<path>]',
  )
  process.exit(2)
}

if (
  !Number.isFinite(threshold) ||
  threshold <= 0 ||
  threshold >= 1
) {
  console.error(`--threshold must be in (0, 1) — got ${args.threshold}`)
  process.exit(2)
}

const base = readJson(basePath, 'base')
const head = readJson(headPath, 'head')
if (!Array.isArray(base.metrics) || !Array.isArray(head.metrics)) {
  console.error(`Both reports must contain a "metrics" array`)
  process.exit(2)
}

const baseByLabel = new Map(base.metrics.map(m => [m.label, m]))
const headByLabel = new Map(head.metrics.map(m => [m.label, m]))
const allLabels = [
  ...new Set([...baseByLabel.keys(), ...headByLabel.keys()]),
]

const rows = []
const regressed = []
const newMetrics = []
const droppedMetrics = []

for (const label of allLabels) {
  const b = baseByLabel.get(label)
  const h = headByLabel.get(label)
  if (!b) {
    newMetrics.push(label)
    rows.push({ label, status: 'new', baseMedian: null, headMedian: medianOf(h), deltaMs: null, deltaPct: null })
    continue
  }
  if (!h) {
    droppedMetrics.push(label)
    rows.push({ label, status: 'dropped', baseMedian: medianOf(b), headMedian: null, deltaMs: null, deltaPct: null })
    continue
  }
  // Categorize each (b.kind, h.kind) pair:
  //   - measured → error      : regression (probe broke); fail CI
  //   - error    → measured   : improvement (probe fixed)
  //   - error    → error      : still-error (probe stays broken)
  //   - placeholder ↔ error   : NEUTRAL — placeholder means an
  //                             intentional TODO, so transitioning
  //                             between placeholder and error isn't
  //                             a probe state change worth flagging.
  //                             Order matters: this branch must
  //                             precede the generic error branch.
  //   - placeholder either    : neutral (intentional TODO)
  if (b.kind === 'measured' && h.kind === 'error') {
    rows.push({
      label,
      status: 'probe-broken',
      baseMedian: medianOf(b),
      headMedian: null,
      deltaMs: null,
      deltaPct: null,
      reason: h.reason,
    })
    regressed.push({
      label,
      baseMedian: medianOf(b),
      headMedian: null,
      deltaMs: null,
      deltaPct: null,
      kind: 'probe-broken',
      reason: h.reason,
    })
    continue
  }
  if (b.kind === 'placeholder' || h.kind === 'placeholder') {
    rows.push({
      label,
      status: 'placeholder',
      baseMedian: medianOf(b),
      headMedian: medianOf(h),
      deltaMs: null,
      deltaPct: null,
    })
    continue
  }
  if (h.kind === 'error' || b.kind === 'error') {
    rows.push({
      label,
      status: b.kind === 'error' && h.kind === 'error' ? 'still-error' : 'probe-fixed',
      baseMedian: medianOf(b),
      headMedian: medianOf(h),
      deltaMs: null,
      deltaPct: null,
      reason: h.kind === 'error' ? h.reason : b.reason,
    })
    continue
  }
  if (b.kind !== 'measured' || h.kind !== 'measured') {
    rows.push({ label, status: 'placeholder', baseMedian: medianOf(b), headMedian: medianOf(h), deltaMs: null, deltaPct: null })
    continue
  }
  const baseMedian = b.median
  const headMedian = h.median
  const deltaMs = headMedian - baseMedian
  const deltaPct = baseMedian > 0 ? deltaMs / baseMedian : 0
  // Suppress alarms below the noise floor.
  let status = 'ok'
  if (
    deltaPct > threshold &&
    !(baseMedian < floorMs && Math.abs(deltaMs) < noiseFloorMs)
  ) {
    status = 'regressed'
    regressed.push({ label, baseMedian, headMedian, deltaMs, deltaPct })
  } else if (deltaPct < -threshold) {
    status = 'improved'
  }
  rows.push({ label, status, baseMedian, headMedian, deltaMs, deltaPct })
}

printReport({
  basePath,
  headPath,
  threshold,
  floorMs,
  noiseFloorMs,
  rows,
  regressed,
  newMetrics,
  droppedMetrics,
})

if (writeJson) {
  const out = {
    base: basePath,
    head: headPath,
    threshold,
    floorMs,
    noiseFloorMs,
    rows,
    regressed,
    newMetrics,
    droppedMetrics,
  }
  const path = resolve(writeJson)
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true })
  }
  writeFileSync(path, JSON.stringify(out, null, 2))
  if (verbose) console.log(`JSON diff → ${path}`)
}

if (regressed.length > 0) {
  const probeBroken = regressed.filter(r => r.kind === 'probe-broken').length
  const overThreshold = regressed.length - probeBroken
  const reasons = []
  if (overThreshold > 0) {
    reasons.push(
      `${overThreshold} metric(s) regressed beyond ${(threshold * 100).toFixed(0)}%`,
    )
  }
  if (probeBroken > 0) {
    reasons.push(`${probeBroken} metric(s) measured in base became error in head`)
  }
  console.error(`\nFAIL: ${reasons.join('; ')}`)
  process.exit(1)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.error(
      `Failed to read ${label} report (${path}): ${err instanceof Error ? err.message : err}`,
    )
    process.exit(2)
  }
}

function medianOf(metric) {
  if (!metric) return null
  if (metric.kind === 'measured') return metric.median
  return null
}

function printReport(state) {
  const lines = []
  lines.push('')
  lines.push('=== Perf comparison ===')
  lines.push(`Base : ${state.basePath}`)
  lines.push(`Head : ${state.headPath}`)
  lines.push(
    `Threshold: ±${(state.threshold * 100).toFixed(0)}% ` +
      `(noise floor: ${state.noiseFloorMs}ms below ${state.floorMs}ms metrics)`,
  )
  lines.push('')

  const header = ['metric', 'base', 'head', 'Δms', 'Δ%', 'status']
  const widths = header.map(h => h.length)
  const dataRows = state.rows.map(r => [
    r.label,
    r.baseMedian !== null ? r.baseMedian.toFixed(1) : '-',
    r.headMedian !== null ? r.headMedian.toFixed(1) : '-',
    r.deltaMs !== null ? formatSignedFixed(r.deltaMs, 1) : '-',
    r.deltaPct !== null ? formatSignedFixed(r.deltaPct * 100, 1) : '-',
    r.status,
  ])
  for (const row of [header, ...dataRows]) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], String(cell).length)
    })
  }
  for (const [idx, row] of [header, ...dataRows].entries()) {
    lines.push(row.map((cell, i) => String(cell).padEnd(widths[i] + 2)).join(''))
    if (idx === 0) lines.push(widths.map(w => '-'.repeat(w)).join('  '))
  }
  if (state.regressed.length > 0) {
    lines.push('')
    lines.push(`Regressions:`)
    for (const r of state.regressed) {
      if (r.kind === 'probe-broken') {
        lines.push(
          `  ${r.label}: probe BROKE in head ` +
            `(base ${r.baseMedian?.toFixed(1)}ms, head error: ${r.reason ?? 'unknown'})`,
        )
      } else {
        lines.push(
          `  ${r.label}: ${r.baseMedian.toFixed(1)}ms → ${r.headMedian.toFixed(1)}ms ` +
            `(${formatSignedFixed(r.deltaPct * 100, 1)}%)`,
        )
      }
    }
  }
  if (state.newMetrics.length > 0) {
    lines.push('')
    lines.push(`New metrics (not in base): ${state.newMetrics.join(', ')}`)
  }
  if (state.droppedMetrics.length > 0) {
    lines.push('')
    lines.push(
      `Dropped metrics (in base but not head): ${state.droppedMetrics.join(', ')} ` +
        `— probable regression in the harness`,
    )
  }
  lines.push('')
  process.stdout.write(lines.join('\n'))
}

function formatSignedFixed(value, digits) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
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
