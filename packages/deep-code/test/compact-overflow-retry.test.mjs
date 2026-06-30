import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { truncateMessagesHeadForCompact } from '../src/deepcode/truncateMessagesHeadForCompact.mjs'
import {
  planCompactOverflowRetry,
  MAX_COMPACT_OVERFLOW_RETRIES,
} from '../src/deepcode/planCompactOverflowRetry.mjs'
import { compactDeepCodeConversation } from '../src/deepcode/compact.mjs'

const OVERFLOW_MESSAGE =
  "DeepSeek API 400: This model's maximum context length is 65536 tokens. " +
  'However, your messages resulted in 999999 tokens. Please reduce the length of the messages.'

function overflowError() {
  const e = new Error(OVERFLOW_MESSAGE)
  e.status = 400
  return e
}

// ---- leaf: truncateMessagesHeadForCompact ----

test('truncateMessagesHeadForCompact drops the older half, keeping the tail', () => {
  assert.deepEqual(truncateMessagesHeadForCompact(['a', 'b', 'c', 'd']), ['c', 'd'])
  assert.deepEqual(truncateMessagesHeadForCompact(['a', 'b', 'c', 'd', 'e']), ['d', 'e'])
  assert.deepEqual(truncateMessagesHeadForCompact(['a', 'b', 'c']), ['c'])
  assert.deepEqual(truncateMessagesHeadForCompact(['a', 'b']), ['b'])
})

test('truncateMessagesHeadForCompact returns null when nothing more can be dropped', () => {
  assert.equal(truncateMessagesHeadForCompact(['only']), null)
  assert.equal(truncateMessagesHeadForCompact([]), null)
  assert.equal(truncateMessagesHeadForCompact(null), null)
})

test('repeated truncation converges to a single message (guaranteed progress)', () => {
  let tail = Array.from({ length: 100 }, (_, i) => i)
  let steps = 0
  while (tail.length > 1) {
    tail = truncateMessagesHeadForCompact(tail)
    steps++
    assert.ok(steps <= 10, 'should converge in O(log n) steps')
  }
  assert.deepEqual(tail, [99]) // the most recent message survives
})

// ---- leaf: planCompactOverflowRetry ----

test('planCompactOverflowRetry truncates on a context-overflow error', () => {
  const out = planCompactOverflowRetry(overflowError(), ['a', 'b', 'c', 'd'], 0)
  assert.deepEqual(out, ['c', 'd'])
})

test('planCompactOverflowRetry returns null for a non-overflow error (must propagate)', () => {
  const e = new Error('DeepSeek API 500: internal server error')
  assert.equal(planCompactOverflowRetry(e, ['a', 'b', 'c', 'd'], 0), null)
})

test('planCompactOverflowRetry returns null once retries are exhausted', () => {
  assert.equal(
    planCompactOverflowRetry(overflowError(), ['a', 'b'], MAX_COMPACT_OVERFLOW_RETRIES),
    null,
  )
})

test('planCompactOverflowRetry returns null when a single message still overflows', () => {
  assert.equal(planCompactOverflowRetry(overflowError(), ['only'], 0), null)
})

// ---- integration: compactDeepCodeConversation retry loop ----

function mockProvider({ overflowAttempts }) {
  const contentLengths = []
  let attempt = 0
  const provider = {
    supports: () => false,
    buildRequest: async ctx => ctx,
    streamQuery(req) {
      contentLengths.push(req.messages[0].content.length)
      const myAttempt = attempt++
      return (async function* () {
        if (myAttempt < overflowAttempts) throw overflowError()
        yield { type: 'content_delta', text: 'SUMMARY of the recent tail' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    },
  }
  return { provider, contentLengths, calls: () => attempt }
}

const messages = Array.from({ length: 8 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: `message number ${i} with some content to serialize`,
}))
const stablePrefix = { systemPrompt: ['sys'], prefixHash: 'h0' }
const baseArgs = { messages, stablePrefix, env: {}, cwd: tmpdir() }

test('compactDeepCodeConversation recovers from overflow by retrying on a truncated tail', async () => {
  const m = mockProvider({ overflowAttempts: 2 })
  const result = await compactDeepCodeConversation({ ...baseArgs, provider: m.provider })
  // recovered: produced a real summary instead of wedging
  assert.equal(result.summary, 'SUMMARY of the recent tail')
  assert.deepEqual(result.messages, [
    { role: 'user', content: 'Compacted conversation summary:\nSUMMARY of the recent tail' },
  ])
  // retried exactly twice then succeeded; each retry shrank the serialized prompt
  assert.equal(m.calls(), 3)
  assert.ok(
    m.contentLengths[0] > m.contentLengths[1] && m.contentLengths[1] > m.contentLengths[2],
    `prompt should shrink across retries, got ${m.contentLengths}`,
  )
})

test('compactDeepCodeConversation gives up (throws) when even a single message overflows — bounded, no infinite loop', async () => {
  const m = mockProvider({ overflowAttempts: Infinity })
  await assert.rejects(
    () => compactDeepCodeConversation({ ...baseArgs, provider: m.provider }),
    /maximum context length/,
  )
  // 8 -> 4 -> 2 -> 1 -> (null): four attempts, then surfaces the overflow
  assert.equal(m.calls(), 4)
})

test('compactDeepCodeConversation does NOT retry on a non-overflow error', async () => {
  const m = {
    provider: {
      supports: () => false,
      buildRequest: async ctx => ctx,
      streamQuery() {
        return (async function* () {
          throw new Error('DeepSeek API 500: internal server error')
          // eslint-disable-next-line no-unreachable
          yield {}
        })()
      },
    },
  }
  let calls = 0
  const counting = {
    ...m.provider,
    streamQuery: (...a) => {
      calls++
      return m.provider.streamQuery(...a)
    },
  }
  await assert.rejects(
    () => compactDeepCodeConversation({ ...baseArgs, provider: counting }),
    /500/,
  )
  assert.equal(calls, 1) // surfaced immediately, no truncation/retry
})
