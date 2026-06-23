import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { getNextDay } from '../src/utils/getNextDay.mjs'

const LEAF = fileURLToPath(new URL('../src/utils/getNextDay.mjs', import.meta.url))

// Run a snippet in a fresh node process under a chosen TZ (node reads TZ at
// startup, so a child is the only reliable way to test timezone behavior).
function underTZ(tz, code) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
}

// The exact pre-fix implementation (UTC parse + LOCAL increment + UTC serialize).
const OLD_GETNEXTDAY = `
function oldGetNextDay(dateStr) {
  const date = new Date(dateStr)
  date.setDate(date.getDate() + 1)
  return date.toISOString().split('T')[0]
}
`

test('the new leaf advances exactly one calendar day (timezone-independent)', () => {
  assert.equal(getNextDay('2026-06-23'), '2026-06-24')
  assert.equal(getNextDay('2026-03-08'), '2026-03-09') // US DST spring-forward
  assert.equal(getNextDay('2027-03-14'), '2027-03-15') // next year's spring-forward
  assert.equal(getNextDay('2026-10-25'), '2026-10-26') // EU DST fall-back
})

test('month / year / leap-year rollover', () => {
  assert.equal(getNextDay('2026-12-31'), '2027-01-01')
  assert.equal(getNextDay('2026-02-28'), '2026-03-01') // 2026 not a leap year
  assert.equal(getNextDay('2024-02-28'), '2024-02-29') // 2024 leap
  assert.equal(getNextDay('2024-02-29'), '2024-03-01')
  assert.equal(getNextDay('2026-01-31'), '2026-02-01')
})

test('a walk across the DST boundary never repeats or skips a day', () => {
  let day = '2026-03-06'
  const seen = [day]
  for (let i = 0; i < 6; i++) {
    day = getNextDay(day)
    seen.push(day)
  }
  assert.deepEqual(seen, [
    '2026-03-06',
    '2026-03-07',
    '2026-03-08', // spring-forward day
    '2026-03-09',
    '2026-03-10',
    '2026-03-11',
    '2026-03-12',
  ])
})

test('THE BUG: under America/Los_Angeles the old code got STUCK on the spring-forward day; the leaf does not', () => {
  // Old code, run under the DST timezone, returns its own input — the cache then
  // re-processes (and double-counts) that day.
  const oldResult = underTZ(
    'America/Los_Angeles',
    OLD_GETNEXTDAY +
      `process.stdout.write(oldGetNextDay('2026-03-08'))`,
  )
  assert.equal(oldResult, '2026-03-08') // STUCK (the bug)

  // The leaf, run under the same timezone, advances correctly.
  const newResult = underTZ(
    'America/Los_Angeles',
    `import {getNextDay} from ${JSON.stringify(LEAF)};` +
      `process.stdout.write(getNextDay('2026-03-08'))`,
  )
  assert.equal(newResult, '2026-03-09') // FIXED
})

test('the leaf agrees with the old code on every NON-DST day, in both hemispheres of UTC', () => {
  // On ordinary days the old local-increment + UTC-serialize cancelled out, so
  // the leaf must match it exactly under any timezone (this is the no-regression
  // guarantee for the common case).
  for (const tz of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
    for (const d of ['2026-06-23', '2026-01-15', '2026-12-31', '2026-07-04']) {
      const oldR = underTZ(
        tz,
        OLD_GETNEXTDAY + `process.stdout.write(oldGetNextDay(${JSON.stringify(d)}))`,
      )
      assert.equal(getNextDay(d), oldR, `${tz} ${d}`)
    }
  }
})
