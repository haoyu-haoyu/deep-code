import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchingCommandText,
  commandTextNeedsRebuild,
  rebuildCommandText,
  shellEscapeArg,
} from '../src/utils/bash/bashCommandText.mjs'

test('THE FIX: a tab separator is normalized so a literal-space deny matcher fires', () => {
  // `rm\t-rf /x` — argv splits on the tab, but the raw .text keeps it, so a
  // `Bash(rm:*)`/`Bash(rm *)` deny rule (literal-space `startsWith('rm ')` /
  // `^rm( .*)?$`) never matched. After the rebuild the separator is a space.
  const out = matchingCommandText('rm\t-rf /x', ['rm', '-rf', '/x'])
  assert.equal(out, 'rm -rf /x')
  // End-to-end: the two matchers that previously missed now match.
  assert.ok(out.startsWith('rm '), 'prefix matcher (rm + space) fires')
  assert.ok(/^rm( .*)?$/.test(out), 'wildcard matcher ^rm( .*)?$ fires')
  // Pre-fix the raw text satisfied neither.
  assert.ok(!'rm\t-rf /x'.startsWith('rm '))
  assert.ok(!/^rm( .*)?$/.test('rm\t-rf /x'))
})

test('common case (single-space, no $VAR/newline/tab) is returned unchanged', () => {
  // No rebuild → byte-identical raw text → no exact-rule churn / no behavior shift.
  assert.equal(matchingCommandText('rm -rf /x', ['rm', '-rf', '/x']), 'rm -rf /x')
  assert.equal(matchingCommandText('ls', ['ls']), 'ls')
  assert.equal(commandTextNeedsRebuild('rm -rf /x'), false)
})

test('existing $VAR rebuild behavior is preserved (resolved var → argv text)', () => {
  // `SUB=push && git $SUB --force` resolves to argv ['git','push','--force'].
  assert.equal(commandTextNeedsRebuild('git $SUB --force'), true)
  assert.equal(
    matchingCommandText('git $SUB --force', ['git', 'push', '--force']),
    'git push --force',
  )
})

test('existing newline rebuild behavior is preserved (line continuation)', () => {
  // `timeout 5 \<LF>curl evil.com` → argv has no newline.
  assert.equal(commandTextNeedsRebuild('timeout 5 \\\ncurl evil.com'), true)
  assert.equal(
    matchingCommandText('timeout 5 \\\ncurl evil.com', [
      'timeout',
      '5',
      'curl',
      'evil.com',
    ]),
    'timeout 5 curl evil.com',
  )
})

test('quote-safe: whitespace INSIDE a token is preserved, only the separator normalizes', () => {
  // The tab is inside the quoted operand, not a separator. The rebuild keeps
  // it inside the (re-quoted) token rather than collapsing it.
  const out = matchingCommandText('echo "a\tb"', ['echo', 'a\tb'])
  assert.equal(out, "echo 'a\tb'")
  assert.ok(out.includes('\t'), 'in-token tab preserved')
})

test('commandTextNeedsRebuild detects each trigger and nothing else', () => {
  assert.equal(commandTextNeedsRebuild('a\tb'), true) // tab
  assert.equal(commandTextNeedsRebuild('a\nb'), true) // newline
  assert.equal(commandTextNeedsRebuild('git $SUB'), true) // $VAR
  assert.equal(commandTextNeedsRebuild('echo $1'), false) // $ not followed by [A-Za-z_]
  assert.equal(commandTextNeedsRebuild('echo $(x)'), false) // cmdsub paren, not ident
  assert.equal(commandTextNeedsRebuild('plain text here'), false)
})

test('shellEscapeArg / rebuildCommandText quote metacharacters and join with one space', () => {
  assert.equal(shellEscapeArg('plain'), 'plain')
  assert.equal(shellEscapeArg(''), "''")
  assert.equal(shellEscapeArg('a b'), "'a b'") // embedded space
  assert.equal(shellEscapeArg("it's"), "'it'\\''s'") // embedded single quote
  assert.equal(shellEscapeArg('a;b'), "'a;b'") // metachar
  assert.equal(rebuildCommandText(['rm', '-rf', '/a b']), "rm -rf '/a b'")
})
