import { test } from 'node:test'
import assert from 'node:assert/strict'

import { walkChainBeforeParse } from '../src/utils/sessionChainPrune.mjs'

// --- jsonl line builders (mimic the transcript byte format the pruner scans) ---

const mkUuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')

// A transcript message line MUST start with `{"parentUuid":` and contain
// `"uuid":"<36>","timestamp":"`. Optional: a tool_result marker, padding bytes.
function msg({ uuid, parent, toolResult = false, sidechain = false, pad = 0 }) {
  const p = parent === null ? 'null' : `"${parent}"`
  const tr = toolResult
    ? '"message":{"role":"user","content":[{"type":"tool_result"}]},'
    : ''
  const sc = sidechain ? '"isSidechain":true,' : ''
  const padField = pad > 0 ? `,"pad":"${'q'.repeat(pad)}"` : ''
  return (
    `{"parentUuid":${p},${sc}${tr}"uuid":"${uuid}","timestamp":"2026-01-01T00:00:00.000Z"${padField}}\n`
  )
}

const meta = s => s + '\n' // a non-message metadata line (no parentUuid prefix)

const buf = lines => Buffer.from(lines.join(''), 'utf8')

// Parse a (possibly pruned) buffer back into its message-line set, keyed by uuid.
const uuidsIn = b => {
  const s = b.toString('utf8')
  const out = new Set()
  for (const m of s.matchAll(/"uuid":"([0-9a-f-]{36})"/g)) out.add(m[1])
  return out
}

// --- the bail contract: any off-chain tool_result forces a full-buffer return ---

test('BAILS (full buffer) when a parallel tool_result is off the single-parent chain', () => {
  const R = mkUuid(0)
  const A = mkUuid(1)
  const B = mkUuid(2)
  const TA = mkUuid(3)
  const TB = mkUuid(4)
  const N = mkUuid(5)
  const D1 = mkUuid(10)
  const D2 = mkUuid(11)

  // Earlier dead fork (big padding, so absent the bail the >=50%-dead gate would
  // fire), then the live chain with a 2-way parallel tool turn: asstA<-asstB,
  // TR_A.parent=A, TR_B.parent=B, next.parent=TR_B. The single-parent walk
  // (N->TB->B->A->R) never visits TR_A, so TR_A is an off-chain tool_result. The
  // parser would splice it back by message.id sibling group; a byte prune cannot
  // reproduce that, so the leaf BAILS and returns the buffer untouched.
  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: D1, parent: R, pad: 4000 }), // dead branch
    msg({ uuid: D2, parent: D1, pad: 4000 }), // dead branch
    msg({ uuid: A, parent: R }),
    msg({ uuid: B, parent: A }),
    msg({ uuid: TA, parent: A, toolResult: true }), // off the single-parent chain
    msg({ uuid: TB, parent: B, toolResult: true }),
    msg({ uuid: N, parent: TB }), // live leaf
  ])

  const out = walkChainBeforeParse(b)
  assert.equal(out, b, 'an off-chain tool_result must force a full-buffer bail')
  // The whole transcript (including TR_A and the dead fork) is therefore intact —
  // no tool_result is lost and the downstream parser handles the full buffer.
  const kept = uuidsIn(out)
  for (const u of [R, A, B, TA, TB, N, D1, D2]) assert.ok(kept.has(u), `${u} present`)
})

test('BAILS (full buffer) when an off-chain tool_result is non-terminal', () => {
  // The #486-class case: a tool_result TRD whose parent is a kept live-chain
  // assistant A, but TRD has its OWN on-disk child (a resume-then-fork). Keeping
  // TRD's bytes alone would make it a false resume leaf; dropping it would lose a
  // tool_result the parser recovers. The bail returns the FULL buffer, which is
  // always correct (TRD present AND the full parse sees its child, so not a leaf).
  const R = mkUuid(0)
  const A = mkUuid(1) // live assistant (kept)
  const B = mkUuid(2)
  const TRD = mkUuid(3) // off-chain tool_result, parent=A, has a fork child
  const forkKid = mkUuid(4) // TRD's fork child
  const TB = mkUuid(5)
  const N = mkUuid(6) // live leaf on the B branch
  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: A, parent: R }),
    msg({ uuid: B, parent: A }),
    msg({ uuid: TRD, parent: A, toolResult: true, pad: 4000 }),
    msg({ uuid: forkKid, parent: TRD, pad: 4000 }), // makes TRD non-terminal
    msg({ uuid: TB, parent: B, toolResult: true }),
    msg({ uuid: N, parent: TB }), // leaf
  ])
  const out = walkChainBeforeParse(b)
  assert.equal(out, b, 'must bail to the full buffer (no prune)')
  assert.ok(uuidsIn(out).has(TRD))
})

