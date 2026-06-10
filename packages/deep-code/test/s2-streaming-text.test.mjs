import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  streamingTextGranularity,
  truncateToBoundary,
  truncateWordsFallback,
} from '../src/utils/streamGranularity.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('streamingTextGranularity defaults to char', () => {
  assert.equal(streamingTextGranularity({}), 'char')
})

test('streamingTextGranularity respects DEEPCODE-branded env var', () => {
  for (const value of ['char', 'word', 'line']) {
    assert.equal(
      streamingTextGranularity({ DEEPCODE_STREAM_GRANULARITY: value }),
      value,
    )
  }
})

test('streamingTextGranularity respects legacy CLAUDE_CODE env var', () => {
  assert.equal(
    streamingTextGranularity({ CLAUDE_CODE_STREAM_GRANULARITY: 'line' }),
    'line',
  )
})

test('streamingTextGranularity: DeepCode-branded var beats legacy var', () => {
  assert.equal(
    streamingTextGranularity({
      DEEPCODE_STREAM_GRANULARITY: 'char',
      CLAUDE_CODE_STREAM_GRANULARITY: 'line',
    }),
    'char',
  )
})

test('streamingTextGranularity falls back on invalid value', () => {
  assert.equal(
    streamingTextGranularity({ DEEPCODE_STREAM_GRANULARITY: 'paragraph' }),
    'char',
  )
  assert.equal(
    streamingTextGranularity({ DEEPCODE_STREAM_GRANULARITY: '' }),
    'char',
  )
  assert.equal(
    streamingTextGranularity({ DEEPCODE_STREAM_GRANULARITY: 'WORD' }),
    'word', // case-insensitive normalization
  )
  assert.equal(
    streamingTextGranularity({ DEEPCODE_STREAM_GRANULARITY: '  line  ' }),
    'line', // trims whitespace
  )
})

test('truncateToBoundary char: passes text through unchanged', () => {
  assert.equal(truncateToBoundary('hello', 'char'), 'hello')
  assert.equal(truncateToBoundary('partial wo', 'char'), 'partial wo')
  assert.equal(truncateToBoundary('', 'char'), null)
  assert.equal(truncateToBoundary(null, 'char'), null)
})

test('truncateToBoundary word: respects Unicode segment boundaries', () => {
  // English: spaces split words. Last segment 'three' is word-like, so
  // we rewind to its start; 'world' likewise. Output ends with a space
  // boundary in both cases.
  assert.equal(truncateToBoundary('hello world', 'word'), 'hello ')
  assert.equal(truncateToBoundary('one two three', 'word'), 'one two ')
  // Single incomplete word — show nothing yet.
  assert.equal(truncateToBoundary('partial', 'word'), null)
  // Tabs / newlines are non-word-like trailing separators → kept.
  assert.equal(truncateToBoundary('with\ttab', 'word'), 'with\t')
  assert.equal(truncateToBoundary('with\nnewline', 'word'), 'with\n')
})

test('truncateToBoundary word: keeps trailing separators and punctuation', () => {
  // Trailing separator/punctuation is a COMPLETED segment — must stay
  // visible. Pre-fix versions cut at the start of the last segment,
  // dropping the trailing space / period.
  const trailingSpace = truncateToBoundary('hello world ', 'word')
  assert.equal(trailingSpace, 'hello world ', 'trailing space dropped')
  const trailingPunct = truncateToBoundary('hello world.', 'word')
  assert.equal(trailingPunct, 'hello world.', 'trailing period dropped')
  const trailingMulti = truncateToBoundary('hi! how?', 'word')
  assert.equal(trailingMulti, 'hi! how?', 'trailing question mark dropped')
})

test('truncateToBoundary word: segments non-whitespace scripts (CJK / emoji) via the last segment', () => {
  // Intl.Segmenter word-splits CJK with no whitespace; the in-flight trailing word is
  // rewound to its start. This exercises the last-segment path that the perf change reads
  // via Segments.containing(text.length - 1) instead of materializing the whole array.
  assert.equal(truncateToBoundary('你好世界', 'word'), '你好')
  assert.equal(truncateToBoundary('我在想', 'word'), '我在')
  // a trailing non-word-like piece (space, emoji) is complete and kept
  assert.equal(truncateToBoundary('你好 ', 'word'), '你好 ')
  assert.equal(truncateToBoundary('hello 😀', 'word'), 'hello 😀')
  // a trailing word-like run after an emoji is still in flight → rewound
  assert.equal(truncateToBoundary('test😀more', 'word'), 'test😀')
})

test('truncateToBoundary word: rewinds when last segment is mid-word', () => {
  // Middle of a word — should rewind to before that word.
  assert.equal(truncateToBoundary('hello wor', 'word'), 'hello ')
  assert.equal(truncateToBoundary('one two thr', 'word'), 'one two ')
})

test(
  'truncateWordsFallback: keeps trailing punctuation on the no-Segmenter path',
  () => {
    // Force-tested version of the path that runs on environments
    // without Intl.Segmenter (Node < 18 or stripped builds). Without
    // this, '\p{P}' awareness, the legacy whitespace-only fallback
    // would drop trailing punctuation on, e.g. `'hello world.'`,
    // re-introducing the bug we just fixed in the Segmenter path.
    assert.equal(truncateWordsFallback('hello world '), 'hello world ')
    assert.equal(truncateWordsFallback('hello world.'), 'hello world.')
    assert.equal(truncateWordsFallback('hi! how?'), 'hi! how?')
    assert.equal(truncateWordsFallback('done.'), 'done.')
    assert.equal(truncateWordsFallback('emoji 🚀.'), 'emoji 🚀.')

    // Mid-word state — still rewinds.
    assert.equal(truncateWordsFallback('hello wor'), 'hello ')
    assert.equal(truncateWordsFallback('one two thr'), 'one two ')

    // Single in-flight word with no boundary anywhere — show nothing.
    assert.equal(truncateWordsFallback('partial'), null)
    assert.equal(truncateWordsFallback(''), null)
    assert.equal(truncateWordsFallback(null), null)
  },
)

