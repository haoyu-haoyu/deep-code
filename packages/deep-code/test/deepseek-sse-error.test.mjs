import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  collectDeepSeekStreamEvents,
  createDeepSeekStreamError,
  parseDeepSeekSSELines,
} from '../src/services/providers/deepseek.mjs'

// mirrors the production isAbortError (deepseek.mjs) — the stream error must
// NEVER be classified as a cancellation, even if the server code is ABORT_ERR.
const isAbortError = e => e?.name === 'AbortError' || e?.code === 'ABORT_ERR'

async function* eventsOf(...events) {
  for (const e of events) yield e
}

// --- the bug: a top-level {"error":{...}} SSE chunk was silently dropped ---

test('a mid-stream error chunk produces exactly one error event', () => {
  const events = parseDeepSeekSSELines([
    'data: {"error":{"message":"Internal server error","type":"server_error"}}',
  ])
  assert.deepEqual(events, [
    {
      type: 'error',
      error: { message: 'Internal server error', type: 'server_error' },
    },
  ])
})

test('content-then-error: content is preserved AND the error is surfaced', () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"content":"par"}}]}',
    'data: {"choices":[{"delta":{"content":"tial"}}]}',
    'data: {"error":{"message":"boom"}}',
  ])
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'par' },
    { type: 'content_delta', text: 'tial' },
    { type: 'error', error: { message: 'boom' } },
  ])
})

test('an error alongside content in the SAME chunk emits content first', () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"content":"x"}}],"error":{"message":"late"}}',
  ])
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'x' },
    { type: 'error', error: { message: 'late' } },
  ])
})

// --- happy path stays byte-identical (no spurious error events) ---

test('normal chunks emit no error event (happy path unchanged)', () => {
  assert.deepEqual(
    parseDeepSeekSSELines(['data: {"choices":[{"delta":{"content":"hi"}}]}']),
    [{ type: 'content_delta', text: 'hi' }],
  )
  assert.deepEqual(parseDeepSeekSSELines(['data: [DONE]']), [{ type: 'done' }])
  // a chunk with a falsy `error` field must NOT emit an error event
  assert.deepEqual(
    parseDeepSeekSSELines([
      'data: {"choices":[{"delta":{"content":"hi"}}],"error":null}',
    ]),
    [{ type: 'content_delta', text: 'hi' }],
  )
  // a malformed line is still skipped, not surfaced as an error event
  assert.deepEqual(parseDeepSeekSSELines(['data: {not json']), [])
})

// --- the error helper: loud, message-bearing, and never an AbortError ---

test('createDeepSeekStreamError carries the server message and is not an abort', () => {
  const err = createDeepSeekStreamError({
    message: 'Internal server error',
    type: 'server_error',
  })
  assert.equal(err.name, 'DeepSeekStreamError')
  assert.equal(err.deepSeekStreamError, true)
  assert.match(err.message, /Internal server error/)
  assert.equal(err.deepSeekType, 'server_error')
  assert.equal(isAbortError(err), false)
})

test('a server code of ABORT_ERR cannot make the error look like a cancellation', () => {
  const err = createDeepSeekStreamError({ message: 'x', code: 'ABORT_ERR' })
  // stored OUT of the `code` field so isAbortError stays false
  assert.equal(err.code, undefined)
  assert.equal(err.deepSeekCode, 'ABORT_ERR')
  assert.equal(isAbortError(err), false)
})

test('createDeepSeekStreamError tolerates a string or empty error', () => {
  assert.match(createDeepSeekStreamError('boom').message, /boom/)
  assert.match(createDeepSeekStreamError(undefined).message, /unknown error/)
  assert.match(createDeepSeekStreamError({}).message, /unknown error/)
})

// --- the non-streaming collector (runDeepSeekAgent / /compact / doctor) ---

test('collectDeepSeekStreamEvents throws on a mid-stream error event', async () => {
  await assert.rejects(
    collectDeepSeekStreamEvents(
      eventsOf(
        { type: 'content_delta', text: 'partial' },
        { type: 'error', error: { message: 'Internal server error' } },
      ),
    ),
    err => {
      assert.equal(err.name, 'DeepSeekStreamError')
      assert.match(err.message, /Internal server error/)
      assert.equal(isAbortError(err), false)
      return true
    },
  )
})

test('collectDeepSeekStreamEvents still aggregates a clean stream', async () => {
  const result = await collectDeepSeekStreamEvents(
    eventsOf(
      { type: 'content_delta', text: 'he' },
      { type: 'content_delta', text: 'llo' },
      { type: 'finish', finishReason: 'stop' },
    ),
  )
  assert.equal(result.content, 'hello')
  assert.equal(result.finishReason, 'stop')
})

