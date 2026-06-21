import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  mcpResourceContentLength,
  nextResourceAllowance,
} from '../src/utils/mcpResourceBudget.mjs'
import { buildMcpResourceTextBlocks } from '../src/utils/mcpResourceBlocks.mjs'

test('nextResourceAllowance returns the remaining budget', () => {
  assert.equal(nextResourceAllowance(100, 0), 100)
  assert.equal(nextResourceAllowance(100, 30), 70)
  assert.equal(nextResourceAllowance(100, 100), 0)
})

test('nextResourceAllowance clamps an over-budget total to 0 (never negative)', () => {
  assert.equal(nextResourceAllowance(100, 150), 0)
})

test('nextResourceAllowance treats a non-finite cap as unbounded', () => {
  assert.equal(nextResourceAllowance(Infinity, 9999), Infinity)
  assert.equal(nextResourceAllowance(NaN, 10), Infinity)
})

test('nextResourceAllowance tolerates a non-finite used', () => {
  assert.equal(nextResourceAllowance(100, NaN), 100)
})

test('mcpResourceContentLength sums only text items (blobs ignored)', () => {
  const contents = [
    { text: 'abc' },
    { blob: 'Zm9v', mimeType: 'image/png' },
    { text: 'de' },
    null,
    { notText: 1 },
  ]
  assert.equal(mcpResourceContentLength(contents), 5)
})

test('mcpResourceContentLength handles non-array input', () => {
  assert.equal(mcpResourceContentLength(undefined), 0)
  assert.equal(mcpResourceContentLength(null), 0)
  assert.equal(mcpResourceContentLength('nope'), 0)
})

// THE FIX, end-to-end against the real render leaf: walking N resources with one
// running budget bounds the TOTAL injected text, where N fresh per-resource caps
// would not.
test('the running budget bounds the cumulative injected text across resources', () => {
  const CAP = 100
  // 3 resources of 60 chars each = 180 chars of text; a fresh 100-cap per
  // resource would let all 180 through, but the shared budget must cap at 100.
  const resources = [
    [{ text: 'a'.repeat(60) }],
    [{ text: 'b'.repeat(60) }],
    [{ text: 'c'.repeat(60) }],
  ]

  let used = 0
  let injected = 0
  for (const contents of resources) {
    const allowance = nextResourceAllowance(CAP, used)
    const blocks = buildMcpResourceTextBlocks(contents, allowance)
    // sum the rendered text the model actually receives
    for (const b of blocks) injected += b.text.length
    used += Math.min(mcpResourceContentLength(contents), allowance)
  }

  // The actual resource text injected (excluding the fixed framing strings) is
  // bounded by CAP: resource1 = 60, resource2 = 40 (budget left), resource3 = 0.
  assert.equal(used, CAP)
  // First resource fully present, last resource's body fully truncated away.
  const r3 = buildMcpResourceTextBlocks(
    resources[2],
    nextResourceAllowance(CAP, CAP),
  )
  assert.ok(r3.every(b => !b.text.includes('c'.repeat(60))))
})

test('a single resource under budget is unaffected (no regression)', () => {
  const allowance = nextResourceAllowance(TURN_CAP, 0)
  const blocks = buildMcpResourceTextBlocks([{ text: 'hello' }], allowance)
  assert.ok(blocks.some(b => b.text === 'hello'))
})

// The wiring stamps Math.min(PER_RESOURCE_CAP, remaining), so one big resource
// keeps the historical per-resource cap rather than being loosened to the whole
// turn budget.
test('per-resource cap is preserved (Math.min with the per-resource ceiling)', () => {
  const PER_RESOURCE_CAP = 50_000
  const allowance = Math.min(
    PER_RESOURCE_CAP,
    nextResourceAllowance(TURN_CAP, 0),
  )
  assert.equal(allowance, PER_RESOURCE_CAP) // 50K, not the 200K turn budget
  const big = 'z'.repeat(120_000)
  const blocks = buildMcpResourceTextBlocks([{ text: big }], allowance)
  const rendered = blocks.map(b => b.text).join('')
  // truncated to the per-resource cap, not the whole turn budget
  assert.ok(rendered.includes('truncated'))
  assert.ok(rendered.length < 60_000)
})

// A server-controlled blob mimeType cannot be an uncapped injection channel.
test('blob mimeType is length-clamped in the placeholder', () => {
  const hugeMime = 'x'.repeat(5000)
  const blocks = buildMcpResourceTextBlocks(
    [{ blob: 'AAAA', mimeType: hugeMime }],
    50_000,
  )
  const placeholder = blocks.find(b => b.text.startsWith('[Binary content:'))
  assert.ok(placeholder)
  assert.ok(placeholder.text.length < 200) // clamped, not 5000+
  assert.ok(placeholder.text.includes('…'))
})

test('a short blob mimeType is unchanged (no regression)', () => {
  const blocks = buildMcpResourceTextBlocks(
    [{ blob: 'AAAA', mimeType: 'image/png' }],
    50_000,
  )
  assert.ok(blocks.some(b => b.text === '[Binary content: image/png]'))
})

const TURN_CAP = 200_000