// --- the prune is allowed only when every tool_result is on the chain ----------

test('prunes a dead fork when ALL tool_results lie on the single-parent chain', () => {
  // A purely linear/sequential tool session: every tool_result is on the live
  // single-parent chain (root -> A -> TR_A -> B -> TR_B -> leaf). There is nothing
  // for the parser to recover, so the leaf is free to drop the dead fork.
  const R = mkUuid(0)
  const A = mkUuid(1)
  const TA = mkUuid(2)
  const B = mkUuid(3)
  const TB = mkUuid(4)
  const N = mkUuid(5)
  const D1 = mkUuid(10)
  const D2 = mkUuid(11)

  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: D1, parent: R, pad: 4000 }), // dead branch (no tool_results)
    msg({ uuid: D2, parent: D1, pad: 4000 }), // dead branch
    msg({ uuid: A, parent: R }),
    msg({ uuid: TA, parent: A, toolResult: true }), // on-chain tool_result
    msg({ uuid: B, parent: TA }),
    msg({ uuid: TB, parent: B, toolResult: true }), // on-chain tool_result
    msg({ uuid: N, parent: TB }), // live leaf
  ])

  const out = walkChainBeforeParse(b)
  assert.notEqual(out.length, b.length, 'the >=50%-dead gate should fire (a prune happened)')
  const kept = uuidsIn(out)
  // The full live chain — including both on-chain tool_results — survives.
  for (const u of [R, A, TA, B, TB, N]) assert.ok(kept.has(u), `live ${u} kept`)
  // The dead fork is dropped.
  assert.ok(!kept.has(D1) && !kept.has(D2), 'dead fork dropped')
})

test('prunes a dead fork branch, keeps the live single-parent chain (no tools)', () => {
  const R = mkUuid(0)
  const live1 = mkUuid(1)
  const live2 = mkUuid(2)
  const dead1 = mkUuid(10)
  const dead2 = mkUuid(11)

  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: dead1, parent: R, pad: 3000 }),
    msg({ uuid: dead2, parent: dead1, pad: 3000 }),
    msg({ uuid: live1, parent: R }),
    msg({ uuid: live2, parent: live1 }), // leaf
  ])
  const kept = uuidsIn(walkChainBeforeParse(b))
  assert.deepEqual([...kept].sort(), [R, live1, live2].sort())
})

test('an off-chain NON-tool-result child is dropped (prune keeps only the chain)', () => {
  // No tool_result anywhere, so there is no bail; the off-chain dead child is a
  // plain fork and the prune keeps exactly the single-parent chain.
  const R = mkUuid(0)
  const live = mkUuid(1)
  const deadChild = mkUuid(10) // parent=R (kept), but NOT a tool_result
  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: deadChild, parent: R, pad: 6000 }), // dead, parent kept, not tool_result
    msg({ uuid: live, parent: R }), // leaf
  ])
  const kept = uuidsIn(walkChainBeforeParse(b))
  assert.ok(!kept.has(deadChild), 'an off-chain non-tool_result child stays dropped')
  assert.deepEqual([...kept].sort(), [R, live].sort())
})

// --- gate: a mostly-live session is returned unchanged ------------------------

test('below the 50%-dead gate, the buffer is returned unchanged (identity)', () => {
  const R = mkUuid(0)
  const a = mkUuid(1)
  const b2 = mkUuid(2)
  const b = buf([
    msg({ uuid: R, parent: null }),
    msg({ uuid: a, parent: R }),
    msg({ uuid: b2, parent: a }), // leaf; tiny dead set → gate not met
  ])
  const out = walkChainBeforeParse(b)
  assert.equal(out, b, 'no prune worth doing → same buffer reference')
})

