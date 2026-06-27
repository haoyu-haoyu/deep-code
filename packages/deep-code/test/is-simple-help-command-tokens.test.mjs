import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSimpleHelpCommandTokens } from '../src/utils/bash/isSimpleHelpCommandTokens.mjs'

test('plain `cmd --help` qualifies', () => {
  assert.equal(isSimpleHelpCommandTokens(['git', 'log', '--help']), true)
  assert.equal(isSimpleHelpCommandTokens(['cmd', '--help']), true)
  assert.equal(isSimpleHelpCommandTokens(['--help']), true)
})

test('an operator token (compound command) disqualifies', () => {
  // shell-quote parses `git && log --help` into a list containing a {op:'&&'}
  // object; the old loop skipped non-string tokens and wrongly returned true,
  // offering `git && log --help:*` as an auto-allowable permission prefix.
  assert.equal(
    isSimpleHelpCommandTokens(['git', { op: '&&' }, 'log', '--help']),
    false,
  )
  assert.equal(
    isSimpleHelpCommandTokens(['cmd', '--help', { op: '|' }, 'evil']),
    false,
  )
})

test('a comment token disqualifies', () => {
  assert.equal(
    isSimpleHelpCommandTokens(['cmd', { comment: ' x' }, '--help']),
    false,
  )
})

test('any flag other than --help disqualifies', () => {
  assert.equal(isSimpleHelpCommandTokens(['cmd', '-x', '--help']), false)
  assert.equal(isSimpleHelpCommandTokens(['cmd', '--foo', '--help']), false)
})

test('a non-alphanumeric non-flag token disqualifies', () => {
  assert.equal(isSimpleHelpCommandTokens(['cat', 'foo.txt', '--help']), false)
  assert.equal(isSimpleHelpCommandTokens(['cmd', '/etc/passwd', '--help']), false)
})

test('no --help present does not qualify', () => {
  assert.equal(isSimpleHelpCommandTokens(['git', 'log']), false)
  assert.equal(isSimpleHelpCommandTokens([]), false)
})
