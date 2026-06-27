import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMcpResourceTextBlocks } from '../src/utils/mcpResourceBlocks.mjs'
import { boundInboxMessages } from '../src/utils/inboxBound.mjs'

// A string has a LONE surrogate if a high surrogate is not followed by a low one,
// or a low surrogate is not preceded by a high one. Lone surrogates are invalid
// UTF-16: they cannot be UTF-8 / JSON encoded for the model API.
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++ // a valid pair — skip the low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true // a low surrogate with no preceding high
    }
  }
  return false
}

const EMOJI = '\u{1F600}' // 😀 — one astral char = 2 UTF-16 code units

test('hasLoneSurrogate detector sanity', () => {
  assert.equal(hasLoneSurrogate('plain'), false)
  assert.equal(hasLoneSurrogate('ok' + EMOJI), false)
  assert.equal(hasLoneSurrogate('ok' + EMOJI.charAt(0)), true) // lone high
  assert.equal(hasLoneSurrogate(EMOJI.charAt(1) + 'x'), true) // lone low
})

test('buildMcpResourceTextBlocks: a budget landing mid-pair never emits a lone surrogate', () => {
  // 'x' + 😀 → code units [x, high, low]. A budget of 2 would slice [x, high] and
  // leave a lone high surrogate; the boundary-safe truncation must drop the pair.
  const text = 'x' + EMOJI
  const blocks = buildMcpResourceTextBlocks([{ text }], 2)
  const joined = blocks.map(b => b.text).join('')
  assert.equal(hasLoneSurrogate(joined), false)
  // The kept head is 'x' (the astral char is dropped whole), then the truncation note.
  assert.ok(blocks.some(b => b.text.startsWith('x\n... (truncated;')))
})

test('buildMcpResourceTextBlocks: a budget on a clean boundary is unchanged (happy path)', () => {
  const text = 'hello' + EMOJI + 'world'
  // budget larger than the text → no truncation at all
  const blocks = buildMcpResourceTextBlocks([{ text }], 1000)
  assert.ok(blocks.some(b => b.text === text))
  assert.equal(hasLoneSurrogate(blocks.map(b => b.text).join('')), false)
})

test('buildMcpResourceTextBlocks: a server-controlled mimeType clamp lands on a code-unit boundary', () => {
  // A hostile/buggy server returns a long binary-resource mimeType padded with
  // astral chars; the clamp at MAX_MIME_TYPE_CHARS (80) must not emit a lone
  // surrogate into the [Binary content: ...] block.
  const mimeType = 'x'.repeat(79) + EMOJI // boundary at 80 splits the pair
  const blocks = buildMcpResourceTextBlocks(
    [{ blob: 'AAAA', mimeType }],
    1000,
  )
  const joined = blocks.map(b => b.text).join('')
  assert.equal(hasLoneSurrogate(joined), false)
  assert.ok(blocks.some(b => b.text.startsWith('[Binary content: ')))
})

test('boundInboxMessages: per-message truncation lands on a code-unit boundary', () => {
  const text = 'x' + EMOJI + EMOJI // [x, hi, lo, hi, lo] = 5 code units
  const { messages, truncatedCount } = boundInboxMessages([{ text }], {
    isProtected: () => false,
    maxMessages: 10,
    maxTotalChars: Infinity,
    maxMessageChars: 2, // would split the first pair at index 1..2
    truncationMarker: '<<cut>>',
  })
  assert.equal(truncatedCount, 1)
  assert.equal(hasLoneSurrogate(messages[0].text), false)
  assert.ok(messages[0].text.startsWith('x<<cut>>'))
})

test('boundInboxMessages: a message under the cap is byte-identical (happy path)', () => {
  const text = 'short' + EMOJI
  const { messages, truncatedCount } = boundInboxMessages([{ text }], {
    isProtected: () => false,
    maxMessages: 10,
    maxTotalChars: Infinity,
    maxMessageChars: 1000,
    truncationMarker: '<<cut>>',
  })
  assert.equal(truncatedCount, 0)
  assert.equal(messages[0].text, text)
})
