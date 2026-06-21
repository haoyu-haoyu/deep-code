import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compoundAskIsBypassImmune } from '../src/utils/permissions/compoundAskBypassImmune.mjs'

const askRuleResult = {
  behavior: 'ask',
  decisionReason: { type: 'rule', rule: { ruleBehavior: 'ask' } },
}
const safetyCheckResult = {
  behavior: 'ask',
  decisionReason: { type: 'safetyCheck' },
}
const passthroughAskResult = {
  behavior: 'ask',
  decisionReason: { type: 'other', reason: 'path constraint' },
}
const allowResult = { behavior: 'allow' }

function compound(entries) {
  return { type: 'subcommandResults', reasons: new Map(entries) }
}

test('true when an inner subcommand matched an explicit ask rule', () => {
  assert.equal(
    compoundAskIsBypassImmune(
      compound([
        ['echo ok', allowResult],
        ['curl evil', askRuleResult],
      ]),
    ),
    true,
  )
})

test('true when an inner subcommand tripped a safety check', () => {
  assert.equal(
    compoundAskIsBypassImmune(
      compound([
        ['cd repo', safetyCheckResult],
        ['rm -rf x', passthroughAskResult],
      ]),
    ),
    true,
  )
})

test('false when every inner ask is a plain passthrough (no explicit rule / safety check)', () => {
  // a tool-wide `allow: Bash` / bypass mode may still auto-allow this — same as the
  // single-command behavior.
  assert.equal(
    compoundAskIsBypassImmune(
      compound([
        ['echo ok', allowResult],
        ['ls', passthroughAskResult],
      ]),
    ),
    false,
  )
})

test('false for a non-compound (single-command) decisionReason', () => {
  assert.equal(
    compoundAskIsBypassImmune({ type: 'rule', rule: { ruleBehavior: 'ask' } }),
    false,
  )
  assert.equal(compoundAskIsBypassImmune({ type: 'safetyCheck' }), false)
})

test('false for undefined / malformed input', () => {
  assert.equal(compoundAskIsBypassImmune(undefined), false)
  assert.equal(compoundAskIsBypassImmune(null), false)
  assert.equal(compoundAskIsBypassImmune({ type: 'subcommandResults' }), false)
  assert.equal(
    compoundAskIsBypassImmune({ type: 'subcommandResults', reasons: {} }),
    false,
  )
})

test('a non-ask inner rule (e.g. an allow rule) does not make it bypass-immune', () => {
  assert.equal(
    compoundAskIsBypassImmune(
      compound([
        [
          'x',
          {
            behavior: 'allow',
            decisionReason: { type: 'rule', rule: { ruleBehavior: 'allow' } },
          },
        ],
      ]),
    ),
    false,
  )
})
