import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapMessagesToDeepSeek } from '../src/messages/deepseek-normalizer.mjs'
import { validateDeepSeekMessageContract } from '../src/messages/deepseek-contract.mjs'

// A property-based complement to the fixed 400-immunity matrix. The matrix pins
// named wedge cases; this explores the WHOLE realistic wedge space and asserts the
// invariant that matters: every transcript a real client can produce — including
// the ones a compaction, resume, or hard crash mangles — maps through
// mapMessagesToDeepSeek to a CONTRACT-VALID DeepSeek request (validated by the
// independent oracle). A future normalizer regression that breaks any repair path
// surfaces here as a violation, with the exact seed/input dumped to reproduce.
//
// Deterministic by construction: a seeded PRNG (per-iteration seed = BASE + i), no
// Math.random, no Date — so this is a normal BLOCKING test, never flaky, and any
// failure is reproducible by re-running the printed iteration alone.
//
// CRITICAL invariant of the GENERATOR: it only ever emits shapes the normalizer is
// SUPPOSED to repair. It never constructs the two shapes the normalizer
// deliberately does NOT repair (pinned in the matrix's Part C): a single tool
// turn's results split across messages by an intervening non-tool message
// (cross-message adjacency break), or two tool_calls sharing an id within one turn
// (intra-turn duplicate). Each generated tool turn has globally-unique ids and all
// of its surviving results live in one contiguous user message, so neither
// divergence can arise — a violation here is therefore always a real regression.

// mulberry32 — a tiny deterministic PRNG.
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
const chance = (rng, p) => rng() < p

function userText(text) {
  return { type: 'user', message: { content: [{ type: 'text', text }] } }
}

function userVision(rng, text) {
  const kind = pick(rng, ['image', 'document'])
  const mediaType = kind === 'image' ? pick(rng, ['image/png', 'image/jpeg']) : 'application/pdf'
  const content = [{ type: kind, source: { media_type: mediaType, data: 'BLOB_DO_NOT_SERIALIZE' } }]
  if (chance(rng, 0.7)) content.push({ type: 'text', text })
  return { type: 'user', message: { content } }
}

function assistantText(rng, text) {
  const content = []
  if (chance(rng, 0.5)) content.push({ type: 'thinking', thinking: 'reasoning ' + text })
  content.push({ type: 'text', text })
  return { type: 'assistant', message: { content } }
}

function assistantTools(ids, { withThinking, withText }) {
  const content = []
  if (withThinking) content.push({ type: 'thinking', thinking: 'plan' })
  if (withText) content.push({ type: 'text', text: 'working' })
  for (const id of ids) {
    content.push({ type: 'tool_use', id, name: pick0(id), input: { q: id } })
  }
  return { type: 'assistant', message: { content } }
}

function pick0(id) {
  // a stable name derived from the id (no rng needed; name is contract-irrelevant)
  return ['read', 'grep', 'bash', 'edit'][id.length % 4]
}

// The content of one tool_result. Usually a plain string, but sometimes an ARRAY
// carrying a non-text block (a tool that returns a screenshot/PDF) — the ONLY shape
// that drives stringifyToolResultContent's per-block path, whose describeNonTextBlock
// elision a regression would replace with JSON.stringify(block), serializing the raw
// base64 blob into the prompt. The leak assertion can only catch that regression if
// this shape is actually generated, so we count it for a non-vacuousness check.
function toolResultContent(rng, id, counters) {
  if (chance(rng, 0.25)) {
    counters.visionInToolResult++
    const kind = pick(rng, ['image', 'document'])
    const mediaType = kind === 'image' ? pick(rng, ['image/png', 'image/jpeg']) : 'application/pdf'
    return [
      { type: kind, source: { media_type: mediaType, data: 'BLOB_DO_NOT_SERIALIZE' } },
      { type: 'text', text: 'tool out ' + id },
    ]
  }
  return 'result ' + id
}

