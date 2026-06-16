import assert from 'node:assert/strict'
import { test } from 'node:test'

import { walkChainBeforeParse } from '../src/utils/walkChainBeforeParse.mjs'

// --- helpers: build JSONL the byte-level walker keys on -------------------

// 36-char canonical-shaped uuid from a small integer.
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

// A transcript line. Starts with `{"parentUuid":` (the walker's prefix), keeps
// the top-level uuid adjacent to `","timestamp":"` (the suffix the walker reads
// the stamp from), and carries `"isSidechain":<bool>`. `pad` bytes inflate a
// line so a dead branch can exceed the 50% prune gate.
const line = ({ parent, id, ts, type = 'assistant', sidechain = false, pad = 0 }) => {
  const p = parent === null ? 'null' : `"${uuid(parent)}"`
  const padField = pad > 0 ? `,"pad":"${'x'.repeat(pad)}"` : ''
  return `{"parentUuid":${p},"isSidechain":${sidechain},"uuid":"${uuid(
    id,
  )}","timestamp":"${ts}","type":"${type}"${padField}}`
}

// A transcript line whose top-level uuid is NOT adjacent to the timestamp
// (timestamp serialized after `type`), so the walker records tsStart = -1 for
// it — the "no Date.parse-able stamp" case that drives the file-order fallback.
const lineNoAdjacentTs = ({ parent, id, ts, pad = 0 }) => {
  const p = parent === null ? 'null' : `"${uuid(parent)}"`
  const padField = pad > 0 ? `,"pad":"${'x'.repeat(pad)}"` : ''
  return `{"parentUuid":${p},"isSidechain":false,"uuid":"${uuid(
    id,
  )}","type":"assistant","timestamp":"${ts}"${padField}}`
}

const buildBuf = lines => Buffer.from(lines.join('\n') + '\n')
const has = (buf, id) => buf.includes(`"uuid":"${uuid(id)}"`)
const T = s => `2024-01-01T00:${String(s).padStart(2, '0')}:00.000Z`

// --- no transcript lines / nothing to prune -------------------------------

test('a buffer with no transcript lines is returned unchanged (identity)', () => {
  const buf = buildBuf(['{"type":"summary","summary":"x","leafUuid":"y"}'])
  assert.equal(walkChainBeforeParse(buf), buf)
})

test('a mostly-live single chain is not worth pruning (returned unchanged)', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }),
    line({ parent: 1, id: 2, ts: T(1) }),
    line({ parent: 1, id: 3, ts: T(2) }),
  ])
  assert.equal(walkChainBeforeParse(buf), buf)
})

// --- monotonic fork: live (latest == physically-last) branch kept ----------

test('monotonic fork: prunes the dead branch, keeps the live (latest) branch', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }), // root
    line({ parent: 1, id: 2, ts: T(1), pad: 4000 }), // dead branch tip (older, big)
    line({ parent: 1, id: 3, ts: T(9) }), // live branch tip (newer, last in file)
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf) // pruned
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 3), 'live tip kept')
  assert.ok(!has(out, 2), 'dead branch dropped')
})

// --- clock step: the prune keeps the UNION of the max-timestamp branch and
//     the physically-last branch (so the loader's max-timestamp anchor always
//     survives), while still dropping a genuinely dead third fork ------------

test('clock step: keeps BOTH the max-timestamp and physically-last branches; drops a dead fork', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }), // root
    line({ parent: 1, id: 2, ts: T(9) }), // branch A tip: MAX stamp, earlier in file
    line({ parent: 1, id: 3, ts: T(3), pad: 4000 }), // branch C: dead fork (mid stamp, not last), big
    line({ parent: 1, id: 4, ts: T(1) }), // branch B tip: physically LAST, OLDER stamp
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf) // dead fork C is >50% of bytes → pruned
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 2), 'max-timestamp branch (A) kept — the clock-step fix')
  assert.ok(has(out, 4), 'physically-last branch (B) kept — the safety net')
  assert.ok(!has(out, 3), 'the genuinely dead fork (C) dropped')
})

