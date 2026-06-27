import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { nextCronRun } from '../src/utils/nextCronRun.mjs'

const TZ = 'America/New_York'

// Date's timezone is fixed at process start, so to exercise DST deterministically
// we re-run this file in a child process pinned to a DST-observing zone. Done as
// a normal test (not process.exit) so a combined `node --test a b c` run is not
// torn down.
if (process.env.TZ !== TZ) {
  test('cron DST behavior (re-run pinned to America/New_York)', () => {
    const r = spawnSync(
      process.execPath,
      ['--test', fileURLToPath(import.meta.url)],
      { env: { ...process.env, TZ }, encoding: 'utf8' },
    )
    assert.equal(
      r.status,
      0,
      `child run under TZ=${TZ} failed:\n${r.stdout ?? ''}\n${r.stderr ?? ''}`,
    )
  })
} else {
  runSuite()
}

// Build CronFields, defaulting unspecified fields to their full wildcard range.
const RANGES = { minute: [0, 59], hour: [0, 23], dayOfMonth: [1, 31], month: [1, 12], dayOfWeek: [0, 6] }
const fullRange = key => {
  const [lo, hi] = RANGES[key]
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}
const fields = spec => ({
  minute: spec.minute ?? fullRange('minute'),
  hour: spec.hour ?? fullRange('hour'),
  dayOfMonth: spec.dayOfMonth ?? fullRange('dayOfMonth'),
  month: spec.month ?? fullRange('month'),
  dayOfWeek: spec.dayOfWeek ?? fullRange('dayOfWeek'),
})

// The PRIOR minute-by-minute local-time walk, ported verbatim as a differential
// oracle. It is correct away from DST transitions; nextCronRun must agree there.
function oldWalkOracle(f, from) {
  const minuteSet = new Set(f.minute)
  const hourSet = new Set(f.hour)
  const domSet = new Set(f.dayOfMonth)
  const monthSet = new Set(f.month)
  const dowSet = new Set(f.dayOfWeek)
  const domWild = f.dayOfMonth.length === 31
  const dowWild = f.dayOfWeek.length === 7
  const t = new Date(from.getTime())
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  const maxIter = 366 * 24 * 60
  for (let i = 0; i < maxIter; i++) {
    const month = t.getMonth() + 1
    if (!monthSet.has(month)) { t.setMonth(t.getMonth() + 1, 1); t.setHours(0, 0, 0, 0); continue }
    const dom = t.getDate(), dow = t.getDay()
    const dayMatches = domWild && dowWild ? true : domWild ? dowSet.has(dow) : dowWild ? domSet.has(dom) : domSet.has(dom) || dowSet.has(dow)
    if (!dayMatches) { t.setDate(t.getDate() + 1); t.setHours(0, 0, 0, 0); continue }
    if (!hourSet.has(t.getHours())) { t.setHours(t.getHours() + 1, 0, 0, 0); continue }
    if (!minuteSet.has(t.getMinutes())) { t.setMinutes(t.getMinutes() + 1); continue }
    return t
  }
  return null
}