// Results that SURVIVE mapping (clean / dangling-kept) — vision-capable so the
// blob-leak path through a live tool message is exercised.
function userResults(rng, ids, counters) {
  return {
    type: 'user',
    message: {
      content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: toolResultContent(rng, id, counters) })),
    },
  }
}

// Orphan results are DROPPED by dropOrphanToolMessages, so their content never
// reaches the wire — keep them plain strings (vision here would be dead coverage).
function orphanResults(ids) {
  return {
    type: 'user',
    message: { content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'result ' + id })) },
  }
}

// tool_result(s) AND trailing text in ONE user message (the within-message
// adjacency case the normalizer repairs by ordering text after the tool results).
function userResultsPlusText(rng, ids, text, counters) {
  return {
    type: 'user',
    message: {
      content: [
        ...ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: toolResultContent(rng, id, counters) })),
        { type: 'text', text },
      ],
    },
  }
}

// A non-empty proper subset of ids (size 1..n-1), order preserved.
function properSubset(rng, ids) {
  const kept = ids.filter(() => chance(rng, 0.5))
  if (kept.length === 0) return [ids[0]]
  if (kept.length === ids.length) return ids.slice(0, ids.length - 1)
  return kept
}

function genTranscript(rng, counters) {
  const msgs = []
  let idSeq = 0
  const nTurns = 1 + Math.floor(rng() * 8)
  for (let t = 0; t < nTurns; t++) {
    const roll = rng()
    if (roll < 0.22) {
      msgs.push(userText(`u${t}`))
    } else if (roll < 0.37) {
      counters.vision++
      msgs.push(userVision(rng, `look at this ${t}`))
    } else if (roll < 0.5) {
      msgs.push(assistantText(rng, `a${t}`))
    } else {
      // a tool turn: assistant opens K unique calls, then a corruption decides
      // which (if any) results come back — every variant is normalizer-repairable.
      const k = 1 + Math.floor(rng() * 3)
      const ids = []
      for (let j = 0; j < k; j++) ids.push(`call_${t}_${idSeq++}`)
      const opener = assistantTools(ids, {
        withThinking: chance(rng, 0.5),
        withText: chance(rng, 0.5),
      })
      const corruption = pick(rng, [
        'clean',
        'clean',
        'orphan',
        'dangling',
        'all_dangling',
        'adjacency',
      ])
      if (corruption === 'orphan') {
        // the opener was summarized away by a compaction; its results remain
        counters.orphan++
        msgs.push(orphanResults(ids))
      } else if (corruption === 'dangling' && k > 1) {
        counters.dangling++
        msgs.push(opener)
        msgs.push(userResults(rng, properSubset(rng, ids), counters))
      } else if (corruption === 'all_dangling') {
        counters.allDangling++
        msgs.push(opener)
        // no results at all
      } else if (corruption === 'adjacency') {
        counters.adjacency++
        msgs.push(opener)
        msgs.push(userResultsPlusText(rng, ids, `and then ${t}`, counters))
      } else {
        // includes the k===1 'dangling' roll: a single-call turn has no proper
        // subset to drop, so it falls through to a fully-paired clean turn (and is
        // counted as clean, not dangling — counters.dangling counts EMITTED
        // dangling shapes, not how often 'dangling' was rolled).
        counters.clean++
        msgs.push(opener)
        msgs.push(userResults(rng, ids, counters))
      }
    }
    if (chance(rng, 0.1)) {
      counters.nullMsg++
      msgs.push(chance(rng, 0.5) ? null : { type: 'user', message: { content: [] } })
    }
  }
  // a compaction can also lop off a leading run of turns — which only ever strands
  // tool results as orphans (the opener precedes its results), never a dangling.
  if (chance(rng, 0.3) && msgs.length > 2) {
    counters.prefixDrop++
    msgs.splice(0, 1 + Math.floor(rng() * Math.min(3, msgs.length - 1)))
  }
  return msgs
}

