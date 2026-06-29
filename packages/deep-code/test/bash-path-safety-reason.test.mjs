import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bashPathSafetyAskReason,
  bashUnresolvableSafetyAskReason,
} from '../src/utils/permissions/bashPathSafetyReason.mjs'
import { resolvePermissionPrecedence } from '../src/utils/permissions/resolvePermissionPrecedence.mjs'
import { compoundAskIsBypassImmune } from '../src/utils/permissions/compoundAskBypassImmune.mjs'

test('bashPathSafetyAskReason: safetyCheck, classifier MAY evaluate', () => {
  const r = bashPathSafetyAskReason('cd write needs approval')
  assert.deepEqual(r, {
    type: 'safetyCheck',
    reason: 'cd write needs approval',
    classifierApprovable: true,
  })
})

test('bashUnresolvableSafetyAskReason: safetyCheck, classifier-IMMUNE', () => {
  const r = bashUnresolvableSafetyAskReason('process substitution')
  assert.deepEqual(r, {
    type: 'safetyCheck',
    reason: 'process substitution',
    classifierApprovable: false,
  })
})

// The whole point of the fix: an ask carrying either factory's decisionReason
// must land in the bypass-immune `safety-check-ask` slot — NOT `continue`, where a
// tool-wide `allow: ["Bash"]` rule / bypassPermissions mode / a PreToolUse hook
// could downgrade it to ALLOW.
test('SECURITY: a path-safety ask routes to the bypass-immune slot (not continue)', () => {
  for (const reason of [
    bashPathSafetyAskReason('cd .claude && echo > settings.json'),
    bashUnresolvableSafetyAskReason('echo x > >(tee .git/config)'),
  ]) {
    const slot = resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: reason.type,
    })
    assert.equal(slot, 'safety-check-ask')
  }
})

test('REGRESSION: the OLD type "other" shape was downgradable (routed to continue)', () => {
  // Proves the bug these reasons fix: with the previous `type: 'other'`, the same
  // ask fell through to `continue` and could be auto-allowed.
  const slot = resolvePermissionPrecedence({
    toolWideAsk: false,
    contentBehavior: 'ask',
    contentReasonType: 'other',
  })
  assert.equal(slot, 'continue')
})

// The cd-based guards usually fire inside a COMPOUND command (`cd … && write`),
// which the aggregator flattens to type 'subcommandResults'. compoundAskIsBypassImmune
// must still recognise the inner safetyCheck so the flattened ask stays immune.
test('SECURITY: compound ask with an inner path-safety reason is bypass-immune', () => {
  const decisionReason = {
    type: 'subcommandResults',
    reasons: new Map([
      ['cd .claude', { behavior: 'allow' }],
      [
        'echo x > settings.json',
        {
          behavior: 'ask',
          decisionReason: bashPathSafetyAskReason(
            'cd with output redirection - manual approval required',
          ),
        },
      ],
    ]),
  }
  assert.equal(compoundAskIsBypassImmune(decisionReason), true)

  const slot = resolvePermissionPrecedence({
    toolWideAsk: false,
    contentBehavior: 'ask',
    contentReasonType: 'subcommandResults',
    contentAskBypassImmune: compoundAskIsBypassImmune(decisionReason),
  })
  assert.equal(slot, 'content-ask-rule') // the bypass-immune compound outcome
})

test('an unresolvable reason is equally immune inside a compound', () => {
  const decisionReason = {
    type: 'subcommandResults',
    reasons: new Map([
      [
        'echo x > $OUT',
        {
          behavior: 'ask',
          decisionReason: bashUnresolvableSafetyAskReason(
            'Shell expansion syntax in paths requires manual approval',
          ),
        },
      ],
    ]),
  }
  assert.equal(compoundAskIsBypassImmune(decisionReason), true)
})
