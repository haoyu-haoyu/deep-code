import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subcommandsForDenyCheck } from '../src/tools/BashTool/subcommandsForDenyCheck.mjs'

// Stub splitter mirroring splitCommand_DEPRECATED's shape: subcommands plus
// standalone operator tokens.
const splits = {
  'rm -rf /tmp/x &': ['rm -rf /tmp/x', '&'],
  'echo hi & rm -rf /tmp/x': ['echo hi', '&', 'rm -rf /tmp/x'],
  'echo hi |& rm -rf /tmp/x': ['echo hi', '|&', 'rm -rf /tmp/x'],
  '(rm -rf /tmp/x)': ['(', 'rm -rf /tmp/x', ')'],
  'echo a && rm b': ['echo a', 'rm b'],
}
const splitFn = c => splits[c] ?? [c]

test('keeps the wrapped commands of a background list, drops the & operator', () => {
  assert.deepEqual(subcommandsForDenyCheck('rm -rf /tmp/x &', splitFn), [
    'rm -rf /tmp/x',
  ])
  assert.deepEqual(subcommandsForDenyCheck('echo hi & rm -rf /tmp/x', splitFn), [
    'echo hi',
    'rm -rf /tmp/x',
  ])
})

test('drops the |& operator token', () => {
  assert.deepEqual(
    subcommandsForDenyCheck('echo hi |& rm -rf /tmp/x', splitFn),
    ['echo hi', 'rm -rf /tmp/x'],
  )
})

test('drops subshell parentheses, keeps the inner command', () => {
  assert.deepEqual(subcommandsForDenyCheck('(rm -rf /tmp/x)', splitFn), [
    'rm -rf /tmp/x',
  ])
})

test('pure-operator and empty tokens are dropped (no word character)', () => {
  const split = () => ['&', '|&', '(', ')', ';', '&&', '||', '>>', '  ', '', '|']
  assert.deepEqual(subcommandsForDenyCheck('x', split), [])
})

test('order is preserved and whitespace is trimmed', () => {
  const split = () => ['  echo a  ', '&', '  rm b ']
  assert.deepEqual(subcommandsForDenyCheck('x', split), ['echo a', 'rm b'])
})

test('null/undefined tokens from the splitter are tolerated', () => {
  const split = () => ['rm x', null, undefined, '&']
  assert.deepEqual(subcommandsForDenyCheck('x', split), ['rm x'])
})

test('a plain single command passes through', () => {
  assert.deepEqual(subcommandsForDenyCheck('rm -rf /tmp/x', c => [c]), [
    'rm -rf /tmp/x',
  ])
})