function runSuite() {
  test('pinned to the expected DST zone', () => {
    // Sanity: confirm the child really runs under a DST-observing zone.
    assert.equal(new Date(2024, 2, 10, 1, 59).getHours(), 1)
    assert.equal(new Date(2024, 2, 10, 1, 59, 0).getTimezoneOffset(), 300) // EST
    assert.equal(new Date(2024, 5, 10, 12, 0).getTimezoneOffset(), 240) // EDT
  })

  test('THE FIX: a `30 2 * * *` cron is NOT skipped on the spring-forward day', () => {
    // 2024-03-10: 02:00 -> 03:00, so 02:30 does not exist locally.
    const from = new Date(2024, 2, 10, 0, 0, 0) // 00:00 EST
    const next = nextCronRun(fields({ minute: [30], hour: [2] }), from)
    assert.ok(next, 'must return a fire time, not null')
    // Same calendar day (the job runs, not deferred to the 11th).
    assert.equal(next.getDate(), 10)
    assert.equal(next.getMonth(), 2)
    // Forward-mapped into the first existing instant after the gap.
    assert.equal(next.getHours(), 3)
    assert.equal(next.getMinutes(), 30)
    // The OLD walk skipped the whole day (fired on the 11th) — prove divergence.
    const old = oldWalkOracle(fields({ minute: [30], hour: [2] }), from)
    assert.equal(old.getDate(), 11, 'old behavior skipped to the next day')
    assert.ok(next.getTime() < old.getTime(), 'new fires earlier (same day)')
  })

  test('a wildcard-hour cron fires at the first valid minute after the gap', () => {
    const from = new Date(2024, 2, 10, 1, 59, 0)
    const next = nextCronRun(fields({ minute: [30] }), from)
    assert.ok(next)
    // 02:30 is skipped; next :30 after 01:59 is 03:30.
    assert.equal(next.getHours(), 3)
    assert.equal(next.getMinutes(), 30)
  })

  test('fall-back: a `30 1 * * *` cron fires ONCE on the repeated hour', () => {
    // 2024-11-03: 02:00 -> 01:00, so 01:30 occurs twice (EDT then EST).
    const from = new Date(2024, 10, 3, 0, 0, 0)
    const first = nextCronRun(fields({ minute: [30], hour: [1] }), from)
    assert.ok(first)
    assert.equal(first.getDate(), 3)
    assert.equal(first.getHours(), 1)
    assert.equal(first.getMinutes(), 30)
    assert.equal(first.getTimezoneOffset(), 240, 'fires at the first (EDT) occurrence')
    // From just after the first occurrence, the SECOND 01:30 (EST) is NOT a
    // separate fire — the next run is the following day.
    const next = nextCronRun(fields({ minute: [30], hour: [1] }), first)
    assert.equal(next.getDate(), 4, 'does not fire again at the repeated 01:30')
  })

  test('a normal daily cron fires every day across a DST transition week', () => {
    let cur = new Date(2024, 2, 8, 0, 0, 0) // Fri before spring-forward
    const seenDates = new Set()
    for (let i = 0; i < 5; i++) {
      const next = nextCronRun(fields({ minute: [0], hour: [9] }), cur)
      assert.ok(next)
      seenDates.add(next.getDate())
      cur = next
    }
    // 5 consecutive distinct calendar days — none skipped (incl. the 10th).
    assert.deepEqual([...seenDates].sort((a, b) => a - b), [8, 9, 10, 11, 12])
  })

  test('strictly after `from`; seconds are cleared', () => {
    const from = new Date(2024, 5, 10, 9, 0, 30) // 09:00:30
    const next = nextCronRun(fields({ minute: [0], hour: [9] }), from)
    // 09:00 already passed (strictly after) -> next is 09:00 tomorrow.
    assert.equal(next.getDate(), 11)
    assert.equal(next.getSeconds(), 0)
    assert.equal(next.getMilliseconds(), 0)
  })

  test('a multi-year-out leap-day cron resolves (no false null) and matches the old walk', () => {
    // `0 0 29 2 *` from just after Feb 29 2024 must find Feb 29 2028 (4 years
    // out) — the old minute-walk found it via month/day skips; a too-small day
    // cap would regress to null.
    const spec = fields({ minute: [0], hour: [0], dayOfMonth: [29], month: [2] })
    const from = new Date(2025, 2, 1) // 2025-03-01, after the 2024 leap day
    const next = nextCronRun(spec, from)
    assert.ok(next, 'leap-day cron must resolve, not return null')
    assert.equal(next.getFullYear(), 2028)
    assert.equal(next.getMonth(), 1)
    assert.equal(next.getDate(), 29)
    assert.equal(next.getTime(), oldWalkOracle(spec, from).getTime())
  })

  test('a genuinely impossible spec still returns null', () => {
    // Feb 31 / Feb 30 never exist.
    assert.equal(nextCronRun(fields({ minute: [0], hour: [0], dayOfMonth: [31], month: [2] }), new Date(2024, 0, 1)), null)
    assert.equal(nextCronRun(fields({ minute: [0], hour: [0], dayOfMonth: [30], month: [2] }), new Date(2024, 0, 1)), null)
  })

  test('edge dates: Feb 29 (leap) and end-of-month', () => {
    const feb = nextCronRun(fields({ minute: [0], hour: [0], dayOfMonth: [29], month: [2] }), new Date(2024, 0, 1))
    assert.equal(feb.getFullYear(), 2024)
    assert.equal(feb.getMonth(), 1)
    assert.equal(feb.getDate(), 29)
    const eom = nextCronRun(fields({ minute: [0], hour: [0], dayOfMonth: [31] }), new Date(2024, 3, 1)) // Apr has no 31
    assert.equal(eom.getMonth(), 4) // May
    assert.equal(eom.getDate(), 31)
  })

  test('DIFFERENTIAL FUZZ: matches the old walk away from DST transitions', () => {
    // Seeded LCG for reproducibility.
    let seed = 0x9e3779b9
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000)
    const pick = arr => arr[Math.floor(rnd() * arr.length)]
    const subset = (lo, hi, k) => {
      const s = new Set()
      while (s.size < k) s.add(lo + Math.floor(rnd() * (hi - lo + 1)))
      return [...s].sort((a, b) => a - b)
    }
    let checked = 0
    for (let i = 0; i < 4000; i++) {
      // Frequent crons only, so the next run stays within a couple of days and
      // never crosses the Mar/Nov transitions while `from` is in summer.
      const spec = {}
      const kind = pick(['everyMin', 'hourly', 'daily', 'fewHours', 'fewMins'])
      if (kind === 'hourly') spec.minute = subset(0, 59, 1)
      else if (kind === 'daily') { spec.minute = subset(0, 59, 1); spec.hour = subset(0, 23, 1) }
      else if (kind === 'fewHours') { spec.minute = subset(0, 59, 1 + Math.floor(rnd() * 3)); spec.hour = subset(0, 23, 1 + Math.floor(rnd() * 4)) }
      else if (kind === 'fewMins') spec.minute = subset(0, 59, 1 + Math.floor(rnd() * 5))
      // else everyMin: all wildcards
      const f = fields(spec)
      // `from` somewhere in Jun 1 – Sep 29 2024 (no DST transition; results stay in-window).
      const from = new Date(2024, 5, 1 + Math.floor(rnd() * 120), Math.floor(rnd() * 24), Math.floor(rnd() * 60), Math.floor(rnd() * 60))
      const a = nextCronRun(f, from)
      const b = oldWalkOracle(f, from)
      assert.equal(a?.getTime() ?? null, b?.getTime() ?? null, `mismatch i=${i} kind=${kind} from=${from.toISOString()}`)
      checked++
    }
    assert.ok(checked === 4000)
  })
}
