import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapMessagesToDeepSeek } from '../src/messages/deepseek-normalizer.mjs'
import {
  validateDeepSeekMessageContract,
  DEEPSEEK_CONTRACT_VIOLATIONS as V,
} from '../src/messages/deepseek-contract.mjs'

// A DeepSeek 400 on a tool-pairing/shape fault is a *permanent* session wedge:
// the offending message stays in the transcript and re-fails every subsequent
// turn. mapMessagesToDeepSeek is the single convergence point that repairs these
// shapes at request-build time. This matrix pins that contract two ways:
//
//   Part A — the oracle is NON-VACUOUS: it must actually FLAG each 400 shape on a
//            hand-built request, otherwise a green matrix proves nothing.
//   Part B — the IMMUNITY MATRIX: each named rival-failure-mode transcript, run
//            through mapMessagesToDeepSeek, must produce a contract-valid request.
//
// If the normalizer ever regresses on a repair (orphan/dangling/adjacency/vision),
// the matching matrix row goes red.

const codes = result => result.violations.map(v => v.code)

// ─────────────────────────────────────────────────────────────────────────────
// Part A — the oracle catches what it claims to catch (non-vacuousness)
// ─────────────────────────────────────────────────────────────────────────────

test('oracle: a well-formed request is valid', () => {
  const ok = validateDeepSeekMessageContract([
    { role: 'system', content: 'you are a tool' },
    { role: 'user', content: 'run noop' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', content: 'done' },
  ])
  assert.deepEqual(ok, { valid: true, violations: [] })
})

test('oracle: a multi-tool turn answered out of order is valid (order-insensitive)', () => {
  const ok = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'f', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'g', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'b', content: 'B' },
    { role: 'tool', tool_call_id: 'a', content: 'A' },
  ])
  assert.equal(ok.valid, true)
})

test('oracle: flags an orphan tool result (no opening assistant)', () => {
  const r = validateDeepSeekMessageContract([
    { role: 'user', content: 'hi' },
    { role: 'tool', tool_call_id: 'ghost', content: 'orphaned' },
  ])
  assert.equal(r.valid, false)
  assert.ok(codes(r).includes(V.ORPHAN_TOOL_RESULT))
})

test('oracle: flags a dangling assistant tool_call (never answered)', () => {
  const r = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
      ],
    },
    { role: 'user', content: 'never sent the result' },
  ])
  assert.equal(r.valid, false)
  assert.ok(codes(r).includes(V.DANGLING_TOOL_CALL))
  // reported at the opening assistant (index 0), not the boundary
  assert.equal(r.violations.find(v => v.code === V.DANGLING_TOOL_CALL).index, 0)
})

test('oracle: flags a tool result stranded when a non-tool message broke the run', () => {
  // assistant opens a+b; a is answered, then a user message intervenes before b's
  // result — DeepSeek rejects the broken adjacency. The SM reports BOTH the
  // unanswered b (dangling at the opener) and the stranded b result (orphan).
  const r = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'f', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'g', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: 'A' },
    { role: 'user', content: 'interrupt' },
    { role: 'tool', tool_call_id: 'b', content: 'B' },
  ])
  assert.equal(r.valid, false)
  assert.ok(codes(r).includes(V.DANGLING_TOOL_CALL))
  assert.ok(codes(r).includes(V.ORPHAN_TOOL_RESULT))
})

test('oracle: flags a dangling call left open at end-of-list', () => {
  const r = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
      ],
    },
  ])
  assert.equal(r.valid, false)
  assert.deepEqual(codes(r), [V.DANGLING_TOOL_CALL])
})

test('oracle: flags malformed tool_calls (missing id, bad type, non-string arguments)', () => {
  const missingId = validateDeepSeekMessageContract([
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'f', arguments: '{}' } }] },
  ])
  assert.ok(codes(missingId).includes(V.TOOL_CALL_MALFORMED))
  // missing id is untrackable → must NOT also be reported as dangling
  assert.ok(!codes(missingId).includes(V.DANGLING_TOOL_CALL))

  const badArgs = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: { not: 'a string' } } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
  ])
  assert.ok(codes(badArgs).includes(V.TOOL_CALL_MALFORMED))
})