// --- regression (reviewer A): a NON-TERMINAL live tip (an assistant whose
//     only child is a sidechain/progress entry the loader bridges out) must
//     not be dropped, even though the max-timestamp TERMINAL pick lands on a
//     stale fork. The physically-last-line safety net keeps the live tip. ----

test('a non-terminal live tip (assistant with a sidechain child) survives the prune', () => {
  // Reviewer-A topology: the live tip (id 2) is a non-terminal because its only
  // child is a sidechain entry the loader bridges out — so the loader anchors on
  // it, but the max-timestamp TERMINAL pick (id 6, a stale sibling) cannot. The
  // physically-last-line safety net (L = id 2) keeps the live tip; meanwhile a
  // genuinely dead big fork (id 5) — neither L's chain nor the chrono pick — is
  // dropped, proving the prune still fires.
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0), type: 'user' }), // root
    line({ parent: 1, id: 5, ts: T(1), pad: 8000 }), // dead fork (low stamp), big → forces the prune
    line({ parent: 1, id: 6, ts: T(8) }), // stale sibling terminal — the chrono (max-ts terminal) pick
    line({ parent: 1, id: 2, ts: T(5) }), // LIVE TIP (assistant), physically-last non-sidechain
    line({ parent: 2, id: 3, ts: T(9), sidechain: true, type: 'progress' }), // sidechain child → tip non-terminal
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf)
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 2), 'live tip kept even though it is a non-terminal (regression guard)')
  assert.ok(has(out, 6), 'the max-timestamp terminal kept')
  assert.ok(!has(out, 5), 'the big dead fork dropped (prune fired)')
})

// --- regression (reviewer B): a `progress` TERMINAL that out-stamps the real
//     user/assistant leaf must not cause the real leaf to be dropped ----------

test('a progress terminal out-stamping the real leaf does not drop the leaf', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0), type: 'user' }), // root
    line({ parent: 1, id: 5, ts: T(1), pad: 6000 }), // dead fork, big → forces the prune
    line({ parent: 1, id: 2, ts: T(2) }), // assistant tool turn
    line({ parent: 2, id: 3, ts: T(9), type: 'progress' }), // progress TERMINAL, MAX stamp
    line({ parent: 2, id: 4, ts: T(5) }), // the REAL leaf, physically last
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf)
  assert.ok(has(out, 1) && has(out, 2), 'root + tool turn kept')
  assert.ok(has(out, 4), 'real leaf kept despite the progress terminal out-stamping it (regression guard)')
  assert.ok(!has(out, 5), 'the big dead fork dropped (prune fired)')
})

// --- sidechain entries are never an anchor --------------------------------

test('a later-stamped sidechain terminal does not become an anchor', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }), // root
    line({ parent: 1, id: 2, ts: T(2) }), // non-sidechain terminal (the anchor)
    line({ parent: 1, id: 3, ts: T(9), sidechain: true, pad: 4000 }), // later sidechain, big
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf)
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 2), 'non-sidechain terminal kept')
  assert.ok(!has(out, 3), 'sidechain branch dropped despite its later stamp')
})

// --- only TERMINALS win the max-timestamp tier: an interior node with the
//     global max stamp is not the chrono anchor (its descendant/sibling is) --

test('an interior node with the max timestamp is not the chrono anchor', () => {
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }), // root
    line({ parent: 1, id: 2, ts: T(9), pad: 4000 }), // INTERIOR (has child id 3), max stamp, big
    line({ parent: 2, id: 3, ts: T(1) }), // terminal under the interior node
    line({ parent: 1, id: 4, ts: T(5) }), // the max-timestamp TERMINAL (also physically last)
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf) // the big interior branch (id 2 + id 3) is dropped
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 4), 'max-timestamp terminal kept')
  assert.ok(!has(out, 2), 'interior max-stamp node dropped (it was not an anchor)')
  assert.ok(!has(out, 3), 'the interior node’s descendant dropped too')
})

// --- fallback: no terminal carries a Date.parse-able stamp → physically-last
//     non-sidechain pick (preserves the historical behavior) ---------------