test('metadata lines (no parentUuid prefix) are always preserved', () => {
  const R = mkUuid(0)
  const live = mkUuid(1)
  const dead = mkUuid(10)
  const b = buf([
    meta('{"type":"summary","summary":"hi"}'),
    msg({ uuid: R, parent: null }),
    msg({ uuid: dead, parent: R, pad: 6000 }),
    msg({ uuid: live, parent: R }), // leaf
    meta('{"type":"file-history-snapshot"}'),
  ])
  const out = walkChainBeforeParse(b).toString('utf8')
  assert.ok(out.includes('"type":"summary"'), 'summary metadata kept')
  assert.ok(out.includes('"type":"file-history-snapshot"'), 'snapshot metadata kept')
  assert.ok(!out.includes(dead), 'dead message still pruned')
})

// --- fuzz: the bail contract + subset/chain invariants never violated ---------

test('fuzz: a prune happens only when every tool_result is on-chain, and keeps exactly the chain', () => {
  // Deterministic LCG (no Math.random — vary by index).
  let s = 0x2545f4914f6cdd1d >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)

  for (let iter = 0; iter < 400; iter++) {
    const count = 3 + ((rnd() * 25) | 0)
    const uuids = Array.from({ length: count }, (_, i) => mkUuid(i))
    const lines = []
    const inputUuids = new Set()
    for (let i = 0; i < count; i++) {
      // parent is null or an EARLIER uuid (append-only: parents precede children).
      const parent = i === 0 || rnd() < 0.15 ? null : uuids[(rnd() * i) | 0]
      lines.push(
        msg({
          uuid: uuids[i],
          parent,
          toolResult: rnd() < 0.3,
          sidechain: rnd() < 0.15,
          pad: rnd() < 0.4 ? 200 + ((rnd() * 4000) | 0) : 0,
        }),
      )
      inputUuids.add(uuids[i])
    }
    const b = buf(lines)
    let out
    assert.doesNotThrow(() => {
      out = walkChainBeforeParse(b)
    }, `iter ${iter} threw`)

    // Every kept uuid was an input uuid (no fabrication / corruption).
    for (const u of uuidsIn(out)) {
      assert.ok(inputUuids.has(u), `iter ${iter}: kept a non-input uuid ${u}`)
    }
    // Output bytes are a subsequence of input bytes (only whole lines removed).
    assert.ok(out.length <= b.length, `iter ${iter}: output grew`)

    if (out !== b) {
      // A prune happened. Three guarantees:
      const expectChain = singleParentChain(lines, uuids)
      const kept = uuidsIn(out)
      // (1) the full single-parent chain from the leaf survives;
      for (const u of expectChain) {
        assert.ok(kept.has(u), `iter ${iter}: dropped a single-parent-chain node ${u}`)
      }
      // (2) nothing OUTSIDE the chain survives (prune keeps exactly the chain);
      for (const u of kept) {
        assert.ok(expectChain.has(u), `iter ${iter}: kept an off-chain node ${u}`)
      }
      // (3) the bail contract — a prune is allowed ONLY when every tool_result lies
      //     on that chain (any off-chain tool_result must have forced a bail).
      const trs = toolResultUuids(lines, uuids)
      for (const u of trs) {
        assert.ok(
          expectChain.has(u),
          `iter ${iter}: pruned despite an off-chain tool_result ${u}`,
        )
      }
    }
  }
})

// The set of uuids whose line carries a tool_result marker.
function toolResultUuids(lines, uuids) {
  const trs = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('"type":"tool_result"')) trs.add(uuids[i])
  }
  return trs
}

// Reference single-parent chain (leaf = last non-sidechain) for the fuzz oracle.
function singleParentChain(lines, uuids) {
  const parentOf = new Map()
  const isSide = new Map()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const pm = l.match(/^\{"parentUuid":(null|"([0-9a-f-]{36})")/)
    parentOf.set(uuids[i], pm && pm[2] ? pm[2] : null)
    isSide.set(uuids[i], l.includes('"isSidechain":true'))
  }
  let leaf = null
  for (let i = uuids.length - 1; i >= 0; i--) {
    if (!isSide.get(uuids[i])) {
      leaf = uuids[i]
      break
    }
  }
  const chain = new Set()
  let cur = leaf
  while (cur && !chain.has(cur)) {
    chain.add(cur)
    cur = parentOf.get(cur) ?? null
  }
  return chain
}
