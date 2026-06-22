import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { formatDateKeyLabel } from '../src/utils/formatDateKeyLabel.mjs'

const LEAF = fileURLToPath(
  new URL('../src/utils/formatDateKeyLabel.mjs', import.meta.url),
)

// Run a snippet in a fresh node process under a chosen TZ (node reads TZ at
// startup, so the only reliable way to test timezone behavior is a child).
function underTZ(tz, code) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
}

function newLabel(tz, dateKey) {
  return underTZ(
    tz,
    `import {formatDateKeyLabel} from ${JSON.stringify(LEAF)};` +
      `process.stdout.write(formatDateKeyLabel(${JSON.stringify(dateKey)}))`,
  )
}

function oldLabel(tz, dateKey) {
  // The exact pre-fix expression (bare-string Date parse).
  return underTZ(
    tz,
    `process.stdout.write(new Date(${JSON.stringify(dateKey)})` +
      `.toLocaleDateString('en-US',{month:'short',day:'numeric'}))`,
  )
}

const TZS = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'America/Sao_Paulo']

test('THE FIX: a YYYY-MM-DD key renders its OWN day in every timezone', () => {
  for (const tz of TZS) {
    assert.equal(newLabel(tz, '2026-06-23'), 'Jun 23', tz)
  }
})

test('differential: the old bare-string parse renders the PREVIOUS day west of UTC', () => {
  assert.equal(oldLabel('America/New_York', '2026-06-23'), 'Jun 22') // the bug
  assert.equal(oldLabel('America/Los_Angeles', '2026-06-23'), 'Jun 22')
  assert.equal(oldLabel('UTC', '2026-06-23'), 'Jun 23') // bug invisible at/above UTC
  // The fix is correct under the same negative-offset TZ:
  assert.equal(newLabel('America/New_York', '2026-06-23'), 'Jun 23')
})

test('in-process basics (TZ-independent by construction — local midnight)', () => {
  assert.equal(formatDateKeyLabel('2026-01-05'), 'Jan 5')
  assert.equal(formatDateKeyLabel('2026-12-31'), 'Dec 31')
})

test('custom options are honored', () => {
  assert.equal(
    formatDateKeyLabel('2026-06-23', { month: 'long', day: 'numeric' }),
    'June 23',
  )
})

test('a non-key input falls back to Date parsing without throwing', () => {
  assert.equal(typeof formatDateKeyLabel('not-a-date'), 'string')
  assert.match(formatDateKeyLabel('not-a-date'), /Invalid Date/)
})