test('no usable timestamps → falls back to the physically-last non-sidechain entry', () => {
  const buf = buildBuf([
    lineNoAdjacentTs({ parent: null, id: 1, ts: T(0) }), // root
    lineNoAdjacentTs({ parent: 1, id: 2, ts: T(9), pad: 4000 }), // dead branch, big, earlier in file
    lineNoAdjacentTs({ parent: 1, id: 3, ts: T(1) }), // physically-last → the fallback pick
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf)
  assert.ok(has(out, 1), 'root kept')
  assert.ok(has(out, 3), 'physically-last non-sidechain entry kept (fallback)')
  assert.ok(!has(out, 2), 'dead branch dropped')
})

// --- metadata lines are always preserved, interleaved in file order --------

test('metadata lines survive the prune in original order', () => {
  const buf = buildBuf([
    '{"type":"summary","summary":"s","leafUuid":"l"}',
    line({ parent: null, id: 1, ts: T(0) }),
    line({ parent: 1, id: 2, ts: T(1), pad: 4000 }), // dead, big
    '{"type":"mode","mode":"m"}',
    line({ parent: 1, id: 3, ts: T(9) }), // live tip
  ])
  const out = walkChainBeforeParse(buf)
  assert.notEqual(out, buf)
  const text = out.toString('utf8')
  assert.ok(text.includes('"type":"summary"'), 'summary metadata kept')
  assert.ok(text.includes('"type":"mode"'), 'mode metadata kept')
  assert.ok(text.indexOf('"type":"summary"') < text.indexOf('"type":"mode"'), 'order preserved')
  assert.ok(has(out, 3) && !has(out, 2), 'live chain kept, dead dropped')
})

// --- depth-1 uuid disambiguation (verbatim-preserved) still reads the
//     TOP-LEVEL uuid+timestamp, not a nested one -----------------------------

test('a nested uuid/timestamp does not poison the top-level pick', () => {
  // An agent_progress-style line: a nested message carries its OWN
  // uuid+timestamp (depth 2) BEFORE the top-level uuid+timestamp (depth 1).
  const nested =
    `{"parentUuid":"${uuid(1)}","isSidechain":false,` +
    `"data":{"message":{"uuid":"${uuid(77)}","timestamp":"${T(2)}"}},` +
    `"uuid":"${uuid(2)}","timestamp":"${T(9)}","type":"progress"}`
  const buf = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }), // root
    nested, // top-level uuid id 2, max stamp T(9), physically last non-sidechain
    line({ parent: 1, id: 3, ts: T(1), pad: 4000 }), // dead sibling earlier... no: see order
  ])
  // Re-order so the dead sibling is NOT physically-last (else it becomes the
  // file-order anchor): root, dead(big), nested(top-level uuid 2).
  const buf2 = buildBuf([
    line({ parent: null, id: 1, ts: T(0) }),
    line({ parent: 1, id: 3, ts: T(1), pad: 4000 }),
    nested,
  ])
  const out = walkChainBeforeParse(buf2)
  assert.notEqual(out, buf2)
  assert.ok(has(out, 1), 'root kept')
  // The top-level uuid (id 2) resolved its parent (id 1) correctly via the
  // depth-1 pick (not the nested uuid 77); the dead sibling (id 3) is dropped.
  assert.ok(out.includes(`"uuid":"${uuid(2)}"`), 'progress entry kept (top-level uuid read)')
  assert.ok(!has(out, 3), 'dead sibling dropped')
  void buf
})

// --- determinism: identical input → identical output -----------------------

test('the prune is deterministic', () => {
  const lines = [
    line({ parent: null, id: 1, ts: T(0) }),
    line({ parent: 1, id: 2, ts: T(5) }),
    line({ parent: 1, id: 3, ts: T(5), pad: 4000 }),
  ]
  const a = walkChainBeforeParse(buildBuf(lines))
  const b = walkChainBeforeParse(buildBuf(lines))
  assert.equal(Buffer.compare(a, b), 0)
})
