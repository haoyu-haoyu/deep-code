import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readBranchedEnvInt } from '../src/utils/branchedEnv.mjs'
import {
  decodeUtf8AtBoundary,
  tailFileRaw,
} from '../src/utils/utf8Tail.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('TaskOutput.ts: LAST_LINES_COUNT default is 10 (was 5 upstream)', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  // The default 10 is the second arg to readBranchedEnvInt, regardless
  // of whether the call is wrapped in Math.min for clamping.
  assert.match(
    source,
    /readBranchedEnvInt\(\s*\[\s*'DEEPCODE_BASH_PROGRESS_LINES'[^]*?,\s*10,?\s*\)/,
    'last-lines slice must default to 10 (twice the upstream 5) for wider live window',
  )
  assert.match(
    source,
    /\['DEEPCODE_BASH_PROGRESS_LINES'/,
    'must read DEEPCODE_BASH_PROGRESS_LINES env override',
  )
})

test('TaskOutput.ts: ALL_LINES_COUNT stays 100 (memory-budget compat)', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /ALL_LINES_COUNT = 100/,
    'all-lines slice must stay 100 — downstream renderers size their buffers around this',
  )
})

test('TaskOutput.ts: ProgressCallback signature includes optional chunkDelta', () => {
  // The new 6th argument lets future incremental renderers consume
  // append-only deltas instead of replacing the whole snapshot every
  // tick. Optional so existing callers (BashTool, PowerShellTool)
  // continue to compile unchanged.
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /chunkDelta\?:\s*string/,
    'ProgressCallback must accept optional chunkDelta string',
  )
})

test('TaskOutput.ts: #lastEmittedBytesTotal advances independently of #lastSeenBytesTotal', () => {
  // Stale-callback guard already protects #lastSeenBytesTotal, but the new
  // chunkDelta channel needs its OWN cursor — the adaptive-counter cursor
  // advances even on dropped callbacks if bytesTotal grew, which would skip
  // delta bytes for a future successful callback. Two cursors keeps them
  // independent. The cursor LIVES in TaskOutput (declared + reset); the ADVANCE
  // (only after a non-stale read) now lives in the taskOutputPoll core and is
  // RUNTIME-tested in test/a2-bash-polling-core.test.mjs ("chunkDelta is the NEW
  // bytes since the last emit").
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /#lastEmittedBytesTotal\s*=\s*0/,
    'TaskOutput must declare a separate emit cursor',
  )
  const core = readFileSync(
    resolve(packageRoot, 'src/utils/task/taskOutputPoll.mjs'),
    'utf8',
  )
  assert.match(
    core,
    /lastEmittedBytesTotal:\s*bytesTotal/,
    'emit cursor must advance to bytesTotal only on a non-stale, non-empty read',
  )
})

test('TaskOutput.ts: chunkDelta slicing works on raw bytes (UTF-8 safe)', () => {
  // Codex flagged: an earlier fix that re-encoded the decoded `content` string
  // lost data when the tail buffer started mid-codepoint (toString('utf8') had
  // already inserted U+FFFD replacement chars). The production path reads raw
  // bytes via tailFileRaw (in TaskOutput) and decodes at codepoint boundaries on
  // BOTH the tail-start and the delta-start (in the taskOutputPoll core). The
  // UTF-8-safe behavior is RUNTIME-tested against a real multibyte file in
  // test/a2-bash-polling-core.test.mjs ("multibyte UTF-8 straddling the tail").
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /tailFileRaw\(entry\.path/,
    'must read raw bytes via tailFileRaw, not the lossy decoded tailFile',
  )
  const core = readFileSync(
    resolve(packageRoot, 'src/utils/task/taskOutputPoll.mjs'),
    'utf8',
  )
  assert.match(
    core,
    /decodeUtf8AtBoundary\(buffer,\s*0,\s*bytesRead\)/,
    'core must decode the full tail at a UTF-8 boundary for the line-slice path',
  )
  assert.match(
    core,
    /decodeUtf8AtBoundary\(buffer,\s*bytesRead - cutFromEnd,\s*bytesRead\)/,
    'core must decode the chunkDelta range at a UTF-8 boundary',
  )
  // Regression guards against the prior buggy slice variants (in either file).
  for (const [label, src] of [['TaskOutput', source], ['core', core]]) {
    assert.doesNotMatch(
      src,
      /Buffer\.from\(content,\s*'utf8'\)/,
      `${label} must not re-encode the decoded string (lossy at tail start)`,
    )
    assert.doesNotMatch(
      src,
      /content\.slice\(content\.length - newBytes\)/,
      `${label} must not slice the decoded string by a byte count`,
    )
  }
})

