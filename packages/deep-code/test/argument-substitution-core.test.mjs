import { test } from 'node:test'
import assert from 'node:assert/strict'

import { substituteArgumentsCore } from '../src/utils/argumentSubstitutionCore.mjs'

// ---------------------------------------------------------------------------
// Differential oracle: the EXACT pre-fix four-pass substitution. Each pass
// re-scanned the previous pass's output, so a value containing a placeholder
// ($1 / $ARGUMENTS / $ARGUMENTS[0]) was expanded a second time. We assert the
// old code produced the wrong text and the leaf produces the right text.
// ---------------------------------------------------------------------------
const replaceAllLiteral = (content, search, value) =>
  content.replaceAll(search, () => value)
const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function oldSubstitute(content, parsedArgs, fullArgs, argumentNames = []) {
  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i]
    if (!name) continue
    content = replaceAllLiteral(
      content,
      new RegExp(`\\$${escapeRegExp(name)}(?![\\[\\w])`, 'g'),
      parsedArgs[i] ?? '',
    )
  }
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, s) =>
    parsedArgs[parseInt(s, 10)] ?? '',
  )
  content = content.replace(/\$(\d+)(?!\w)/g, (_, s) =>
    parsedArgs[parseInt(s, 10)] ?? '',
  )
  content = replaceAllLiteral(content, '$ARGUMENTS', fullArgs)
  return content
}

// ---- The four confirmed double-expansion manifestations --------------------

test('BUG 1: a value of "$ARGUMENTS" substituted into $0 is not re-expanded', () => {
  const parsedArgs = ['$ARGUMENTS', 'foo']
  const fullArgs = '$ARGUMENTS foo'
  assert.equal(
    substituteArgumentsCore('X: $0', parsedArgs, fullArgs),
    'X: $ARGUMENTS',
  )
  // old behavior: the inserted "$ARGUMENTS" got re-expanded by the final pass
  assert.equal(
    oldSubstitute('X: $0', parsedArgs, fullArgs),
    'X: $ARGUMENTS foo',
  )
})

test('BUG 2: a value of "$1" substituted into a named $foo is not re-expanded', () => {
  const parsedArgs = ['$1', 'bar']
  const fullArgs = '$1 bar'
  const names = ['foo']
  assert.equal(
    substituteArgumentsCore('X: $foo', parsedArgs, fullArgs, names),
    'X: $1',
  )
  assert.equal(oldSubstitute('X: $foo', parsedArgs, fullArgs, names), 'X: bar')
})

test('BUG 3: a value of "$1" substituted into $ARGUMENTS[0] is not re-expanded', () => {
  const parsedArgs = ['$1', 'zzz']
  const fullArgs = '$1 zzz'
  assert.equal(
    substituteArgumentsCore('X: $ARGUMENTS[0]', parsedArgs, fullArgs),
    'X: $1',
  )
  assert.equal(
    oldSubstitute('X: $ARGUMENTS[0]', parsedArgs, fullArgs),
    'X: zzz',
  )
})

test('BUG 4: a value of "$ARGUMENTS" substituted into $ARGUMENTS[0] is not re-expanded', () => {
  const parsedArgs = ['$ARGUMENTS', 'bbb']
  const fullArgs = '$ARGUMENTS bbb'
  assert.equal(
    substituteArgumentsCore('X: $ARGUMENTS[0]', parsedArgs, fullArgs),
    'X: $ARGUMENTS',
  )
  assert.equal(
    oldSubstitute('X: $ARGUMENTS[0]', parsedArgs, fullArgs),
    'X: $ARGUMENTS bbb',
  )
})

// ---- Control: ordinary values (no placeholder chars) are unaffected --------

test('control: plain values substitute exactly as before', () => {
  const parsedArgs = ['hello', 'world']
  const fullArgs = 'hello world'
  assert.equal(
    substituteArgumentsCore('X: $0 Y: $1', parsedArgs, fullArgs),
    'X: hello Y: world',
  )
  // when no value contains a placeholder, the old and new paths agree
  assert.equal(
    substituteArgumentsCore('X: $0 Y: $1', parsedArgs, fullArgs),
    oldSubstitute('X: $0 Y: $1', parsedArgs, fullArgs),
  )
})

// ---- $$ / $& / backtick-$ / $' inside a value stay literal -----------------

test("a value containing $$ / $& / $' is spliced verbatim (no replacement-pattern interpretation)", () => {
  const fullArgs = "$$5 & $& and $' and $`"
  assert.equal(
    substituteArgumentsCore('cost: $ARGUMENTS', [], fullArgs),
    "cost: $$5 & $& and $' and $`",
  )
  const named = substituteArgumentsCore('v=$foo', ['a$$b$&c'], '', ['foo'])
  assert.equal(named, 'v=a$$b$&c')
})