test('fuzz: every realistic transcript maps to a contract-valid DeepSeek request', () => {
  const BASE_SEED = 0x5eed1234
  const ITERATIONS = 3000
  const counters = {
    clean: 0,
    orphan: 0,
    dangling: 0,
    allDangling: 0,
    adjacency: 0,
    vision: 0,
    visionInToolResult: 0,
    prefixDrop: 0,
    nullMsg: 0,
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const seed = (BASE_SEED + i) >>> 0
    const rng = makeRng(seed)
    const transcript = genTranscript(rng, counters)
    const reasoningReplay = chance(rng, 0.5)
    const mapped = mapMessagesToDeepSeek(transcript, { reasoningReplay })
    const verdict = validateDeepSeekMessageContract(mapped)
    if (!verdict.valid) {
      assert.fail(
        `contract violation at iteration ${i} (seed 0x${seed.toString(16)}, reasoningReplay=${reasoningReplay})\n` +
          `violations: ${JSON.stringify(verdict.violations)}\n` +
          `transcript: ${JSON.stringify(transcript)}\n` +
          `mapped: ${JSON.stringify(mapped)}`,
      )
    }
    // No base64 blob from a vision block ever reaches the wire.
    for (const m of mapped) {
      if (typeof m.content === 'string') {
        assert.ok(
          !m.content.includes('BLOB_DO_NOT_SERIALIZE'),
          `vision base64 leaked into the prompt at iteration ${i} (seed 0x${seed.toString(16)})`,
        )
      }
    }
  }

  // Non-vacuousness: the generator must actually have EXERCISED each repair path,
  // otherwise a green run proves nothing. (These thresholds are far below the
  // expected counts over 3000 iterations; they only guard against a degenerate
  // generator, not against statistical drift.)
  for (const [path, count] of Object.entries(counters)) {
    assert.ok(count > 0, `fuzz never exercised the "${path}" path — generator is degenerate`)
  }
})

test('fuzz: the generator NEVER emits the known un-repaired divergences', () => {
  // A guard on the generator itself: if a future edit accidentally makes it
  // produce a cross-message adjacency split or an intra-turn duplicate id, the
  // "every transcript is valid" test above would start flagging real divergences
  // as if they were regressions. Assert the generator's output is free of both so
  // a fuzz failure can only ever mean a true normalizer regression.
  const BASE_SEED = 0x5eed1234
  for (let i = 0; i < 3000; i++) {
    const rng = makeRng((BASE_SEED + i) >>> 0)
    const counters = {
      clean: 0, orphan: 0, dangling: 0, allDangling: 0, adjacency: 0, vision: 0, visionInToolResult: 0, prefixDrop: 0, nullMsg: 0,
    }
    const mapped = mapMessagesToDeepSeek(genTranscript(rng, counters))

    // (1) no intra-turn duplicate tool_call id. The normalizer never INTRODUCES a
    // duplicate (its passes only drop), so a dup in the mapped output can only come
    // from the generator — this is a clean generator-only guard.
    for (const m of mapped) {
      if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        const ids = m.tool_calls.map(c => c.id)
        assert.equal(new Set(ids).size, ids.length, `duplicate tool_call id at iteration ${i}`)
      }
    }
    // (2) every run of tool messages is immediately preceded by the assistant
    // tool_calls it answers — no non-tool message interrupting a turn's results.
    // NOTE: this adjacency is produced jointly by the generator (never splitting a
    // turn's results) AND the normalizer's text-after-tool repair, so a failure
    // here can indicate EITHER a generator divergence OR a normalizer adjacency
    // regression. Test 1 (the oracle) is the primary normalizer fence; this is a
    // tripwire that the property holds at all.
    for (let j = 0; j < mapped.length; j++) {
      const m = mapped[j]
      if (m && typeof m === 'object' && m.role === 'tool') {
        const prev = mapped[j - 1]
        assert.ok(
          prev && (prev.role === 'tool' || (prev.role === 'assistant' && Array.isArray(prev.tool_calls))),
          `tool message not adjacent to its opener at iteration ${i}, position ${j} (generator split OR normalizer adjacency regression)`,
        )
      }
    }
  }
})