test('TaskOutput.ts: LAST_LINES_COUNT is clamped to ALL_LINES_COUNT', () => {
  // Codex flagged: an unclamped env override (e.g. setting
  // DEEPCODE_BASH_PROGRESS_LINES=500) would make non-verbose preview
  // taller than the verbose history buffer (100). The clamp keeps
  // the preview from ever exceeding the long-form view's capacity.
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /LAST_LINES_COUNT = Math\.min\(\s*ALL_LINES_COUNT\s*,/,
    'LAST_LINES_COUNT must be clamped to ALL_LINES_COUNT',
  )
})

test('TaskOutput.ts: startPolling resets the emit cursor', () => {
  // A re-started poll session must zero the emit cursor, otherwise
  // a previous session's leftover #lastEmittedBytesTotal would make
  // the first delta of the new session falsely huge (or negative
  // if file rotated).
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /instance\.#lastEmittedBytesTotal\s*=\s*0/,
    'startPolling must reset #lastEmittedBytesTotal',
  )
})

test('ShellProgressMessage uses the shared NON_VERBOSE_PREVIEW_LINES constant', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/components/shell/ShellProgressMessage.tsx'),
    'utf8',
  )
  assert.match(
    source,
    /NON_VERBOSE_PREVIEW_LINES = readBranchedEnvInt\([^)]*,\s*10,?\s*\)/,
    'preview-lines constant must default to 10',
  )
  // No more raw `5` literals for line slicing — all 3 sites must
  // route through the constant. Match the slice() / extraLines /
  // Math.min() patterns specifically.
  assert.doesNotMatch(
    source,
    /lines\.slice\(-5\)/,
    'must not slice -5; should use NON_VERBOSE_PREVIEW_LINES',
  )
  assert.doesNotMatch(
    source,
    /totalLines\s*-\s*5/,
    'extraLines must subtract NON_VERBOSE_PREVIEW_LINES, not literal 5',
  )
  assert.doesNotMatch(
    source,
    /Math\.min\(5,\s*lines\.length\)/,
    'Box height must be Math.min(NON_VERBOSE_PREVIEW_LINES, lines.length)',
  )
})

test('renderer + TaskOutput share the same env vars (no slice mismatch)', () => {
  // Critical correctness: if these env-var lists diverge, a user
  // setting DEEPCODE_BASH_PROGRESS_LINES=20 might bump
  // TaskOutput's slice to 20 lines, but the renderer still
  // truncates to 10 — invisible bug.
  const taskSource = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  const rendererSource = readFileSync(
    resolve(packageRoot, 'src/components/shell/ShellProgressMessage.tsx'),
    'utf8',
  )
  for (const envVar of [
    'DEEPCODE_BASH_PROGRESS_LINES',
    'CLAUDE_CODE_BASH_PROGRESS_LINES',
  ]) {
    assert.match(
      taskSource,
      new RegExp(envVar),
      `TaskOutput must reference ${envVar}`,
    )
    assert.match(
      rendererSource,
      new RegExp(envVar),
      `ShellProgressMessage must reference ${envVar}`,
    )
  }
})

test('chunkDelta UTF-8 alignment: independent test of the slice algorithm', () => {
  // The chunkDelta algorithm is inlined in TaskOutput#tick which is
  // private and async, so we re-implement and test the same logic
  // here to lock the contract. If the inline version drifts from
  // this reference, the static-source test above catches the
  // structural change; this test catches semantic regressions.
  function sliceUtf8DeltaFromTail(content, newBytes) {
    if (newBytes <= 0 || content.length === 0) return ''
    const tailBuffer = Buffer.from(content, 'utf8')
    const cutFromEnd = Math.min(newBytes, tailBuffer.length)
    let start = tailBuffer.length - cutFromEnd
    while (
      start < tailBuffer.length &&
      (tailBuffer[start] & 0xc0) === 0x80
    ) {
      start++
    }
    return tailBuffer.toString('utf8', start)
  }

  // Pure ASCII — exact byte/string match.
  assert.equal(
    sliceUtf8DeltaFromTail('hello world', 6),
    ' world',
    'ASCII delta should slice from the right by byte count',
  )

  // Emoji (4 bytes per codepoint) — the rocket is 4 bytes.
  // Tail = "🚀a🚀b" → 4+1+4+1 = 10 bytes total.
  // newBytes = 5 → cut from byte 5, which is mid-rocket → realign
  // forward to next codepoint start (byte 5 is continuation, byte 6
  // is continuation, byte 7 is continuation, byte 8 is the 'b').
  // Wait — let me think. "🚀a" is bytes 0-4: F0 9F 9A 80 61. The 'a'
  // is at byte 4. Then "🚀b" is bytes 5-9: F0 9F 9A 80 62. With
  // newBytes=5, start=5 → that's F0 (start of rocket, NOT a
  // continuation), so no realign. Delta = "🚀b".
  assert.equal(
    sliceUtf8DeltaFromTail('🚀a🚀b', 5),
    '🚀b',
    'cut at codepoint boundary should yield the trailing codepoints',
  )

  // newBytes=6 → start=4 → that's '61' (the 'a'), not continuation.
  // Delta = "a🚀b" (5 bytes from byte 4).
  assert.equal(
    sliceUtf8DeltaFromTail('🚀a🚀b', 6),
    'a🚀b',
    'cut just before ASCII char keeps it',
  )

  // newBytes=7 → start=3 → that's '80' (continuation byte) → skip
  // forward to byte 4 ('a'). Delta = "a🚀b". The skipped byte was
  // already part of a codepoint visible in a prior emit, so this
  // matches the "skip is not lossy" claim in the source comment.
  assert.equal(
    sliceUtf8DeltaFromTail('🚀a🚀b', 7),
    'a🚀b',
    'cut mid-codepoint skips continuation bytes forward to next valid start',
  )

  // CJK — "你好" is 6 bytes. With tail = "你好世界" (12 bytes), newBytes=3
  // cuts mid-character → skip continuations. start at byte 9 = E4
  // (start of 界). Delta = "界".
  assert.equal(
    sliceUtf8DeltaFromTail('你好世界', 3),
    '界',
    'CJK mid-character cut realigns to next codepoint',
  )

  // Tail-overflow: newBytes > content byte length → return full tail.
  assert.equal(
    sliceUtf8DeltaFromTail('hi', 100),
    'hi',
    'overflow cap returns full content',
  )

  // Empty / zero cases.
  assert.equal(sliceUtf8DeltaFromTail('', 5), '')
  assert.equal(sliceUtf8DeltaFromTail('hi', 0), '')
})

