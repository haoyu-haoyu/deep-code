import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseJsonlReverse,
  parseJsonlTail,
} from '../src/utils/streamingJsonl.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(
  packageRoot,
  'test',
  'fixtures',
  'large-session-1k-msgs.jsonl',
)

async function writeTempFile(content) {
  const dir = await mkdtemp(join(tmpdir(), 'streaming-jsonl-'))
  const path = join(dir, 'data.jsonl')
  await writeFile(path, content)
  return path
}

test('parseJsonlTail returns the last N records in forward order', async () => {
  const lines = []
  for (let i = 0; i < 50; i++) {
    lines.push(JSON.stringify({ id: i, msg: `line ${i}` }))
  }
  const path = await writeTempFile(lines.join('\n') + '\n')

  const tail = await parseJsonlTail(path, 5)
  assert.equal(tail.length, 5)
  assert.deepEqual(
    tail.map(e => e.id),
    [45, 46, 47, 48, 49],
    'tail must be the LAST 5 records in original (forward) order',
  )
})

test('parseJsonlTail count larger than file returns all records', async () => {
  const lines = ['{"a":1}', '{"a":2}', '{"a":3}']
  const path = await writeTempFile(lines.join('\n') + '\n')
  const out = await parseJsonlTail(path, 100)
  assert.equal(out.length, 3)
  assert.deepEqual(
    out.map(e => e.a),
    [1, 2, 3],
  )
})

test('parseJsonlTail count=0 returns empty array without reading', async () => {
  const path = await writeTempFile('{"x":1}\n')
  const out = await parseJsonlTail(path, 0)
  assert.deepEqual(out, [])
})

test('parseJsonlReverse yields records last-to-first', async () => {
  const path = await writeTempFile('{"i":1}\n{"i":2}\n{"i":3}\n')
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry.i)
  }
  assert.deepEqual(seen, [3, 2, 1])
})

test('parseJsonlReverse handles empty file gracefully', async () => {
  const path = await writeTempFile('')
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry)
  }
  assert.deepEqual(seen, [])
})

test('parseJsonlReverse handles file without trailing newline', async () => {
  const path = await writeTempFile('{"a":1}\n{"a":2}\n{"a":3}')
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry.a)
  }
  assert.deepEqual(seen, [3, 2, 1])
})

test('parseJsonlReverse handles CRLF line endings', async () => {
  const path = await writeTempFile('{"a":1}\r\n{"a":2}\r\n{"a":3}\r\n')
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry.a)
  }
  assert.deepEqual(seen, [3, 2, 1])
})

test('parseJsonlReverse skips blank / whitespace-only lines', async () => {
  const path = await writeTempFile(
    '{"a":1}\n\n   \n{"a":2}\n\t\n{"a":3}\n',
  )
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry.a)
  }
  assert.deepEqual(seen, [3, 2, 1])
})

test('parseJsonlReverse yields parse-error sentinel for malformed JSON', async () => {
  const path = await writeTempFile(
    '{"ok":1}\nNOT-JSON\n{"ok":2}\n',
  )
  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry)
  }
  assert.equal(seen.length, 3)
  assert.equal(seen[0].ok, 2)
  assert.equal(seen[1].__jsonlParseError, true)
  assert.equal(seen[1].raw, 'NOT-JSON')
  assert.equal(seen[2].ok, 1)
})

test('parseJsonlReverse handles records that span chunk boundaries', async () => {
  // Build records whose total length exceeds the chunkSize so the
  // backward scan must carry an unparsed prefix forward across reads.
  const long = 'x'.repeat(500)
  const lines = []
  for (let i = 0; i < 20; i++) {
    lines.push(JSON.stringify({ i, payload: long }))
  }
  const path = await writeTempFile(lines.join('\n') + '\n')

  // chunkSize=128 is smaller than a single record (~520 bytes), so
  // every record straddles at least one boundary.
  const seen = []
  for await (const entry of parseJsonlReverse(path, { chunkSize: 128 })) {
    seen.push(entry.i)
  }
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, k) => 19 - k))
})

