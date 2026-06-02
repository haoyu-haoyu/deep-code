import test from 'node:test'
import assert from 'node:assert/strict'

import {
  longestCommonPrefixLength,
  serializeRequestForCache,
  simulateDeepSeekPrefixCache,
  summarizePrefixCacheSimulation,
} from './helpers/cache-sim.mjs'
import {
  buildDeepSeekRequest,
  runDeepSeekAgent,
} from '../src/deepcode/deepseek-native.mjs'

// ── #2 — OFFLINE prefix-cache hit/miss simulation ───────────────────────────
// The live cache-e2e proves the moat against the real API (~93% token hit). The
// byte-stability invariant test proves the prefix does not drift. This file adds
// the missing ECONOMIC model: a deterministic offline simulation of DeepSeek's
// block-granular prefix cache, so a prefix regression shows up as a hit-rate
// COLLAPSE in CI (no API), and a legitimate prefix change is correctly a MISS.

// --- unit: the primitive ----------------------------------------------------

test('longestCommonPrefixLength counts the shared leading run', () => {
  assert.equal(longestCommonPrefixLength('abcdef', 'abcXYZ'), 3)
  assert.equal(longestCommonPrefixLength('same', 'same'), 4)
  assert.equal(longestCommonPrefixLength('', 'abc'), 0)
  assert.equal(longestCommonPrefixLength('abc', ''), 0)
  assert.equal(longestCommonPrefixLength('xyz', 'abc'), 0)
})

test('simulateDeepSeekPrefixCache: append-only growth hits the whole prior prefix (block-floored)', () => {
  const block = 4
  // Turn 0 cold; turns 1-2 each extend the prior request -> the entire prior
  // request is a cached prefix.
  const reqs = ['AAAABBBB', 'AAAABBBBCCCC', 'AAAABBBBCCCCDDDD']
  const sim = simulateDeepSeekPrefixCache(reqs, { blockChars: block })
  assert.equal(sim[0].hit, 0, 'cold start: all miss')
  assert.equal(sim[1].hit, 8, 'turn 1 hits the full 8-char prior request')
  assert.equal(sim[2].hit, 12, 'turn 2 hits the full 12-char prior request')
  const summary = summarizePrefixCacheSimulation(sim)
  assert.ok(summary.hitRate > 0.5, `aggregate hit rate should be high, got ${summary.hitRate}`)
})

test('simulateDeepSeekPrefixCache: a partial trailing block is NOT counted as a hit', () => {
  // LCP = 7 with block size 4 -> only floor(7/4)=1 block (4 chars) is a hit.
  const sim = simulateDeepSeekPrefixCache(['AAAABBB', 'AAAABBBxxxx'], { blockChars: 4 })
  assert.equal(sim[1].hit, 4, 'only the one whole block of the 7-char LCP is cached')
})

test('simulateDeepSeekPrefixCache: a divergent prefix collapses the hit to ~0', () => {
  const sim = simulateDeepSeekPrefixCache(['AAAAAAAA', 'ZZZZAAAA'], { blockChars: 4 })
  assert.equal(sim[1].hit, 0, 'no shared leading prefix -> full miss')
  assert.equal(sim[1].hitRate, 0)
})

test('simulateDeepSeekPrefixCache: rejects a non-positive block size', () => {
  assert.throws(() => simulateDeepSeekPrefixCache(['a'], { blockChars: 0 }), /positive integer/)
})

// --- unit: serializeRequestForCache lays out the exact cached-prefix order ---
// These pin the WHOLE contract by asserting the exact serialized string for a
// known body: a regression that drops, duplicates, reorders, or mis-places ANY
// component (partition / system / each tool / each message) changes the string
// and fails — so no "passes the markers but is wrong" serializer can exist.

test('serializeRequestForCache: no system -> partition, tools, then history, in order (transport fields omitted)', () => {
  const body = {
    model: 'deepseek-v4-pro',
    thinking: 'enabled',
    reasoning_effort: 'high',
    tools: [{ name: 'a' }, { name: 'b' }],
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ],
    stream: true, // a transport field that must NOT appear in the cached prefix
    max_tokens: 32, // ditto
  }
  const expected = [
    JSON.stringify({ model: 'deepseek-v4-pro', thinking: 'enabled', reasoning_effort: 'high' }),
    JSON.stringify(body.tools),
    JSON.stringify(body.messages[0]),
    JSON.stringify(body.messages[1]),
  ].join('\n')
  assert.equal(serializeRequestForCache(body), expected)
})

test('serializeRequestForCache: with a system message -> partition, system, tools, history', () => {
  const body = {
    model: 'm',
    tools: [{ name: 'a' }],
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
    ],
  }
  const expected = [
    JSON.stringify({ model: 'm', thinking: undefined, reasoning_effort: undefined }),
    JSON.stringify(body.messages[0]), // system, before tools
    JSON.stringify(body.tools),
    JSON.stringify(body.messages[1]), // history, after tools
  ].join('\n')
  assert.equal(serializeRequestForCache(body), expected)
})