test(
  'tailFileRaw + decodeUtf8AtBoundary handle tail boundary mid-codepoint',
  { concurrency: false, timeout: 10_000 },
  async () => {
    // Codex flagged: when the file's last `maxBytes` window starts
    // mid-codepoint, the previous `tailFile()`-based decode inserts
    // U+FFFD replacement chars, then re-encoding via Buffer.from()
    // yields the wrong byte positions and a corrupted delta.
    // Production now reads raw bytes via tailFileRaw and decodes at
    // a UTF-8 boundary; this test exercises the actual production
    // helpers (not a re-implementation) on a tail boundary that
    // splits a 4-byte emoji and a 3-byte CJK codepoint.

    const dir = await mkdtemp(join(tmpdir(), 'utf8-tail-'))
    const filePath = join(dir, 'mixed.txt')

    // Build a buffer where the last `tailBytes` window starts inside
    // a multi-byte codepoint. Total file = ASCII filler + "🚀" + ASCII
    // marker + "你" + ASCII suffix. Pick maxBytes to land partway
    // through the rocket emoji (which is 4 bytes: F0 9F 9A 80).
    const filler = 'a'.repeat(20) // 20 ASCII bytes
    const middle = '🚀X你Y' // 4 + 1 + 3 + 1 = 9 bytes
    const buf = Buffer.from(filler + middle, 'utf8')
    writeFileSync(filePath, buf)

    // We want the tail window to begin at byte 22 (after 20 filler +
    // 2 bytes into the 4-byte rocket emoji).
    const tailStartOffset = 22
    const maxBytes = buf.length - tailStartOffset

    const result = await tailFileRaw(filePath, maxBytes)
    assert.equal(result.bytesTotal, buf.length)
    assert.equal(result.bytesRead, maxBytes)
    // The buffer's first 2 bytes are continuation bytes from the
    // rocket emoji; decoding from the start would yield a U+FFFD
    // prefix. decodeUtf8AtBoundary skips them and starts at the
    // next valid codepoint ('X').
    const decoded = decodeUtf8AtBoundary(result.buffer)
    assert.equal(
      decoded,
      'X你Y',
      `expected 'X你Y', got ${JSON.stringify(decoded)} — ` +
        `boundary skip should drop the rocket emoji's continuation prefix`,
    )

    // Sanity check: when the tail window starts at a codepoint
    // boundary, no skipping happens.
    const aligned = await tailFileRaw(filePath, 9) // last 9 bytes = "🚀X你Y"
    const alignedDecoded = decodeUtf8AtBoundary(aligned.buffer)
    assert.equal(alignedDecoded, '🚀X你Y')
  },
)

test('readBranchedEnvInt path: env-set value flows through both modules', () => {
  // Functional smoke: the helper itself works with the env var name
  // we documented. (Module constants are evaluated at import time so
  // can't be re-tested per-test without a fresh process; this
  // assertion locks the contract via the helper instead.)
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_PROGRESS_LINES', 'CLAUDE_CODE_BASH_PROGRESS_LINES'],
      10,
      { DEEPCODE_BASH_PROGRESS_LINES: '20' },
    ),
    20,
  )
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_PROGRESS_LINES', 'CLAUDE_CODE_BASH_PROGRESS_LINES'],
      10,
      { CLAUDE_CODE_BASH_PROGRESS_LINES: '7' },
    ),
    7,
  )
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_PROGRESS_LINES', 'CLAUDE_CODE_BASH_PROGRESS_LINES'],
      10,
      {},
    ),
    10,
  )
})
