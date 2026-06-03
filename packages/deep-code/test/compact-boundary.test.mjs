import test from 'node:test'
import assert from 'node:assert/strict'

import {
  messageIsToolResult,
  alignCompactBoundaryBackward,
} from '../src/services/compact/compactBoundary.mjs'

// ── compaction boundary alignment (cache-moat + DeepSeek tool-pairing) ────────
// A keep/summarize split that lands between an assistant tool_use and its
// tool_result orphans the result (breaks DeepSeek pairing) and mutates the
// stable prefix (collapses the prompt-cache moat). alignCompactBoundaryBackward
// walks the boundary back off tool_result messages so the pair stays together.

// message builders
const U = (...content) => ({ type: 'user', message: { content } })
const A = (...content) => ({ type: 'assistant', message: { content } })
const txt = { type: 'text', text: 'hi' }
const tu = id => ({ type: 'tool_use', id })
const tr = id => ({ type: 'tool_result', tool_use_id: id })

// --- messageIsToolResult -----------------------------------------------------

test('messageIsToolResult: only a user message bearing a tool_result block', () => {
  assert.equal(messageIsToolResult(U(tr('a'))), true)
  assert.equal(messageIsToolResult(U(txt, tr('a'))), true) // mixed → still a tool_result msg
  assert.equal(messageIsToolResult(U(txt)), false) // plain user prompt
  assert.equal(messageIsToolResult(A(tu('a'))), false) // assistant tool_use, not result
  assert.equal(messageIsToolResult(A(txt)), false)
  assert.equal(messageIsToolResult({ type: 'user', message: { content: 'str' } }), false)
  assert.equal(messageIsToolResult(undefined), false)
  assert.equal(messageIsToolResult({ type: 'progress' }), false)
})

// --- alignCompactBoundaryBackward --------------------------------------------

// 0:U(prompt) 1:A(tu a) 2:U(tr a) 3:A(text) 4:U(prompt2) 5:A(tu b,c) 6:U(tr b) 7:U(tr c) 8:A(text2)
const MSGS = [
  U(txt), A(tu('a')), U(tr('a')), A(txt), U(txt), A(tu('b'), tu('c')), U(tr('b')), U(tr('c')), A(txt),
]

test('walks the boundary back off a tool_result onto its assistant tool_use', () => {
  assert.equal(alignCompactBoundaryBackward(MSGS, 2), 1) // tr a → assistant a
  // multi tool_use: two consecutive tool_results walk back over BOTH to the assistant
  assert.equal(alignCompactBoundaryBackward(MSGS, 7), 5) // tr c → tr b → assistant(b,c)
  assert.equal(alignCompactBoundaryBackward(MSGS, 6), 5) // tr b → assistant(b,c)
})

test('leaves a clean boundary unchanged (assistant / plain user prompt)', () => {
  assert.equal(alignCompactBoundaryBackward(MSGS, 1), 1) // on assistant tool_use
  assert.equal(alignCompactBoundaryBackward(MSGS, 3), 3) // on assistant text
  assert.equal(alignCompactBoundaryBackward(MSGS, 4), 4) // on a plain user prompt
  assert.equal(alignCompactBoundaryBackward(MSGS, 8), 8) // on assistant text
  assert.equal(alignCompactBoundaryBackward(MSGS, 0), 0) // index 0 guard
})

test('degenerate: all-tool_results from 1 walk back to 0 (guard stops there)', () => {
  const m = [U(txt), U(tr('a')), U(tr('b'))]
  assert.equal(alignCompactBoundaryBackward(m, 2), 0)
})

// --- the invariant: after alignment, neither side splits a tool pair ---------

test("INVARIANT: 'up_to' kept tail (slice(aligned)) never starts with an orphan tool_result", () => {
  for (let p = 0; p <= MSGS.length; p++) {
    const a = alignCompactBoundaryBackward(MSGS, p)
    const keptTail = MSGS.slice(a)
    assert.equal(messageIsToolResult(keptTail[0]) && a > 0, false, `pivot ${p}→${a}: kept tail must not begin with a tool_result`)
  }
})

test("INVARIANT: 'from' kept head (slice(0,aligned)) never ends with a tool_use whose result was summarized", () => {
  const endsWithToolUse = msgs => {
    const last = msgs.at(-1)
    return last?.type === 'assistant' && Array.isArray(last.message.content) && last.message.content.some(b => b.type === 'tool_use')
  }
  for (let p = 0; p <= MSGS.length; p++) {
    const a = alignCompactBoundaryBackward(MSGS, p)
    const keptHead = MSGS.slice(0, a)
    // if the kept head ends with a tool_use, the next message (start of summarize)
    // must NOT be its tool_result — i.e. alignment moved the whole exchange to summarize.
    if (endsWithToolUse(keptHead)) {
      assert.equal(messageIsToolResult(MSGS[a]), false, `pivot ${p}→${a}: dangling tool_use at kept-head end`)
    }
  }
})