// --- integration: a real multi-turn session simulates a high hit rate -------

// Capture the exact wire request of every tool turn from a real runDeepSeekAgent
// loop (same mechanism the byte-stability invariant test uses), then run the
// offline simulator over the serialized requests.
async function captureSessionRequests({ mutate } = {}) {
  const serialized = []
  let turn = 0
  await runDeepSeekAgent({
    prompt: 'begin the task',
    env: { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_CACHE_USER_ID: 'workspace-1' },
    // systemPrompt is an array of STRINGS (joined with \n\n); a large stable head
    // so the cached prefix dominates each turn's appended tail.
    systemPrompt: ['You are a stable-prefix coding agent. '.repeat(20)],
    tools: [
      {
        name: 'noop',
        description: 'a no-op tool used to force tool-call turns',
        inputJSONSchema: { type: 'object', properties: { step: { type: 'number' } }, required: [] },
        async execute() {
          return 'ok'
        },
      },
    ],
    maxTurns: 6,
    async complete(request) {
      turn++
      // `mutate` lets a test inject a prefix-breaking regression at a given turn.
      const body = mutate ? mutate(request.body, turn) : request.body
      serialized.push(serializeRequestForCache(body))
      if (turn <= 3) {
        return {
          content: '',
          reasoning: `reasoning step ${turn}`,
          finishReason: 'tool_calls',
          toolCalls: [
            { id: `call_${turn}`, type: 'function', function: { name: 'noop', arguments: `{"step":${turn}}` } },
          ],
        }
      }
      return { content: 'all done', reasoning: '', finishReason: 'stop', toolCalls: [] }
    },
  })
  return serialized
}

test('a real multi-turn session simulates a high offline prefix-cache hit rate (moat guard)', async () => {
  const reqs = await captureSessionRequests()
  assert.ok(reqs.length >= 3, `expected a multi-turn loop, got ${reqs.length}`)
  // blockChars:1 = char-exact prefix reuse — the tightest proxy for the
  // byte-stability moat (what fraction of each request is a byte-identical
  // prefix of a prior one). Block-granular flooring is unit-tested separately.
  const sim = simulateDeepSeekPrefixCache(reqs, { blockChars: 1 })

  // Turn 0 is a cold miss; every later turn re-sends the ENTIRE prior request
  // byte-identically (append-only), so its hit must equal the full prior length.
  assert.equal(sim[0].hit, 0)
  for (let i = 1; i < sim.length; i++) {
    assert.equal(
      sim[i].hit,
      sim[i - 1].total,
      `turn ${i}: the whole prior request must be a cached prefix (hit ${sim[i].hit} != prior total ${sim[i - 1].total})`,
    )
    assert.ok(
      sim[i].hitRate >= 0.7,
      `turn ${i} should ride a warm prefix cache, got hitRate=${sim[i].hitRate.toFixed(3)}`,
    )
  }
  // Secondary economic sanity check: the steady-state (post-cold-start)
  // aggregate hit rate is high. The per-turn `hit === prior.total` above is the
  // PRIMARY, exact invariant; this ratio just confirms the moat is economically
  // strong (threshold kept loose so it tracks the invariant, not the fixture).
  const steady = summarizePrefixCacheSimulation(sim.slice(1))
  assert.ok(
    steady.hitRate >= 0.75,
    `post-cold-start hit rate should be high, got ${steady.hitRate.toFixed(3)}`,
  )
})

// --- the MISS path: a legitimate / accidental prefix change ----------------

test('a timestamp leaking into the system prefix collapses the simulated hit rate (regression guard)', async () => {
  const clean = await captureSessionRequests()
  // Inject a per-turn-varying timestamp into the FIRST (system) message from
  // turn 2 onward — the classic prefix-cache regression. Each turn now has a
  // different cached prefix, so the cache can no longer be reused.
  const leaked = await captureSessionRequests({
    mutate: (body, turn) => {
      if (turn < 2) return body
      // PREPEND a per-turn timestamp to the head of the first (system) message:
      // a volatile value near position 0 of the prefix is what actually kills
      // the cache (a value APPENDED at the tail would leave the head reusable).
      const messages = body.messages.map((m, idx) =>
        idx === 0
          ? { ...m, content: `[ts=${turn}-${turn * 7919}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}` }
          : m,
      )
      return { ...body, messages }
    },
  })

  const cleanSteady = summarizePrefixCacheSimulation(simulateDeepSeekPrefixCache(clean, { blockChars: 1 }).slice(1))
  const leakedSteady = summarizePrefixCacheSimulation(simulateDeepSeekPrefixCache(leaked, { blockChars: 1 }).slice(1))

  assert.ok(cleanSteady.hitRate >= 0.8, `clean baseline should be warm, got ${cleanSteady.hitRate.toFixed(3)}`)
  assert.ok(
    leakedSteady.hitRate < 0.2,
    `a leaked-timestamp prefix must collapse the hit rate, got ${leakedSteady.hitRate.toFixed(3)}`,
  )
})

