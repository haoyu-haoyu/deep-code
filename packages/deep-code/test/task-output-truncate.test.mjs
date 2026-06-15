import assert from 'node:assert/strict'
import { test } from 'node:test'

import { truncateTaskOutput } from '../src/utils/task/taskOutputTruncate.mjs'

const HEADER = '[Truncated. Full output: /tmp/some/long/task/output/path.txt]\n\n'

test('output within the cap passes through untouched', () => {
  const out = 'short output'
  const r = truncateTaskOutput(out, 32_000, HEADER)
  assert.deepEqual(r, { content: out, wasTruncated: false })
})

test('output exactly at the cap passes through (boundary)', () => {
  const out = 'x'.repeat(100)
  const r = truncateTaskOutput(out, 100, HEADER)
  assert.equal(r.wasTruncated, false)
  assert.equal(r.content, out)
})

test('normal truncation: header + last N chars, total within the cap', () => {
  const out = 'abcdefghijklmnopqrstuvwxyz'.repeat(1000) // 26000 chars
  const maxLen = 1000
  const r = truncateTaskOutput(out, maxLen, HEADER)
  assert.equal(r.wasTruncated, true)
  assert.ok(r.content.startsWith(HEADER))
  // total content stays within the cap
  assert.ok(r.content.length <= maxLen, `content ${r.content.length} <= ${maxLen}`)
  const tail = r.content.slice(HEADER.length)
  // the kept portion is the *tail* of the output
  assert.ok(out.endsWith(tail))
  assert.equal(tail.length, maxLen - HEADER.length)
})

test('header length equal to cap → only the header, no tail', () => {
  const out = 'y'.repeat(5000)
  const maxLen = HEADER.length
  const r = truncateTaskOutput(out, maxLen, HEADER)
  assert.equal(r.wasTruncated, true)
  assert.equal(r.content, HEADER)
})

test('THE BUG: header longer than cap no longer leaks the whole output', () => {
  // maxLen smaller than the header (e.g. TASK_MAX_OUTPUT_LENGTH=1). The OLD code
  // computed availableSpace = maxLen - header.length < 0, then output.slice(-neg)
  // = output.slice(pos) which returns nearly the ENTIRE output.
  const out = 'z'.repeat(200_000)
  for (const maxLen of [1, 5, HEADER.length - 1]) {
    const r = truncateTaskOutput(out, maxLen, HEADER)
    assert.equal(r.wasTruncated, true)
    // content is exactly the header — nothing of the giant output leaks
    assert.equal(r.content, HEADER)
    assert.ok(
      r.content.length <= HEADER.length,
      `content ${r.content.length} must not exceed header ${HEADER.length}`,
    )
    // sanity: the OLD math would have returned ~the whole output
    const oldAvailable = maxLen - HEADER.length
    const oldContent = HEADER + out.slice(-oldAvailable)
    assert.ok(
      oldContent.length > 100_000,
      'old behavior leaked the bulk of the output (regression guard)',
    )
  }
})

test('content length is always bounded by header + max(0, maxLen - header.length)', () => {
  const out = 'q'.repeat(500_000)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 5000; i++) {
    const maxLen = 1 + Math.floor(rnd() * 4000)
    const r = truncateTaskOutput(out, maxLen, HEADER)
    const bound = HEADER.length + Math.max(0, maxLen - HEADER.length)
    assert.ok(
      r.content.length <= bound,
      `content ${r.content.length} <= ${bound} (maxLen=${maxLen})`,
    )
    if (r.wasTruncated) {
      assert.ok(r.content.startsWith(HEADER))
      assert.ok(out.endsWith(r.content.slice(HEADER.length)))
    }
  }
})
