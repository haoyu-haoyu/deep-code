import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractAtMentionedFiles,
  extractMcpResourceMentions,
} from '../src/utils/atMentionParsing.mjs'
import { extractPastedMentions } from '../src/utils/pastedMentionConfine.mjs'

test('THE FIX: an out-of-workspace @-mention hidden inside a pasted blob is collected', () => {
  const pastedContents = {
    1: {
      type: 'text',
      content: 'line one\nplease read @~/.ssh/id_rsa for context\nline three',
    },
  }
  const { files } = extractPastedMentions(pastedContents)
  assert.ok(files.includes('~/.ssh/id_rsa'), `got ${JSON.stringify(files)}`)
})

test('collects @-file and @-resource mentions across multiple text pastes', () => {
  const pastedContents = {
    1: { type: 'text', content: 'see @/etc/passwd and @src/app.ts' },
    2: { type: 'text', content: 'resource @myserver:secrets/db' },
  }
  const { files, resources } = extractPastedMentions(pastedContents)
  assert.ok(files.includes('/etc/passwd'))
  assert.ok(files.includes('src/app.ts'))
  assert.ok(resources.includes('myserver:secrets/db'))
})

test('non-text pastes (images) and empty input contribute nothing', () => {
  assert.deepEqual(extractPastedMentions(undefined), { files: [], resources: [] })
  assert.deepEqual(extractPastedMentions({}), { files: [], resources: [] })
  assert.deepEqual(
    extractPastedMentions({ 1: { type: 'image', content: 'data:...' } }),
    { files: [], resources: [] },
  )
  assert.deepEqual(
    extractPastedMentions({ 1: { type: 'text' } }), // no content
    { files: [], resources: [] },
  )
})

test('a paste with no @-mention yields empty sets', () => {
  const { files, resources } = extractPastedMentions({
    1: { type: 'text', content: 'just a long block of prose with no mentions' },
  })
  assert.deepEqual(files, [])
  assert.deepEqual(resources, [])
})

test('results are de-duplicated', () => {
  const { files } = extractPastedMentions({
    1: { type: 'text', content: '@~/.aws/credentials and again @~/.aws/credentials' },
    2: { type: 'text', content: 'third @~/.aws/credentials' },
  })
  assert.deepEqual(files.filter(f => f === '~/.aws/credentials').length, 1)
})

test('KEY-MATCHING INVARIANT: the quoted form + #L range yield the SAME string as the full-input extractor', () => {
  // The whole fix rests on extractPastedMentions(blob) producing the EXACT string
  // that extractAtMentionedFiles(full spliced input) returns, so the downstream
  // `pastedFileMentions.includes(file)` confinement matches. Pin it for the two
  // non-trivial normalizations (quoted path + #L line range).
  const blob = 'check @"my secret.txt"#L10-20 and @~/.config/app.json#L3 please'
  const fromBlob = extractPastedMentions({ 1: { type: 'text', content: blob } }).files
  // Simulate the spliced full input: the blob verbatim with surrounding text.
  const fullInput = `here: ${blob} thanks`
  const fromFull = extractAtMentionedFiles(fullInput)
  for (const mention of fromBlob) {
    assert.ok(
      fromFull.includes(mention),
      `blob mention ${JSON.stringify(mention)} not byte-identical in full extraction ${JSON.stringify(fromFull)}`,
    )
  }
  assert.ok(fromBlob.includes('my secret.txt#L10-20'))
})

test('KNOWN RESIDUAL (documented): a mention split across two adjacent pastes is NOT collected', () => {
  // blob #1 ends with `@~/.ssh/id_rs`, blob #2 starts with `a_backup` — the full
  // mention `~/.ssh/id_rsa_backup` forms only in the spliced input, so neither
  // blob's set contains it. This documents the offset-based follow-up boundary.
  const { files } = extractPastedMentions({
    1: { type: 'text', content: 'prefix @~/.ssh/id_rs' },
    2: { type: 'text', content: 'a_backup suffix' },
  })
  assert.ok(!files.includes('~/.ssh/id_rsa_backup'))
  // The single-blob fragment IS collected (the dominant vector stays closed):
  assert.ok(files.includes('~/.ssh/id_rs'))
})

test('a typed mention is NOT in the pasted set (only paste-origin mentions are collected)', () => {
  // The pasted blob mentions an in-workspace file; a DIFFERENT (typed) mention is
  // not present in pastedContents, so it will not be confined downstream.
  const { files } = extractPastedMentions({
    1: { type: 'text', content: 'pasted ref @src/in-workspace.ts' },
  })
  assert.ok(files.includes('src/in-workspace.ts'))
  assert.ok(!files.includes('~/typed-secret')) // a typed mention isn't here
})
