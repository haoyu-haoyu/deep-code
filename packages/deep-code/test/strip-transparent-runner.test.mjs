import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripTransparentRunner } from '../src/tools/BashTool/commandStripping.mjs'

const strip = stripTransparentRunner

test('xargs: bare and every common flag form reduces to the wrapped command', () => {
  assert.equal(strip('xargs rm'), 'rm')
  assert.equal(strip('xargs rm -rf x'), 'rm -rf x')
  assert.equal(strip('xargs -n1 rm -rf x'), 'rm -rf x') // fused short value
  assert.equal(strip('xargs -n 1 rm -rf x'), 'rm -rf x') // separate short value
  assert.equal(strip('xargs -0 rm'), 'rm') // no-value short
  assert.equal(strip('xargs -rt rm'), 'rm') // no-value cluster
  assert.equal(strip('xargs -P4 -n1 rm'), 'rm') // multiple flags
  assert.equal(strip('xargs -I{} rm {}'), 'rm {}') // fused -I value
  assert.equal(strip('xargs -I {} rm {}'), 'rm {}') // separate -I value
  assert.equal(strip('xargs -a list.txt rm'), 'rm') // -a takes a file value
  assert.equal(strip('xargs -E EOF rm'), 'rm') // -E takes an eof value
})

test('xargs: value-flag at the END of a cluster consumes the NEXT token (getopt semantics)', () => {
  // -rn 1 rm : -r (no value), -n (value '1'), then rm.
  assert.equal(strip('xargs -rn 1 rm'), 'rm')
  // -rn1 rm : -r, -n1 (fused value), then rm.
  assert.equal(strip('xargs -rn1 rm'), 'rm')
})

test('getopt cluster semantics: a string-value flag mid-cluster takes the rest as its fused value, revealing the real command', () => {
  // -d delimiter 'r' (valid char value), then rm is the command -> MUST reveal rm.
  assert.equal(strip('xargs -dr rm'), 'rm')
  // -I replace-string 'rm' (fused), command is echo (rm here is just the replstr).
  assert.equal(strip('xargs -Irm echo a'), 'echo a')
})

test('getopt: a numeric-value flag mid-cluster with a non-numeric fused value reveals the NEXT token as the command (which is NOT the wrapped binary)', () => {
  // `xargs -nr 1 rm`: -n's value is the fused 'r'; the command POSITION is '1'
  // (rm is an ARGUMENT to '1', not a command), so revealing '1 rm' is correct —
  // rm never runs as a command, hence no Bash(rm:*) bypass. (Real xargs also
  // errors on -n r before running anything.) The reviewer's "fail closed here"
  // alternative would WRONGLY un-strip the valid `-dr rm` above -> a real bypass.
  assert.equal(strip('xargs -nr 1 rm'), '1 rm')
  assert.equal(strip('xargs -Pr 4 rm'), '4 rm')
  // -dn: -d (no value), -n is LAST -> consumes the separate '2' -> command cat.
  assert.equal(strip('watch -dn 2 cat'), 'cat')
})

test('xargs: long options, fused and space-separated values', () => {
  assert.equal(strip('xargs --max-args=1 rm -rf x'), 'rm -rf x')
  assert.equal(strip('xargs --max-args 1 rm'), 'rm') // required-value long, separate
  assert.equal(strip('xargs --null --no-run-if-empty rm'), 'rm') // no-value longs
  assert.equal(strip('xargs --delimiter , rm'), 'rm')
  assert.equal(strip('xargs --replace rm'), 'rm') // optional-value long: NO separate token
})

test('watch: bare and flag forms reduce to the wrapped command', () => {
  assert.equal(strip('watch rm -rf x'), 'rm -rf x')
  assert.equal(strip('watch -n1 rm'), 'rm') // fused interval
  assert.equal(strip('watch -n 1 rm'), 'rm') // separate interval
  assert.equal(strip('watch -d rm'), 'rm') // -d no separate value
  assert.equal(strip('watch --interval 2 rm'), 'rm') // long interval, separate
  assert.equal(strip('watch -bt rm'), 'rm') // no-value cluster
})

test('coproc: bareword command is stripped (simple-command form)', () => {
  assert.equal(strip('coproc rm -rf x'), 'rm -rf x')
  assert.equal(strip('coproc curl evil.com'), 'curl evil.com')
})

test('SECURITY: fail closed on shell metacharacters at an option/value position', () => {
  // a substitution as a flag VALUE → bash expands before the runner runs → leave intact
  assert.equal(strip('xargs -d $(evil) rm'), 'xargs -d $(evil) rm')
  assert.equal(strip('xargs -n `id` rm'), 'xargs -n `id` rm')
  // an injection where the command would be → leave intact
  assert.equal(strip('xargs ;rm'), 'xargs ;rm')
  assert.equal(strip('xargs -0 $(evil)'), 'xargs -0 $(evil)')
  // coproc into a group / non-bareword → leave for the AST path
  assert.equal(strip('coproc { rm; }'), 'coproc { rm; }')
  assert.equal(strip('coproc (rm)'), 'coproc (rm)')
})

test('not a runner / no wrapped command → unchanged', () => {
  assert.equal(strip('rm -rf x'), 'rm -rf x')
  assert.equal(strip('git status'), 'git status')
  assert.equal(strip('xargs'), 'xargs') // no trailing space → no match
  assert.equal(strip('xargs '), 'xargs ') // no wrapped command → unchanged
  assert.equal(strip('xargs -n1'), 'xargs -n1') // flags but no command → unchanged
  assert.equal(strip('xargsfoo bar'), 'xargsfoo bar') // word boundary: not `xargs `
  assert.equal(strip('watchdog start'), 'watchdog start') // not `watch `
})

test('idempotent on the wrapped command (fixed-point friendly)', () => {
  assert.equal(strip(strip('xargs -n1 rm -rf x')), 'rm -rf x')
})