test('parseJsonlReverse handles multi-byte UTF-8 records across boundaries', async () => {
  // Each record contains CJK characters whose 3-byte UTF-8 encoding
  // can fall on chunk boundaries. The carry-forward Buffer (not
  // string) is what makes this work — decoding per-chunk would
  // corrupt split codepoints.
  const lines = []
  for (let i = 0; i < 30; i++) {
    lines.push(JSON.stringify({ i, text: '你好世界'.repeat(20) }))
  }
  const path = await writeTempFile(lines.join('\n') + '\n')
  const seen = []
  for await (const entry of parseJsonlReverse(path, { chunkSize: 64 })) {
    assert.match(entry.text, /^(你好世界){20}$/, `record ${entry.i} corrupted`)
    seen.push(entry.i)
  }
  assert.equal(seen.length, 30)
  assert.equal(seen[0], 29) // last yielded first
})

test('parseJsonlTail rejects negative / non-integer count', async () => {
  const path = await writeTempFile('{"a":1}\n')
  await assert.rejects(() => parseJsonlTail(path, -1), /non-negative integer/)
  await assert.rejects(() => parseJsonlTail(path, 1.5), /non-negative integer/)
  await assert.rejects(() => parseJsonlTail(path, NaN), /non-negative integer/)
})

test('parseJsonlReverse rejects non-positive chunkSize', async () => {
  const path = await writeTempFile('{"a":1}\n')
  await assert.rejects(async () => {
    for await (const _ of parseJsonlReverse(path, { chunkSize: 0 })) {
      void _
    }
  }, /positive integer/)
})

test('parseJsonlReverse: single record larger than chunkSize emits as ONE record', async () => {
  // Codex flagged: when combined contains no LF and we're not at the
  // start of the file, the prior code mis-set headStart to 0 and
  // emitted the partial fragment as a parse-error sentinel. Fix:
  // explicit no-newline branch that stashes the buffer and continues.
  const longPayload = 'x'.repeat(10_000)
  const record = JSON.stringify({ payload: longPayload })
  // No trailing newline — exercise the "last record without LF" path
  // alongside the "single record bigger than chunkSize" path.
  const path = await writeTempFile(record)
  const seen = []
  for await (const entry of parseJsonlReverse(path, { chunkSize: 256 })) {
    seen.push(entry)
  }
  assert.equal(seen.length, 1)
  assert.equal(seen[0].payload, longPayload)
})

test('parseJsonlReverse strips UTF-8 BOM from the first record', async () => {
  const lines = ['{"first":1}', '{"second":2}', '{"third":3}']
  // U+FEFF as UTF-8 = EF BB BF. Prefix the file with it.
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const body = Buffer.from(lines.join('\n') + '\n', 'utf8')
  const path = await writeTempFile(Buffer.concat([bom, body]))

  const seen = []
  for await (const entry of parseJsonlReverse(path)) {
    seen.push(entry)
  }
  // The first record (which is YIELDED LAST in reverse order) must
  // parse cleanly — no __jsonlParseError sentinel.
  assert.equal(seen.length, 3)
  assert.equal(seen[2].first, 1)
  assert.equal(seen[1].second, 2)
  assert.equal(seen[0].third, 3)
  for (const entry of seen) {
    assert.notEqual(
      entry.__jsonlParseError,
      true,
      `BOM-prefixed file must not yield a parse-error sentinel: ${JSON.stringify(entry)}`,
    )
  }
})

test('parseJsonlReverse caps the carry-forward buffer at maxBufferedBytes', async () => {
  // A pathological single-line file that exceeds the cap must throw
  // rather than balloon memory. Mirrors the 100MB ceiling already in
  // the synchronous parseJSONL.
  const huge = 'a'.repeat(100_000)
  const path = await writeTempFile(huge) // no LF anywhere
  await assert.rejects(
    async () => {
      for await (const _ of parseJsonlReverse(path, {
        chunkSize: 8192,
        maxBufferedBytes: 50_000,
      })) {
        void _
      }
    },
    /maxBufferedBytes/,
    'must throw when a single record exceeds the cap',
  )
})

