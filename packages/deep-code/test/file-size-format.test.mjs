import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatFileSize } from '../src/utils/fileSize.mjs'

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB
const TiB = 1024 * GiB
const PiB = 1024 * TiB

test('THE FIX: a count of exactly 1 byte is singular; 0 and 2+ stay plural', () => {
  assert.equal(formatFileSize(1), '1 byte') // was "1 bytes"
  assert.equal(formatFileSize(0), '0 bytes')
  assert.equal(formatFileSize(2), '2 bytes')
  assert.equal(formatFileSize(1023), '1023 bytes')
})

test('existing KB/MB/GB behavior is unchanged', () => {
  assert.equal(formatFileSize(512), '512 bytes')
  assert.equal(formatFileSize(1536), '1.5KB')
  assert.equal(formatFileSize(1048575), '1MB') // 1 MiB - 1, rounds up + promotes
  assert.equal(formatFileSize(1073741823), '1GB') // 1 GiB - 1
  assert.equal(formatFileSize(2 * GiB), '2GB')
})

test('THE FIX: TiB+ values promote to TB/PB instead of rendering "1024GB"', () => {
  assert.equal(formatFileSize(TiB), '1TB') // was "1024GB"
  assert.equal(formatFileSize(1.5 * TiB), '1.5TB') // was "1536GB"
  assert.equal(formatFileSize(PiB), '1PB') // was "1048576GB"
})

test('the "1024<unit>" anti-pattern never appears at the TB boundary either', () => {
  // 1 PiB - epsilon rounds to a full 1024 TB -> must carry up to "1PB"
  assert.equal(formatFileSize(PiB - GiB), '1PB')
  // the rendered string never contains "1024"
  for (const bytes of [TiB, 1.5 * TiB, PiB, 1023 * TiB]) {
    assert.ok(!formatFileSize(bytes).startsWith('1024'), `${bytes}`)
  }
})
