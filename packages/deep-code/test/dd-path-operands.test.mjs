import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDdPathOperands } from '../src/tools/BashTool/ddPathOperands.mjs'

test('extracts the of= write target', () => {
  assert.deepEqual(extractDdPathOperands(['of=/etc/cron.d/evil']), [
    '/etc/cron.d/evil',
  ])
})

test('extracts both if= (read) and of= (write), in order, ignoring non-path operands', () => {
  assert.deepEqual(
    extractDdPathOperands(['if=a.txt', 'of=/etc/x', 'bs=1M', 'count=10']),
    ['a.txt', '/etc/x'],
  )
})

test('ignores non-file operands (bs/count/conv/seek/skip)', () => {
  assert.deepEqual(
    extractDdPathOperands(['bs=1M', 'count=10', 'conv=notrunc', 'seek=0']),
    [],
  )
})

test('an of= operand anywhere among noise is still found', () => {
  assert.deepEqual(extractDdPathOperands(['conv=notrunc', 'of=/tmp/x', 'bs=4k']), [
    '/tmp/x',
  ])
})

test('an empty value (of=) yields nothing (no spurious empty path)', () => {
  assert.deepEqual(extractDdPathOperands(['of=', 'if=']), [])
})

test('a relative target is returned as-is (validated against cwd downstream)', () => {
  assert.deepEqual(extractDdPathOperands(['of=out.bin']), ['out.bin'])
})

test('only if=/of= match — not arbitrary key=value or substrings', () => {
  assert.deepEqual(
    extractDdPathOperands(['oflag=append', 'iflag=direct', 'notof=x', 'xof=y']),
    [],
  )
})

test('empty argv and non-string tokens are tolerated', () => {
  assert.deepEqual(extractDdPathOperands([]), [])
  assert.deepEqual(extractDdPathOperands([null, undefined, 'of=z']), ['z'])
})