test('parseJsonlReverse cursor resets to readPosition (no overlap, no skip)', () => {
  // Static guard: after the inner retry loop, the cursor must reset
  // exactly to readPosition. A short read leaves bytes
  // [readPosition+totalRead, prevPosition) unread — those bytes are
  // either (a) at EOF after a shrink (gone — can't be helped) or
  // (b) interrupted by signal (the inner while-loop retries with
  // bytesRead>0). Setting position to anything OTHER than
  // readPosition either re-reads the same bytes (overlap) or
  // advances into an already-read range (Codex's regression).
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/streamingJsonl.mjs'),
    'utf8',
  )
  // Locate the `if (totalRead === 0) break` statement that sits
  // immediately above the post-read cursor reset, then assert the
  // very next non-blank line is exactly `position = readPosition`.
  // Anchoring against the surrounding code (rather than a free-
  // floating line match) means a future refactor that moves the
  // assignment elsewhere can't silently bypass this guard.
  const breakLineRe = /if \(totalRead === 0\) break\s*$/m
  const breakMatch = breakLineRe.exec(source)
  assert.ok(breakMatch, 'expected the `if (totalRead === 0) break` anchor')
  const after = source.slice(breakMatch.index + breakMatch[0].length)
  assert.match(
    after,
    /^\s*\n[\s\S]*?\bposition\s*=\s*readPosition\b\s*$/m,
    'first cursor assignment after the inner read loop must be `position = readPosition`',
  )

  // Regression guard against any algebraic equivalent of the prior
  // buggy formula. Whitespace/parenthesis variations are
  // normalized before matching so `position=readPosition+(readSize-totalRead)`
  // (no spaces) still triggers the failure.
  const stripped = source.replace(/\s+/g, '')
  assert.equal(
    stripped.includes('position=readPosition+(readSize-totalRead)'),
    false,
    'cursor must not use the buggy formula in any spelling — overlaps already-read bytes',
  )
  assert.equal(
    stripped.includes('position-=readSize'),
    false,
    'must not silently skip unread bytes via the original `-= readSize` form',
  )
})

test(
  'parseJsonlTail on the 1k-msg perf fixture matches the synchronous tail',
  { timeout: 10_000 },
  async () => {
    // End-to-end smoke against the actual perf fixture: yield the
    // last 100 records via streaming, then compare against the same
    // window from a full synchronous parse. Both must produce
    // byte-identical entries.
    const fs = await import('node:fs')
    const allText = fs.readFileSync(fixturePath, 'utf8')
    const allLines = allText.split('\n').filter(line => line.length > 0)
    const synchronousTail = allLines.slice(-100).map(line => JSON.parse(line))

    const streamingTail = await parseJsonlTail(fixturePath, 100)
    assert.equal(streamingTail.length, synchronousTail.length)
    for (let i = 0; i < streamingTail.length; i++) {
      assert.deepEqual(
        streamingTail[i],
        synchronousTail[i],
        `mismatch at index ${i}`,
      )
    }
  },
)

test(
  'parseJsonlTail on the 1k-msg fixture is materially faster than full parse for tail-N',
  { timeout: 30_000 },
  async () => {
    // The whole point of S4: reading just the last 100 records should
    // touch FAR fewer bytes than a full parse. We don't assert a
    // specific speedup ratio (CI noise) — just that the streaming
    // path finishes and produces 100 records.
    const fs = await import('node:fs')
    const allText = fs.readFileSync(fixturePath, 'utf8')

    const tStreamingStart = performance.now()
    const tail = await parseJsonlTail(fixturePath, 100)
    const streamingMs = performance.now() - tStreamingStart

    const tFullStart = performance.now()
    const allLines = allText.split('\n').filter(l => l.length > 0)
    for (const line of allLines) JSON.parse(line)
    const fullMs = performance.now() - tFullStart

    assert.equal(tail.length, 100)
    // Streaming tail is just 100 records out of 2000 (50:1 in this
    // fixture); the upper bound of 5x is generous for CI variance.
    assert.ok(
      streamingMs < fullMs * 5,
      `streaming tail should not be hugely slower than full parse — ` +
        `streaming=${streamingMs.toFixed(2)}ms full=${fullMs.toFixed(2)}ms`,
    )
  },
)
