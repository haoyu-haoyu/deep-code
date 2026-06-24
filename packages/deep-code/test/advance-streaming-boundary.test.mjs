import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marked } from 'marked'

import { advanceStreamingBoundary } from '../src/utils/advanceStreamingBoundary.mjs'

// Use the REAL DeepCode marked shim (splits only on HTML comments, else one
// paragraph token) so the boundary math matches production.
const lexFrom = (stripped, boundary) => marked.lexer(stripped.substring(boundary))
const advance = (stripped, boundary) =>
  advanceStreamingBoundary(stripped, boundary, lexFrom(stripped, boundary))

// The exact pre-fix token-loop (no fallback), as a differential oracle.
function oldBoundary(stripped, boundary, tokens) {
  let lastContentIdx = tokens.length - 1
  while (lastContentIdx >= 0 && tokens[lastContentIdx].type === 'space') lastContentIdx--
  let adv = 0
  for (let i = 0; i < lastContentIdx; i++) adv += tokens[i].raw.length
  return adv > 0 ? boundary + adv : boundary
}

// Model how <Markdown> renders the shim path: each sibling block is
// <Ansi>{content.trim()}</Ansi>; the container joins blocks with gap={1} (one
// blank row). linkifyIssueReferences is linear over newlines so it's modeled as
// identity here. Returns the rendered row sequence.
// Trailing spaces on a row are invisible in the terminal — compare visible rows.
const trimRowEnd = r => r.replace(/[ \t]+$/, '')
const blockRows = text => text.trim().split('\n').map(trimRowEnd)
const renderWhole = stripped => blockRows(stripped)
const renderSplit = (prefix, suffix) => {
  // {stablePrefix && <Markdown>} / {unstableSuffix && <Markdown>} — empty raw
  // strings are not rendered; gap={1} adds one blank row between two children.
  const blocks = []
  if (prefix) blocks.push(blockRows(prefix))
  if (suffix) blocks.push(blockRows(suffix))
  return blocks.length === 2
    ? [...blocks[0], '', ...blocks[1]]
    : (blocks[0] ?? [])
}

// THE RENDER-EQUIVALENCE INVARIANT: for whatever boundary the leaf picks, the
// split render must equal the whole render byte-for-byte.
function assertRenderEquivalent(stripped, boundary = 0) {
  const nb = advance(stripped, boundary)
  const prefix = stripped.substring(0, nb)
  const suffix = stripped.substring(nb)
  assert.equal(prefix + suffix, stripped) // no character lost
  assert.deepEqual(
    renderSplit(prefix, suffix),
    renderWhole(stripped),
    `render divergence for ${JSON.stringify(stripped)} (split at ${nb})`,
  )
  return nb
}

test('shim single paragraph reply: splits at the last CLEAN "\\n\\n", render-identical', () => {
  const nb = assertRenderEquivalent('para one here\n\npara two here\n\nfinal partial')
  assert.equal('para one here\n\npara two here\n\nfinal partial'.substring(nb), 'final partial')
  // the OLD token loop never advanced (the shim returns one paragraph token)
  const s = 'para one here\n\npara two here\n\nfinal partial'
  assert.equal(oldBoundary(s, 0, lexFrom(s, 0)), 0)
})

test('REGRESSION: a 3+ newline run is NOT split inside (no lost blank row)', () => {
  // splitting inside "\n\n\n" would drop a blank row vs the whole; the leaf must
  // pick the earlier CLEAN break instead, staying render-identical.
  assertRenderEquivalent('alpha\n\nbeta\n\n\ngamma growing')
  assertRenderEquivalent('a\n\nb\n\n\nc')
  assertRenderEquivalent('one\n\n\n\ntwo\n\nthree tail')
})

test('REGRESSION: an indented line after a break is NOT split before (no lost indent)', () => {
  assertRenderEquivalent('summary done.\n\n    indented code line continues')
  assertRenderEquivalent('intro\n\nclean break here\n\n   then indented tail')
})

test('a single paragraph with no clean break cannot be split (boundary stays)', () => {
  assert.equal(advance('one long line with no paragraph breaks at all here', 0), 0)
  assert.equal(advance('summary.\n\n   only an indented continuation', 0), 0)
})

test('a leading "\\n\\n" does not produce an empty stable prefix', () => {
  assert.equal(advance('\n\nfirst real paragraph', 0), 0)
})

test('the boundary is monotonic and the unstable suffix stays BOUNDED (not O(n))', () => {
  const para = i => (`Paragraph number ${i} ` + 'lorem ipsum dolor '.repeat(10)).trim()
  const fullText = Array.from({ length: 8 }, (_, i) => para(i + 1)).join('\n\n')
  const longestPara = Math.max(...fullText.split('\n\n').map(p => p.length + 2))

  let boundary = 0
  let maxUnstable = 0
  let prev = 0
  for (let n = 12; n <= fullText.length; n += 12) {
    const stripped = fullText.slice(0, n)
    boundary = advance(stripped, boundary)
    assert.ok(boundary >= prev, 'monotonic')
    assert.equal(stripped.substring(0, boundary) + stripped.substring(boundary), stripped)
    prev = boundary
    maxUnstable = Math.max(maxUnstable, stripped.length - boundary)
  }
  boundary = advance(fullText, boundary)
  maxUnstable = Math.max(maxUnstable, fullText.length - boundary)
  assert.ok(
    maxUnstable < longestPara + 24,
    `unstable ${maxUnstable} should be ~bounded by longest paragraph ${longestPara}, not ${fullText.length}`,
  )
  assert.ok(maxUnstable < fullText.length / 2, 'bounded well below the full reply')
})

test('HTML-comment multi-token path is unchanged (token-loop advance, not the fallback)', () => {
  const stripped = 'before the comment<!-- a comment -->after, still streaming'
  const tokens = lexFrom(stripped, 0)
  assert.ok(tokens.length > 1, 'shim splits on the HTML comment')
  assert.equal(
    advanceStreamingBoundary(stripped, 0, tokens),
    oldBoundary(stripped, 0, tokens),
  )
})

test('re-lexing from the advanced boundary still finds the final paragraph (incremental)', () => {
  const stripped = 'p1 content\n\np2 content\n\np3 grow'
  const b1 = advance(stripped, 0)
  assert.equal(stripped.substring(b1), 'p3 grow')
  const stripped2 = stripped + 'ing more'
  const b2 = advance(stripped2, b1)
  assert.equal(b2, b1)
  assert.equal(stripped2.substring(b2), 'p3 growing more')
})

test('FUZZ: the chosen split is always render-equivalent to the whole', () => {
  let seed = 0x2bd4f11e
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const atoms = ['word ', 'x', '.', '\n', '\n\n', '\n\n\n', '  ', '\n   ', 'ab#1 ']
  for (let iter = 0; iter < 3000; iter++) {
    const n = 1 + Math.floor(rnd() * 14)
    let s = ''
    for (let k = 0; k < n; k++) s += atoms[Math.floor(rnd() * atoms.length)]
    // only the shim single-paragraph path (no HTML comments) exercises the fallback
    if (s.includes('<!--')) continue
    assertRenderEquivalent(s, 0)
  }
})