test('editing the HEAD of the system prefix is correctly a cache MISS (offline)', async () => {
  const env = { DEEPSEEK_API_KEY: 'sk-test' }
  const messages = [
    { role: 'user', content: 'do the task' },
    { role: 'assistant', content: 'working' },
    { role: 'user', content: 'continue' },
  ]
  const tail = 'stable system instructions '.repeat(20)
  const before = await buildDeepSeekRequest({ env, systemPrompt: [`ORIGINAL HEADER. ${tail}`], messages })
  // A change at the START of the system prompt (model swap, reworded header,
  // a tool list that lands early) diverges the prefix near position 0.
  const after = await buildDeepSeekRequest({ env, systemPrompt: [`REWORDED DIFFERENT HEADER. ${tail}`], messages })

  const sim = simulateDeepSeekPrefixCache(
    [serializeRequestForCache(before.body), serializeRequestForCache(after.body)],
    { blockChars: 1 },
  )
  assert.ok(
    sim[1].hitRate < 0.2,
    `changing the head of the system prefix must register as a miss, got ${sim[1].hitRate.toFixed(3)}`,
  )
})

test('a tool-manifest change busts the prefix from the tools onward (offline)', async () => {
  // Tools sit in the cached prefix AHEAD of the conversation history, so adding
  // a tool invalidates the whole conversation that follows it. The simulator
  // only catches this because serializeRequestForCache covers the tool manifest
  // (in prompt order), not just the messages — before the M1 fix this was an
  // invisible 1.0 "hit". Small system + substantial history makes the bust clear.
  const env = { DEEPSEEK_API_KEY: 'sk-test' }
  const systemPrompt = ['sys']
  const messages = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `conversation message number ${i} with enough body text to carry weight`,
  }))
  const mkTool = name => ({
    name,
    description: `the ${name} tool`,
    inputJSONSchema: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
  })

  const before = await buildDeepSeekRequest({ env, systemPrompt, messages, tools: [mkTool('read')] })
  const after = await buildDeepSeekRequest({ env, systemPrompt, messages, tools: [mkTool('read'), mkTool('write')] })

  // Sanity: the new tool really is on the wire body (so the test isn't vacuous).
  assert.ok(JSON.stringify(after.body).includes('write'), 'the added tool must be in the request body')

  const sim = simulateDeepSeekPrefixCache(
    [serializeRequestForCache(before.body), serializeRequestForCache(after.body)],
    { blockChars: 1 },
  )
  assert.ok(
    sim[1].hitRate < 0.5,
    `a tool change must bust the prefix from the tools onward, got ${sim[1].hitRate.toFixed(3)}`,
  )

  // The converse: an UNCHANGED toolset keeps the prefix fully warm (no false miss).
  const same = simulateDeepSeekPrefixCache(
    [serializeRequestForCache(before.body), serializeRequestForCache(before.body)],
    { blockChars: 1 },
  )
  assert.equal(same[1].hitRate, 1, 'an identical request must be a full cache hit')
})

test('with NO system prompt, a tool change still busts the prefix (integration, economic)', async () => {
  // The exact layout (tools before history with no system message) is pinned by
  // the serializeRequestForCache unit tests above. Here we confirm the cache
  // CONSEQUENCE end-to-end through the real buildDeepSeekRequest: because tools
  // precede the conversation, adding a tool invalidates the (large) first
  // history message, so the hit collapses — far below the ~0.6 a mis-ordered
  // serializer (history before tools) would leave cached.
  const env = { DEEPSEEK_API_KEY: 'sk-test' }
  const messages = [
    { role: 'user', content: 'first message body '.repeat(60) },
    ...Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: `no-system conversation message ${i} with body text`,
    })),
  ]
  const mkTool = name => ({
    name,
    description: `the ${name} tool`,
    inputJSONSchema: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
  })
  const before = await buildDeepSeekRequest({ env, messages, tools: [mkTool('read_tool')] })
  const after = await buildDeepSeekRequest({ env, messages, tools: [mkTool('read_tool'), mkTool('write_tool')] })
  assert.equal(before.body.messages[0].role, 'user', 'sanity: no system message at messages[0]')
  assert.ok(JSON.stringify(after.body).includes('write_tool'), 'the added tool must be on the wire')

  const sim = simulateDeepSeekPrefixCache(
    [serializeRequestForCache(before.body), serializeRequestForCache(after.body)],
    { blockChars: 1 },
  )
  assert.ok(
    sim[1].hitRate < 0.3,
    `a tool change must bust the no-system prefix incl. the first message, got ${sim[1].hitRate.toFixed(3)}`,
  )
})