test('oracle: flags duplicate tool_call ids within one assistant turn', () => {
  const r = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'dup', type: 'function', function: { name: 'f', arguments: '{}' } },
        { id: 'dup', type: 'function', function: { name: 'g', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'dup', content: 'x' },
  ])
  assert.ok(codes(r).includes(V.DUPLICATE_TOOL_CALL_ID))
})

test('oracle: flags a tool result with a missing id or non-string content', () => {
  const noId = validateDeepSeekMessageContract([
    { role: 'tool', tool_call_id: '', content: 'x' },
  ])
  assert.ok(codes(noId).includes(V.TOOL_RESULT_MISSING_ID))

  const badContent = validateDeepSeekMessageContract([
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: { obj: true } },
  ])
  assert.ok(codes(badContent).includes(V.TOOL_RESULT_CONTENT_NOT_STRING))
})

test('oracle: flags an invalid role and a null hole', () => {
  const r = validateDeepSeekMessageContract([
    { role: 'function', content: 'legacy role' },
    null,
  ])
  assert.ok(codes(r).includes(V.INVALID_ROLE))
  assert.ok(codes(r).includes(V.NULL_MESSAGE))
})

test('oracle: non-array input is invalid, not a throw', () => {
  assert.deepEqual(validateDeepSeekMessageContract(undefined), { valid: false, violations: [] })
  assert.equal(validateDeepSeekMessageContract({ role: 'user' }).valid, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// Part B — the 400-immunity matrix: rival-failure-mode transcripts must map clean
// ─────────────────────────────────────────────────────────────────────────────

// Each row: a transcript shaped like one of the failure modes that 400s rival
// DeepSeek code assistants (and once wedged ours, see the survey history), plus
// an extra structural assertion documenting WHAT the normalizer did to repair it.
const MATRIX = [
  {
    name: 'thinking + multi-tool turn (reasoning replay, both calls paired)',
    input: [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'I should read then grep' },
            { type: 'tool_use', id: 'call_a', name: 'read', input: { path: 'a' } },
            { type: 'tool_use', id: 'call_b', name: 'grep', input: { q: 'x' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'call_a', content: 'file a' },
            { type: 'tool_result', tool_use_id: 'call_b', content: 'match' },
          ],
        },
      },
    ],
    extra: mapped => {
      const a = mapped.find(m => m.role === 'assistant')
      assert.equal(a.tool_calls.length, 2, 'both calls preserved')
      assert.ok(a.reasoning_content, 'reasoning replayed on a tool-call turn')
      assert.equal(mapped.filter(m => m.role === 'tool').length, 2)
    },
  },
  {
    name: 'resume-after-crash: multi-tool turn with only some results persisted (dangling)',
    input: [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'call_x', name: 'bash', input: {} },
            { type: 'tool_use', id: 'call_y', name: 'read', input: {} },
          ],
        },
      },
      // only X's result reached disk before the hard crash
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_x', content: 'X done' }] },
      },
    ],
    extra: mapped => {
      const a = mapped.find(m => m.role === 'assistant')
      assert.deepEqual(
        a.tool_calls.map(c => c.id),
        ['call_x'],
        'the dangling call_y is dropped, the paired call_x is kept',
      )
    },
  },
  {
    name: 'all-calls-dangling: turn abandoned with zero results (strip tool_calls)',
    input: [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: "I'll run both" },
            { type: 'thinking', thinking: 'plan' },
            { type: 'tool_use', id: 'call_a', name: 'f', input: {} },
            { type: 'tool_use', id: 'call_b', name: 'g', input: {} },
          ],
        },
      },
      { type: 'user', message: { content: [{ type: 'text', text: 'actually nevermind' }] } },
    ],
    extra: mapped => {
      const a = mapped.find(m => m.role === 'assistant')
      assert.equal(a.tool_calls, undefined, 'all calls dangled → tool_calls stripped')
      assert.equal(a.reasoning_content, undefined, 'reasoning that rode the calls is stripped too')
      assert.equal(a.content, "I'll run both", 'the assistant text turn survives')
    },
  },
  {
    name: 'orphan tool_result: compaction summarized away the opening assistant',
    input: [
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'summarized_away', content: 'orphan' }],
        },
      },
      { type: 'user', message: { content: [{ type: 'text', text: 'continue' }] } },
    ],
    extra: mapped => {
      assert.equal(mapped.filter(m => m.role === 'tool').length, 0, 'orphan dropped')
      assert.ok(mapped.some(m => m.role === 'user' && m.content === 'continue'))
    },
  },
  {
    name: 'adjacency: a user turn carrying BOTH a tool_result and trailing text',
    input: [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call_1', name: 'noop', input: {} }] } },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'ok' },
            { type: 'text', text: 'and also do X' },
          ],
        },
      },
    ],
    extra: mapped => {
      // the synthesized user text must land AFTER the tool message, never between
      // the assistant tool_calls and its result (that intervening user 400s).
      const toolIdx = mapped.findIndex(m => m.role === 'tool')
      const userIdx = mapped.findIndex(m => m.role === 'user' && m.content === 'and also do X')
      assert.ok(toolIdx >= 0 && userIdx > toolIdx, 'tool result precedes the trailing user text')
    },
  },
  {
    name: 'compaction-straddle: orphan result, then a fresh paired turn',
    input: [
      // kept tail begins with an orphan (its opener is in the summary) ...
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'gone', content: 'orphan' }] } },
      // ... immediately followed by a clean, fully-paired tool turn
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call_2', name: 'noop', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'ok' }] } },
    ],
    extra: mapped => {
      const toolMsgs = mapped.filter(m => m.role === 'tool')
      assert.deepEqual(toolMsgs.map(m => m.tool_call_id), ['call_2'], 'only the paired result survives')
    },
  },
  {
    name: 'vision: an image block in a user turn (text-only model)',
    input: [
      {
        type: 'user',
        message: {
          content: [
            { type: 'image', source: { media_type: 'image/png', data: 'BASE64BOMB' } },
            { type: 'text', text: 'what is this?' },
          ],
        },
      },
    ],
    extra: mapped => {
      const u = mapped.find(m => m.role === 'user')
      assert.ok(u.content.includes('[image omitted'), 'image elided to a placeholder')
      assert.ok(!u.content.includes('BASE64BOMB'), 'the base64 blob is NOT serialized into the prompt')
      assert.ok(u.content.includes('what is this?'))
    },
  },
  {
    name: 'vision: an image-only user turn does not vanish',
    input: [
      { type: 'user', message: { content: [{ type: 'image', source: { media_type: 'image/jpeg', data: 'X' } }] } },
    ],
    extra: mapped => {
      assert.equal(mapped.length, 1)
      assert.ok(mapped[0].content.includes('[image omitted'), 'image-only turn still produces a non-empty user message')
    },
  },
  {
    name: 'vision: a document (PDF) block in a user turn (same elision path as image)',
    input: [
      {
        type: 'user',
        message: {
          content: [
            { type: 'document', source: { media_type: 'application/pdf', data: 'PDFBOMB' } },
            { type: 'text', text: 'summarize this' },
          ],
        },
      },
    ],
    extra: mapped => {
      const u = mapped.find(m => m.role === 'user')
      assert.ok(u.content.includes('[document omitted'), 'document elided to a placeholder')
      assert.ok(!u.content.includes('PDFBOMB'), 'the base64 blob is NOT serialized into the prompt')
      assert.ok(u.content.includes('summarize this'))
    },
  },
  {
    name: 'openai-style tool message carried as role:tool with array content',
    input: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c9', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      {
        role: 'tool',
        tool_call_id: 'c9',
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'image', source: { media_type: 'image/png', data: 'BLOB' } },
        ],
      },
    ],
    extra: mapped => {
      const t = mapped.find(m => m.role === 'tool')
      assert.equal(typeof t.content, 'string', 'tool content stringified')
      assert.ok(!t.content.includes('BLOB'), 'image in tool result not serialized as base64')
    },
  },
]

