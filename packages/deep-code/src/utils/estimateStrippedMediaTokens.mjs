import { describeNonTextBlock } from '../messages/deepseek-normalizer.mjs'

// DeepSeek is text-only: the wire mapper (describeNonTextBlock) replaces every
// image/document content block with a compact placeholder string
// ("[image omitted: DeepSeek has no vision; <media_type>]", ~13 tokens) BEFORE the
// request reaches the wire. So the real on-wire cost of such a block is the
// placeholder's token count, NOT the fixed 2000-token estimate the char estimators
// inherited from upstream Anthropic — which actually SENT the resized image at
// 2000-5333 tokens, so 2000 was a sane floor there. In this fork the image never
// goes out, so 2000 is a pure over-count (~1985 tokens per block) that biases the
// autocompact token estimate (roughTokenCountEstimationForMessages ->
// tokenCountWithEstimation -> shouldAutoCompact) to fire too EARLY — a needless full
// compaction that summarizes and discards still-live conversation tail.
//
// Estimate the placeholder the wire actually sends, via the SAME describeNonTextBlock
// the mapper uses, so the estimate tracks the bytes (and stays a small constant
// regardless of the base64 blob size — a 1MB PDF still costs ~13 tokens on the wire).
// roughTokenCountEstimation is injected because it lives in a .ts module the .mjs
// layer cannot import; both call sites already import it from charEstimation.
//
// @param {{ type?: string, source?: { media_type?: string, mediaType?: string } }} block
// @param {(content: string, bytesPerToken?: number) => number} roughTokenCountEstimation
// @returns {number}
export function estimateStrippedMediaTokens(block, roughTokenCountEstimation) {
  return roughTokenCountEstimation(describeNonTextBlock(block) ?? '')
}
