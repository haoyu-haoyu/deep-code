import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDeepSeekStreamError,
  parseDeepSeekSSELines,
} from '../src/services/providers/deepseek.mjs'

// mirrors the production isAbortError (deepseek.mjs) — the stream error must
// NEVER be classified as a cancellation, even if the server code is ABORT_ERR.
const isAbortError = e => e?.name === 'AbortError' || e?.code === 'ABORT_ERR'

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
