import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripControlFlowLeadIn } from '../src/tools/BashTool/commandStripping.mjs'

const strip = stripControlFlowLeadIn

test('peels a brace-group open so the wrapped command is exposed', () => {
  // splitCommand glues `{ ` to the first command of a `{ …; }` group.
  assert.equal(strip('{ rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('{ rm'), 'rm')
  assert.equal(strip('{\trm -rf x'), 'rm -rf x')
  assert.equal(strip('{\nrm -rf x'), 'rm -rf x') // brace then newline
})

test('peels condition-position keywords (if/elif/while/until <cmd>)', () => {
  assert.equal(strip('if rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('elif rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('while rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('until rm -rf /tmp/x'), 'rm -rf /tmp/x')
})

test('peels body-position keywords (then/do/else <cmd>)', () => {
  assert.equal(strip('then rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('do rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('else rm -rf /tmp/x'), 'rm -rf /tmp/x')
})

test('peels exactly ONE lead-in (the deny/ask fixed-point re-applies for nesting)', () => {
  // `{ if true; then rm; fi; }` first subcommand is `{ if true`.
  assert.equal(strip('{ if true'), 'if true')
  // A second pass (what the fixed-point does) reduces `if true` → `true`.
  assert.equal(strip(strip('{ if true')), 'true')
})

test('WHOLE-WORD boundary: a longer word starting with a keyword is NOT peeled', () => {
  assert.equal(strip('iffy build'), 'iffy build')
  assert.equal(strip('done'), 'done') // loop terminator, not `do `
  assert.equal(strip('doc generate'), 'doc generate')
  assert.equal(strip('thence go'), 'thence go')
  assert.equal(strip('elsewhere run'), 'elsewhere run')
  assert.equal(strip('whilst wait'), 'whilst wait')
  assert.equal(strip('untilx run'), 'untilx run')
})

test('brace requires the bash-mandated space — `{}`/`${x}`/`{a,b}` are untouched', () => {
  assert.equal(strip('{}'), '{}')
  assert.equal(strip('${x} run'), '${x} run')
  assert.equal(strip('{a,b}'), '{a,b}') // brace expansion, no space → not a group
  assert.equal(strip("find . -name '{}'"), "find . -name '{}'")
})

test('headers whose next token is NOT a command are left alone (for/case/select/function)', () => {
  assert.equal(strip('for i in 1 2 3'), 'for i in 1 2 3')
  assert.equal(strip('case x in'), 'case x in')
  assert.equal(strip('select x in a b'), 'select x in a b')
  assert.equal(strip('function foo'), 'function foo')
})

test('plain commands and terminators are unchanged', () => {
  assert.equal(strip('rm -rf /tmp/x'), 'rm -rf /tmp/x')
  assert.equal(strip('echo do not remove'), 'echo do not remove')
  assert.equal(strip('git status'), 'git status')
  assert.equal(strip('}'), '}')
  assert.equal(strip('fi'), 'fi')
})

test('a lead-in with no following command keeps the original (no empty result)', () => {
  assert.equal(strip('then '), 'then ')
  assert.equal(strip('{ '), '{ ')
  assert.equal(strip('do\t'), 'do\t')
})
