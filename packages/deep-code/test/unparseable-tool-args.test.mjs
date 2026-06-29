import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod/v4/index.js'

import {
  isUnparseableToolArgs,
  markUnparseableToolArgs,
  UNPARSEABLE_TOOL_ARGS_KEY,
  UNPARSEABLE_TOOL_ARGS_MESSAGE,
} from '../src/services/tools/unparseableToolArgs.mjs'

test('the sentinel is recognized and preserves the raw unparseable text', () => {
  const raw = '{"channel":"C123","text":"hel' // truncated mid-arguments
  const sentinel = markUnparseableToolArgs(raw)
  assert.equal(isUnparseableToolArgs(sentinel), true)
  assert.equal(sentinel._raw, raw)
  assert.equal(sentinel[UNPARSEABLE_TOOL_ARGS_KEY], true)
})

test('validly-parsed arguments are never mistaken for the sentinel', () => {
  // A model can legitimately send valid JSON {"_raw":"..."} — it parses fine and
  // never goes through the failure branch, so it must NOT be flagged (shape-based
  // detection would false-positive here; the marker key prevents that).
  assert.equal(isUnparseableToolArgs({ _raw: 'a real value' }), false)
  assert.equal(isUnparseableToolArgs({ file_path: '/x', content: 'y' }), false)
  assert.equal(isUnparseableToolArgs({}), false)
})

test('non-objects and a falsy marker are not the sentinel', () => {
  for (const v of ['x', 42, true, null, undefined, ['a'], () => {}]) {
    assert.equal(isUnparseableToolArgs(v), false)
  }
  // The marker must be literally true, not merely present/truthy.
  assert.equal(
    isUnparseableToolArgs({ [UNPARSEABLE_TOOL_ARGS_KEY]: 'true' }),
    false,
  )
  assert.equal(isUnparseableToolArgs({ [UNPARSEABLE_TOOL_ARGS_KEY]: 1 }), false)
})

test('the sentinel survives a JSON round-trip (string-keyed marker, not a Symbol)', () => {
  const sentinel = markUnparseableToolArgs('garbage')
  const roundTripped = JSON.parse(JSON.stringify(sentinel))
  assert.equal(isUnparseableToolArgs(roundTripped), true)
})

test('the sentinel is still detected after a backfill merges in extra keys', () => {
  // backfillObservableInput / permission defaults may spread additional keys onto
  // the tool input before it reaches the gate; only the marker is load-bearing.
  const merged = { ...markUnparseableToolArgs('garbage'), file_path: '/tmp/x' }
  assert.equal(isUnparseableToolArgs(merged), true)
})

test('the model-facing message is a non-empty actionable string', () => {
  assert.equal(typeof UNPARSEABLE_TOOL_ARGS_MESSAGE, 'string')
  assert.ok(UNPARSEABLE_TOOL_ARGS_MESSAGE.length > 0)
  assert.match(UNPARSEABLE_TOOL_ARGS_MESSAGE, /JSON/)
})

test('REGRESSION: the MCP passthrough schema accepts the sentinel, but the predicate catches it', () => {
  // This is the whole reason the fix lives at the tool-execution gate rather than
  // relying on per-tool schemas: an MCP tool validates with z.object({}).passthrough(),
  // which ACCEPTS the sentinel OBJECT (so the per-tool schema would forward it to the
  // remote server) — only isUnparseableToolArgs rejects it.
  const mcpSchema = z.object({}).passthrough()
  const sentinel = markUnparseableToolArgs('{"a":')
  assert.equal(
    mcpSchema.safeParse(sentinel).success,
    true,
    'MCP passthrough accepts the sentinel object — the per-tool schema cannot catch it',
  )
  assert.equal(
    isUnparseableToolArgs(sentinel),
    true,
    'the gate-level predicate is what rejects it',
  )
  // A non-object would have been rejected by passthrough, but it risks downstream
  // object assumptions before the gate — documenting why a tagged object, not a
  // bare string, is the chosen sentinel.
  assert.equal(mcpSchema.safeParse('{"a":').success, false)
})
