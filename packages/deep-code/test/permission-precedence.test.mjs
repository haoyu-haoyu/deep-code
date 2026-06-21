import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolvePermissionPrecedence } from '../src/utils/permissions/resolvePermissionPrecedence.mjs'

// --- THE FIX: a content-specific deny outranks a tool-wide ask ----------------

test('content-specific deny beats a tool-wide ask (deny always wins)', () => {
  // The exact bug: {ask:["Bash"], deny:["Bash(rm:*)"]} on `rm -rf ...`. The
  // tool-wide ask is in effect AND the content check returned deny — deny wins.
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: true,
      contentBehavior: 'deny',
    }),
    'content-deny',
  )
})

test('a tool-wide deny short-circuits everything', () => {
  assert.equal(
    resolvePermissionPrecedence({
      toolWideDenied: true,
      toolWideAsk: true,
      contentBehavior: 'allow',
    }),
    'tool-wide-deny',
  )
})

test('content deny wins with no tool-wide ask present', () => {
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: false, contentBehavior: 'deny' }),
    'content-deny',
  )
})

// --- ask > allow is preserved -------------------------------------------------

test('a tool-wide ask still beats a content allow/passthrough (ask > allow)', () => {
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: true, contentBehavior: 'allow' }),
    'tool-wide-ask',
  )
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: true, contentBehavior: 'passthrough' }),
    'tool-wide-ask',
  )
})

// --- ordering of the ask-class slots is unchanged from the original flow -------

test('a tool-wide ask precedes requires-interaction (original 1b-before-1e order)', () => {
  // Both would ask, but the tool-wide ask owns the decision/message, as before.
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: true,
      contentBehavior: 'ask',
      requiresUserInteraction: true,
    }),
    'tool-wide-ask',
  )
})

test('requires-interaction fires when the content check asks and no tool-wide ask', () => {
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      requiresUserInteraction: true,
    }),
    'requires-interaction',
  )
})

test('requires-interaction does NOT fire unless the content check asks', () => {
  // allow/passthrough with requiresUserInteraction → falls through, not an ask.
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'allow',
      requiresUserInteraction: true,
    }),
    'continue',
  )
})

test('content ask-rule fires only for a rule-type ask with ruleBehavior ask', () => {
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: 'rule',
      contentRuleBehavior: 'ask',
    }),
    'content-ask-rule',
  )
  // A rule-type ask whose ruleBehavior is NOT 'ask' does not match this slot.
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: 'rule',
      contentRuleBehavior: 'allow',
    }),
    'continue',
  )
})

test('safety-check ask fires for a safetyCheck-type content ask', () => {
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: 'safetyCheck',
    }),
    'safety-check-ask',
  )
})

// --- compound (subcommandResults) ask: the bypass-immune slot -----------------

test('a bypass-immune compound ask maps to content-ask-rule (not continue)', () => {
  // `echo ok && curl evil` where curl matched ask: Bash(curl:*). Flattened to
  // type 'subcommandResults'; the caller computed contentAskBypassImmune=true.
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: 'subcommandResults',
      contentAskBypassImmune: true,
    }),
    'content-ask-rule',
  )
})

test('a NON-bypass-immune compound ask still continues (tool-wide allow / bypass may auto-allow)', () => {
  assert.equal(
    resolvePermissionPrecedence({
      toolWideAsk: false,
      contentBehavior: 'ask',
      contentReasonType: 'subcommandResults',
      contentAskBypassImmune: false,
    }),
    'continue',
  )
})

test('a content DENY still wins over a compound bypass-immune ask (deny precedence)', () => {
  assert.equal(
    resolvePermissionPrecedence({
      contentBehavior: 'deny',
      contentReasonType: 'subcommandResults',
      contentAskBypassImmune: true,
    }),
    'content-deny',
  )
})

// --- no objection -------------------------------------------------------------

test('no signals → continue (caller proceeds to mode/allow handling)', () => {
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: false, contentBehavior: 'allow' }),
    'continue',
  )
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: false, contentBehavior: 'passthrough' }),
    'continue',
  )
})

test('a sandbox-auto-allowed bash command (toolWideAsk already false) continues', () => {
  // The caller AND-s canSandboxAutoAllow into toolWideAsk, so a sandboxed bash
  // command with an ask rule arrives here as toolWideAsk:false and is governed
  // by the content check (allow/passthrough → continue → downstream allow).
  assert.equal(
    resolvePermissionPrecedence({ toolWideAsk: false, contentBehavior: 'passthrough' }),
    'continue',
  )
})