// --- null/garbage choice & tool_call ELEMENTS must not abort the stream ---

test('a null tool_calls entry is skipped; already-streamed content survives', () => {
  // A non-conformant gateway pads tool_calls with a null. The unguarded
  // toolCall.index used to throw, aborting the generator and losing the content.
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"content":"keep"}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[null,{"index":0,"id":"t1","function":{"name":"f","arguments":"{}"}}]}}]}',
  ])
  assert.deepEqual(events, [
    { type: 'content_delta', text: 'keep' },
    { type: 'tool_call_delta', index: 0, id: 't1', name: 'f', argumentsDelta: '{}' },
  ])
})

test('a null choice entry is skipped (no throw)', () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[null,{"delta":{"content":"ok"}}]}',
  ])
  assert.deepEqual(events, [{ type: 'content_delta', text: 'ok' }])
})

test('a JSON-valid non-object chunk (data: null / 5 / array) is skipped, not crashed', () => {
  // JSON.parse succeeds but chunk.choices would throw on null — must skip the line.
  assert.deepEqual(parseDeepSeekSSELines(['data: null']), [])
  assert.deepEqual(parseDeepSeekSSELines(['data: 5']), [])
  assert.deepEqual(parseDeepSeekSSELines(['data: "x"']), [])
  assert.deepEqual(parseDeepSeekSSELines(['data: [1,2,3]']), [])
  // and a bad chunk between good ones doesn't drop the good content
  assert.deepEqual(
    parseDeepSeekSSELines([
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      'data: null',
      'data: {"choices":[{"delta":{"content":"b"}}]}',
    ]),
    [
      { type: 'content_delta', text: 'a' },
      { type: 'content_delta', text: 'b' },
    ],
  )
})

test('a non-array tool_calls / choices is tolerated (coerced to empty)', () => {
  assert.deepEqual(
    parseDeepSeekSSELines(['data: {"choices":[{"delta":{"tool_calls":"oops","content":"c"}}]}']),
    [{ type: 'content_delta', text: 'c' }],
  )
  assert.deepEqual(parseDeepSeekSSELines(['data: {"choices":{"not":"an array"}}']), [])
})

test('a real tool_call delta carries finishReason; no redundant synthetic finish', () => {
  // A real tool_call element emits a tool_call_delta that ALREADY carries
  // finishReason, so the separate synthetic finish is correctly suppressed (no
  // double-finish). Happy path byte-identical.
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t","function":{"name":"f"}}]},"finish_reason":"tool_calls"}]}',
  ])
  assert.deepEqual(events, [
    { type: 'tool_call_delta', index: 0, id: 't', name: 'f', finishReason: 'tool_calls' },
  ])
})

test('THE FIX: an all-garbage tool_calls array does NOT swallow a bundled finish_reason', () => {
  // A non-conformant gateway bundles finish_reason:'length' with a tool_calls array
  // whose only element(s) are null/garbage. The element is skipped (no real
  // tool_call_delta emitted), so nothing carries the finishReason — the synthetic
  // finish MUST fire. The old guard keyed on the RAW toolCalls.length (> 0 here),
  // suppressing the finish → finishReason dropped → stop_reason null → the
  // output-token-truncation recovery (needs 'max_tokens') was silently skipped.
  for (const garbage of ['[null]', '[5]', '["x"]', '[null,null]']) {
    const events = parseDeepSeekSSELines([
      `data: {"choices":[{"delta":{"content":"partial","tool_calls":${garbage}},"finish_reason":"length"}]}`,
    ])
    assert.deepEqual(
      events,
      [
        { type: 'content_delta', text: 'partial' },
        { type: 'finish', finishReason: 'length' },
      ],
      `garbage ${garbage}`,
    )
  }
})

test('THE FIX end-to-end: collectDeepSeekStreamEvents records the bundled finishReason', async () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"content":"partial","tool_calls":[null]},"finish_reason":"length"}]}',
    'data: [DONE]',
  ])
  const result = await collectDeepSeekStreamEvents(eventsOf(...events))
  assert.equal(result.content, 'partial')
  // was null before the fix → isMaxOutputTokensTruncation false → recovery skipped
  assert.equal(result.finishReason, 'length')
})

test('a mix of a garbage and a real tool_call element: the real delta carries finish (no double)', () => {
  const events = parseDeepSeekSSELines([
    'data: {"choices":[{"delta":{"tool_calls":[null,{"index":0,"id":"t","function":{"name":"f","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
  ])
  assert.deepEqual(events, [
    { type: 'tool_call_delta', index: 0, id: 't', name: 'f', argumentsDelta: '{}', finishReason: 'tool_calls' },
  ])
})