for (const row of MATRIX) {
  test(`immunity: ${row.name}`, () => {
    const mapped = mapMessagesToDeepSeek(row.input)
    const verdict = validateDeepSeekMessageContract(mapped)
    assert.deepEqual(
      verdict.violations,
      [],
      `contract violations: ${JSON.stringify(verdict.violations)}`,
    )
    assert.equal(verdict.valid, true)
    if (row.extra) row.extra(mapped)
  })
}

test('immunity: reasoningReplay:false still produces a contract-valid request', () => {
  const mapped = mapMessagesToDeepSeek(
    [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'plan' },
            { type: 'tool_use', id: 'c1', name: 'f', input: {} },
          ],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] } },
    ],
    { reasoningReplay: false },
  )
  assert.equal(validateDeepSeekMessageContract(mapped).valid, true)
  assert.equal(mapped.find(m => m.role === 'assistant').reasoning_content, undefined)
})

test('immunity: an empty transcript maps to an empty, trivially-valid request', () => {
  assert.deepEqual(mapMessagesToDeepSeek([]), [])
  assert.equal(validateDeepSeekMessageContract([]).valid, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// Part C — DIVERGENCE: shapes the normalizer does NOT repair, where the oracle is
// intentionally STRICTER. These are real DeepSeek-400 causes whose source
// transcript is itself already malformed (a well-formed client never produces
// them), so they are out of mapMessagesToDeepSeek's repair scope — its two
// global, set-based passes (dropOrphanToolMessages / dropDanglingToolCalls) only
// reason about whether an id was produced/answered, never about adjacency or
// intra-turn uniqueness. We pin them here so (1) the oracle's extra strictness is
// the documented contract a future wedge fuzzer relies on, and (2) if the
// normalizer ever DOES start repairing one of these, this row goes red and forces
// a deliberate decision rather than a silent behavior change.
// ─────────────────────────────────────────────────────────────────────────────

test('divergence: cross-message adjacency break is NOT repaired (oracle flags it)', () => {
  // One assistant turn opens a+b; a is answered, then a user message lands before
  // b's result. The result of b now arrives after a non-tool message broke the
  // run — DeepSeek 400s this, and the normalizer maps it straight through
  // (assistant[a,b] | tool(a) | user | tool(b)) because both ids were produced and
  // answered somewhere. Only an already-400 source transcript splits one turn's
  // results across user messages like this.
  const mapped = mapMessagesToDeepSeek([
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'a', name: 'f', input: {} },
          { type: 'tool_use', id: 'b', name: 'g', input: {} },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'A' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'interrupt' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'B' }] } },
  ])
  assert.deepEqual(
    mapped.map(m => m.role),
    ['assistant', 'tool', 'user', 'tool'],
    'normalizer leaves the broken adjacency as-is',
  )
  const verdict = validateDeepSeekMessageContract(mapped)
  assert.equal(verdict.valid, false)
  assert.deepEqual(
    codes(verdict).sort(),
    [V.DANGLING_TOOL_CALL, V.ORPHAN_TOOL_RESULT].sort(),
    'b is reported both as dangling (unanswered before the boundary) and orphan (its stranded result)',
  )
})

test('divergence: an intra-turn duplicate tool_use id is NOT deduped (oracle flags it)', () => {
  // A single assistant turn carrying two tool_use blocks with the same id. The
  // normalizer does not dedupe within a turn (both ids were produced and the one
  // result pairs), so it passes through and DeepSeek cannot route a result
  // deterministically. The oracle flags the duplicate.
  const mapped = mapMessagesToDeepSeek([
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'dup', name: 'f', input: {} },
          { type: 'tool_use', id: 'dup', name: 'g', input: {} },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'dup', content: 'X' }] } },
  ])
  assert.deepEqual(
    mapped.find(m => m.role === 'assistant').tool_calls.map(c => c.id),
    ['dup', 'dup'],
    'normalizer keeps both same-id calls',
  )
  const verdict = validateDeepSeekMessageContract(mapped)
  assert.equal(verdict.valid, false)
  assert.ok(codes(verdict).includes(V.DUPLICATE_TOOL_CALL_ID))
})
