import assert from 'node:assert/strict'
import { test } from 'node:test'

import { estimateStrippedMediaTokens } from '../src/utils/estimateStrippedMediaTokens.mjs'
import { describeNonTextBlock } from '../src/messages/deepseek-normalizer.mjs'

// Exact copy of src/utils/charEstimation.ts roughTokenCountEstimation (the .ts the
// .mjs layer cannot import). Both call sites inject this same function.
const roughTokenCountEstimation = (content, bytesPerToken = 4) =>
  Math.round(content.length / bytesPerToken)

function imageBlock(mediaType, dataLen) {
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: 'A'.repeat(dataLen) },
  }
}
function documentBlock(mediaType, dataLen) {
  return {
    type: 'document',
    source: { type: 'base64', media_type: mediaType, data: 'A'.repeat(dataLen) },
  }
}

test('an image block is estimated at the wire placeholder cost (~13 tokens), not 2000', () => {
  const block = imageBlock('image/png', 400_000)
  const tokens = estimateStrippedMediaTokens(block, roughTokenCountEstimation)
  // matches the placeholder the wire mapper actually sends
  assert.equal(
    tokens,
    roughTokenCountEstimation(describeNonTextBlock(block)),
  )
  assert.ok(tokens < 30, `expected ~13 tokens, got ${tokens}`)
  assert.notEqual(tokens, 2000)
})

test('the estimate does NOT scale with the base64 blob size (1MB PDF still ~13 tokens)', () => {
  const small = estimateStrippedMediaTokens(documentBlock('application/pdf', 100), roughTokenCountEstimation)
  const huge = estimateStrippedMediaTokens(documentBlock('application/pdf', 1_000_000), roughTokenCountEstimation)
  assert.equal(small, huge)
  assert.ok(huge < 30, `expected the placeholder cost, got ${huge}`)
})

test('the estimate equals the real on-wire placeholder length / bytesPerToken (SSOT)', () => {
  for (const block of [
    imageBlock('image/jpeg', 5000),
    documentBlock('application/pdf', 5000),
    imageBlock('image/png', 0),
  ]) {
    const placeholder = describeNonTextBlock(block)
    assert.equal(
      estimateStrippedMediaTokens(block, roughTokenCountEstimation),
      Math.round(placeholder.length / 4),
    )
  }
})

test('a block with no media_type still estimates the (shorter) placeholder', () => {
  const block = { type: 'image', source: { type: 'base64', data: 'A'.repeat(1000) } }
  const tokens = estimateStrippedMediaTokens(block, roughTokenCountEstimation)
  assert.equal(tokens, roughTokenCountEstimation('[image omitted: DeepSeek has no vision]'))
  assert.ok(tokens < 30)
})

test('the new estimate is dramatically lower than the old fixed 2000 over-count', () => {
  // The whole point: a single image previously counted 2000; now ~13. With N
  // images that is ~1985*N fewer tokens, so autocompact no longer fires early.
  const tokens = estimateStrippedMediaTokens(imageBlock('image/png', 400_000), roughTokenCountEstimation)
  assert.ok(2000 - tokens > 1900, `expected to shave ~1985 tokens, got a drop of ${2000 - tokens}`)
})