// ---- Precedence and boundary behavior is preserved -------------------------

test('$ARGUMENTS[n] wins over bare $ARGUMENTS', () => {
  assert.equal(
    substituteArgumentsCore('$ARGUMENTS[1]', ['a', 'b'], 'a b'),
    'b',
  )
})

test('bare $ARGUMENTS has no trailing boundary (matches old literal replace)', () => {
  assert.equal(
    substituteArgumentsCore('$ARGUMENTSx', [], 'VAL'),
    'VALx',
  )
})

test('a named argument matches as a whole token only', () => {
  const names = ['foo']
  // $foobar and $foo[0] are NOT the named arg
  assert.equal(
    substituteArgumentsCore('$foobar', ['X'], '', names),
    '$foobar',
  )
  assert.equal(substituteArgumentsCore('$foo', ['X'], '', names), 'X')
})

test('overlapping names: the longer name still resolves to its own value', () => {
  const names = ['foo', 'foobar']
  const parsedArgs = ['A', 'B']
  assert.equal(
    substituteArgumentsCore('$foobar $foo', parsedArgs, '', names),
    'B A',
  )
  // identical to the old sequential behavior
  assert.equal(
    substituteArgumentsCore('$foobar $foo', parsedArgs, '', names),
    oldSubstitute('$foobar $foo', parsedArgs, '', names),
  )
})

test('a name "ARGUMENTS" takes precedence over bare $ARGUMENTS but not $ARGUMENTS[n]', () => {
  const names = ['ARGUMENTS']
  assert.equal(
    substituteArgumentsCore('$ARGUMENTS', ['NAMED'], 'FULL', names),
    'NAMED',
  )
  assert.equal(
    substituteArgumentsCore('$ARGUMENTS[0]', ['IDX'], 'FULL', names),
    'IDX',
  )
})

test('glued-adjacent placeholders each resolve to their own value (old left $1 literal)', () => {
  // The ONE intentional behavior change vs the four-pass code, surfaced by
  // adversarial fuzzing. With placeholders glued (no separator) and the right
  // value word-starting, the old passes expanded $ARGUMENTS[0] first, which
  // shifted $1's trailing (?!\w) boundary so $1 was left LITERAL.
  const parsedArgs = ['a', 'b']
  const fullArgs = 'a b'
  // new: $1 -> parsedArgs[1]='b', $ARGUMENTS[0] -> parsedArgs[0]='a'
  assert.equal(
    substituteArgumentsCore('$1$ARGUMENTS[0]', parsedArgs, fullArgs),
    'ba',
  )
  // old artifact: left $1 literal because the neighbor expanded first
  assert.equal(oldSubstitute('$1$ARGUMENTS[0]', parsedArgs, fullArgs), '$1a')
  // sanity: $1$2 (both in the same old pass) already agreed and still does
  assert.equal(substituteArgumentsCore('$1$0', parsedArgs, fullArgs), 'ba')
  assert.equal(oldSubstitute('$1$0', parsedArgs, fullArgs), 'ba')
})

test('separated placeholders are byte-identical to the old four-pass code', () => {
  // The realistic class: every placeholder followed by ordinary (non-$, non-word
  // -gluing) text. These MUST agree with the old behavior.
  const parsedArgs = ['one', 'two', 'three']
  const fullArgs = 'one two three'
  const names = ['alpha', 'beta']
  const tpl =
    'A=$alpha B=$beta first=$ARGUMENTS[0] short=$1 all=[$ARGUMENTS] end.'
  assert.equal(
    substituteArgumentsCore(tpl, parsedArgs, fullArgs, names),
    oldSubstitute(tpl, parsedArgs, fullArgs, names),
  )
})

test('missing indexed / named args become empty strings', () => {
  // $5 and $bar are whole tokens here (not followed by a word char)
  assert.equal(substituteArgumentsCore('a:$5:b', ['x'], 'x'), 'a::b')
  assert.equal(substituteArgumentsCore('$bar', [], '', ['bar']), '')
})

test('empty names in the array are skipped, index alignment preserved', () => {
  const names = ['', 'foo']
  const parsedArgs = ['x', 'y']
  assert.equal(substituteArgumentsCore('$foo', parsedArgs, '', names), 'y')
})

test('a regex-special name is matched literally, never as a pattern', () => {
  // a name like "a.b" must match only the literal "$a.b", not "$axb"
  const names = ['a.b']
  assert.equal(substituteArgumentsCore('$a.b', ['HIT'], '', names), 'HIT')
  assert.equal(substituteArgumentsCore('$axb', ['HIT'], '', names), '$axb')
})