test('truncateToBoundary word: handles CJK without whitespace', () => {
  // Critical regression test for non-Latin scripts. Pre-Intl.Segmenter
  // version returned null for 你好世界 because there was no whitespace
  // — reproducing the original "no typing effect" bug for Chinese
  // users. With Intl.Segmenter we get word-segment boundaries even
  // without whitespace.
  const result = truncateToBoundary('你好世界', 'word')
  // Either Intl.Segmenter is available (returns a non-null prefix) or
  // we're on a runtime without it (falls back to whitespace-only,
  // returns null). On Node 18+ Segmenter IS available, so non-null is
  // expected in CI; the OR keeps the test green on older runtimes.
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    assert.ok(
      typeof result === 'string' && result.length > 0,
      `CJK should yield a non-empty preview with Segmenter, got ${JSON.stringify(result)}`,
    )
    assert.ok(
      '你好世界'.startsWith(result),
      'preview must be a prefix of the input',
    )
  }
})

test('truncateToBoundary line: truncates at last newline', () => {
  assert.equal(truncateToBoundary('line1\nline2', 'line'), 'line1\n')
  assert.equal(truncateToBoundary('line1\nline2\n', 'line'), 'line1\nline2\n')
  assert.equal(truncateToBoundary('no newline yet', 'line'), null)
  assert.equal(truncateToBoundary('', 'line'), null)
})

test('truncateToBoundary line preserves the legacy upstream output exactly', () => {
  // The upstream code was:
  //   text.substring(0, text.lastIndexOf('\n') + 1) || null
  // truncateToBoundary('...', 'line') must produce identical output for
  // every input so users on DEEPCODE_STREAM_GRANULARITY=line see no
  // behavior change versus the pre-S2 build. Cover Unix (\n), Windows
  // (\r\n), classic Mac (\r), and Unicode line/paragraph separators
  // (\u2028 / \u2029) so a future "smart" line splitter doesn't quietly
  // diverge from the legacy parity for non-LF cases.
  const cases = [
    'no newline',
    'one line\n',
    'first\nsecond',
    'first\nsecond\n',
    'tail\nincomplete',
    '\n',
    '',
    'crlf\r\nnext',
    'crlf complete\r\n',
    'crOnly\rmid',
    'unicode-ls\u2028more',
    'unicode-ps\u2029more',
    'mixed\nls\u2028final',
  ]
  for (const text of cases) {
    const legacy = text.substring(0, text.lastIndexOf('\n') + 1) || null
    assert.equal(
      truncateToBoundary(text, 'line'),
      legacy,
      `legacy parity broken for ${JSON.stringify(text)}`,
    )
  }
})

test('REPL.tsx suppresses streaming preview when accessibility is enabled', () => {
  // Static guard — char-by-char streaming would fire an a11y event for
  // every delta, which screen readers announce as a barrage of single
  // characters. REPL gates on CLAUDE_CODE_ACCESSIBILITY in the
  // showStreamingText branch. We verify the gate is wired here
  // (runtime testing requires spinning up the React tree, which is
  // covered by the TUI harness).
  const replSource = readFileSync(
    resolve(packageRoot, 'src/screens/REPL.tsx'),
    'utf8',
  )
  assert.match(
    replSource,
    /CLAUDE_CODE_ACCESSIBILITY/,
    'REPL.tsx must consult CLAUDE_CODE_ACCESSIBILITY when deciding showStreamingText',
  )
  assert.match(
    replSource,
    /accessibilityEnabled/,
    'REPL.tsx must derive an accessibilityEnabled flag and use it',
  )
})

test('REPL.tsx buffers streamingText regardless of show flag (interrupt recovery)', () => {
  // Static guard — onStreamingText must always invoke setStreamingText
  // so the interrupt path (createAssistantMessage with the partial
  // streamingText) doesn't lose data when the preview is hidden for
  // a11y / reducedMotion. A regression here would silently drop
  // partial assistant responses on Esc-mid-stream for those users.
  const replSource = readFileSync(
    resolve(packageRoot, 'src/screens/REPL.tsx'),
    'utf8',
  )
  // The function must NOT have an early-return guard on showStreamingText.
  assert.doesNotMatch(
    replSource,
    /onStreamingText[\s\S]{0,500}if\s*\(\s*!showStreamingText\s*\)\s*return/,
    'onStreamingText must not gate buffering on showStreamingText',
  )
})

test('REPL.tsx imports the streamGranularity helper', () => {
  // Smoke check: REPL must use the helper instead of inlining the
  // truncation. We don't assert exact source structure here (covered by
  // the runtime tests above) — just that the import wiring exists so a
  // future refactor doesn't silently revert to inlined behavior.
  const replSource = readFileSync(
    resolve(packageRoot, 'src/screens/REPL.tsx'),
    'utf8',
  )
  assert.match(replSource, /streamGranularity/)
  assert.match(replSource, /truncateToBoundary/)
})
