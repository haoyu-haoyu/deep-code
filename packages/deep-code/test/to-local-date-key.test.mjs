import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { toLocalDateKey } from '../src/utils/toLocalDateKey.mjs'

const LEAF = fileURLToPath(new URL('../src/utils/toLocalDateKey.mjs', import.meta.url))

function underTZ(tz, code) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
}

const keyUnderTZ = (tz, iso) =>
  underTZ(
    tz,
    `import {toLocalDateKey} from ${JSON.stringify(LEAF)};` +
      `process.stdout.write(toLocalDateKey(new Date(${JSON.stringify(iso)})))`,
  )

// The pre-fix UTC key, as a differential oracle.
const utcKey = iso => new Date(iso).toISOString().split('T')[0]

test('a date built from LOCAL components keys to those components (timezone-independent)', () => {
  assert.equal(toLocalDateKey(new Date(2026, 5, 23, 10, 0)), '2026-06-23')
  assert.equal(toLocalDateKey(new Date(2026, 0, 5)), '2026-01-05') // zero-padding
  assert.equal(toLocalDateKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31')
  assert.equal(toLocalDateKey(new Date(2024, 1, 29)), '2024-02-29') // leap day
})

test('THE FIX: an evening-UTC instant keys to the LOCAL calendar day, not the UTC day', () => {
  // 2026-06-22 18:00 UTC: still June 22 in the Americas, already June 23 in Asia.
  const iso = '2026-06-22T18:00:00.000Z'
  assert.equal(keyUnderTZ('Asia/Shanghai', iso), '2026-06-23') // UTC+8 -> next local day
  assert.equal(keyUnderTZ('America/Los_Angeles', iso), '2026-06-22') // UTC-7 -> same day
  // the OLD UTC key was '2026-06-22' in BOTH zones (the bug: Asia's local June 23
  // activity was keyed to June 22, which the local June-23 heatmap cell never read)
  assert.equal(utcKey(iso), '2026-06-22')
})

test('a morning-UTC instant agrees with UTC for east-of-UTC but local still wins west', () => {
  // 2026-06-23 02:00 UTC: June 23 in Asia AND in UTC; June 22 22:00 in LA.
  const iso = '2026-06-23T02:00:00.000Z'
  assert.equal(keyUnderTZ('Asia/Shanghai', iso), '2026-06-23')
  assert.equal(keyUnderTZ('America/Los_Angeles', iso), '2026-06-22') // local previous day
  assert.equal(utcKey(iso), '2026-06-23')
})

test('throws on an Invalid Date (matching the old toISOString behavior)', () => {
  assert.throws(() => toLocalDateKey(new Date('not-a-date')), /Invalid Date/)
  assert.throws(() => toLocalDateKey(new Date(NaN)), /Invalid Date/)
})
