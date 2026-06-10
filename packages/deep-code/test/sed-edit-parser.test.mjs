import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  parseSedSubstitutionExpression,
  applySedSubstitution,
} from '../src/tools/BashTool/sedEditParserCore.mjs'

// ── sed -i edit core (BRE→ERE→JS conversion + substitution parsing) ───────────
// applySedSubstitution renders/applies a `sed -i 's/…/…/…'` edit (the file-edit
// preview in SedEditPermissionRequest). A BRE/ERE-conversion or replacement-
// escaping bug SILENTLY corrupts the edited content. parseSedSubstitutionExpression
// splits `s/pat/rep/flags` with backslash-escape tracking. Both were untestable
// under node (the .ts imports a bun-tainted shell parser). Verbatim extraction.

const apply = (content, expr, extendedRegex = false) => {
  const p = parseSedSubstitutionExpression(expr)
  assert.ok(p, `expected a parse for ${expr}`)
  return applySedSubstitution(content, { ...p, filePath: 'f', extendedRegex })
}

// --- parseSedSubstitutionExpression ------------------------------------------

test('parses s/pattern/replacement/flags with the / delimiter', () => {
  assert.deepEqual(parseSedSubstitutionExpression('s/a/b/g'), { pattern: 'a', replacement: 'b', flags: 'g' })
  assert.deepEqual(parseSedSubstitutionExpression('s/foo/bar/'), { pattern: 'foo', replacement: 'bar', flags: '' })
  // escaped delimiter stays inside the field (escape tracking).
  assert.deepEqual(parseSedSubstitutionExpression('s/a\\/b/c/'), { pattern: 'a\\/b', replacement: 'c', flags: '' })
  // escaped chars (\n) are preserved verbatim into the pattern.
  assert.deepEqual(parseSedSubstitutionExpression('s/\\n/X/'), { pattern: '\\n', replacement: 'X', flags: '' })
})

test('rejects malformed / non-/ / unsafe-flag substitutions', () => {
  assert.equal(parseSedSubstitutionExpression('s#a#b#'), null) // non-/ delimiter unsupported
  assert.equal(parseSedSubstitutionExpression('p'), null)
  assert.equal(parseSedSubstitutionExpression('s/a/b'), null) // missing closing delimiter
  assert.equal(parseSedSubstitutionExpression('s/a/b/x'), null) // invalid flag x
  assert.equal(parseSedSubstitutionExpression('s/a/b/c/'), null) // extra delimiter in flags
  assert.equal(parseSedSubstitutionExpression('d'), null)
})

// --- applySedSubstitution: BRE↔ERE metacharacter conversion ------------------

test('BRE mode: escaped metachars become operators, bare metachars are literal', () => {
  assert.equal(apply('aaa b', 's/a\\+/X/'), 'X b') // \+ → + (one-or-more)
  assert.equal(apply('a+b', 's/a+/X/'), 'Xb') // bare + is literal in BRE
  assert.equal(apply('a?b', 's/a?/X/'), 'Xb') // bare ? literal
  assert.equal(apply('a|b', 's/a|/X/'), 'Xb') // bare | literal
  assert.equal(apply('a(b', 's/a(/X/'), 'Xb') // bare ( literal
  assert.equal(apply('abab', 's/\\(ab\\)\\+/Y/'), 'Y') // \(ab\)\+ → (ab)+
})

test('ERE mode (-E/-r): metacharacters pass through unconverted', () => {
  assert.equal(apply('aaa', 's/a+/X/', true), 'X') // ERE + → one-or-more
  assert.equal(apply('aXbXc', 's/X/_/g', true), 'a_b_c')
})

test('KNOWN LIMITATION: sed backreferences (\\1, \\2) are NOT converted to JS ($1)', () => {
  // The preview renderer only translates &, \&, and \/ in the replacement — sed
  // group backrefs pass through literally, so `s/(a)(b)/\2\1/` previews as
  // "\2\1" rather than "ba". Pre-existing behavior, pinned here (preview only;
  // the actual sed still runs correctly in the shell). A future improvement
  // could map sed \N → JS $N.
  assert.equal(apply('ab', 's/(a)(b)/\\2\\1/', true), '\\2\\1')
})

test('BRE: literal backslash (\\\\) is protected through the placeholder dance', () => {
  // \\ must stay a literal backslash and NOT be confused with the metachar
  // placeholders (Step 1 protects \\ first).
  assert.equal(apply('a\\b', 's/a\\\\b/X/'), 'X') // pattern a\\b matches literal a\b
})

// --- applySedSubstitution: replacement & whole-match / escaping ---------------

test('replacement & is the whole match; \\& is a literal ampersand', () => {
  assert.equal(apply('cat', 's/cat/[&]/'), '[cat]') // & → whole match
  assert.equal(apply('cat', 's/cat/a\\&b/'), 'a&b') // \& → literal &
  assert.equal(apply('x', 's/x/a&b&c/'), 'axbxc') // multiple & → match each
  assert.equal(apply('a/b', 's/a\\/b/X/'), 'X') // \/ in pattern → literal /
  assert.equal(apply('x', 's/x/a\\/b/'), 'a/b') // \/ in replacement → /
})

test('flags: g (global), i/I (case), m/M (multiline)', () => {
  assert.equal(apply('aaa', 's/a/X/g'), 'XXX')
  assert.equal(apply('aaa', 's/a/X/'), 'Xaa') // no g → first only
  assert.equal(apply('CAT', 's/cat/X/i'), 'X')
  assert.equal(apply('CAT', 's/cat/X/I'), 'X') // sed uppercase I
  assert.equal(apply('a\nb', 's/^b/X/m'), 'a\nX') // multiline ^
})

// --- applySedSubstitution: robustness ----------------------------------------

test('an invalid regex returns the original content unchanged (no throw)', () => {
  // unbalanced group in ERE → invalid JS RegExp → catch → original content.
  assert.equal(applySedSubstitution('hello', { pattern: '(', replacement: 'X', flags: '', filePath: 'f', extendedRegex: true }), 'hello')
})

test('a replacement that mimics the internal salt placeholder is still safe', () => {
  // The random-salted placeholder defends against a replacement literally
  // containing the placeholder text; & / \& must still resolve correctly.
  const r = apply('cat', 's/cat/___ESCAPED_AMPERSAND_deadbeef___ & \\&/')
  assert.equal(r, '___ESCAPED_AMPERSAND_deadbeef___ cat &')
})

test('a catastrophic (ReDoS) pattern is bounded by the timeout, not an infinite hang', () => {
  // This preview runs SYNCHRONOUSLY in the permission render path over a model-supplied
  // pattern. `(a+)+$` over a long run of `a` with no terminator is exponential backtracking;
  // without the vm timeout it would hang the UI forever. With a short injected timeout it
  // returns within the budget, leaving the content unchanged (no edit applied).
  const evil = 'a'.repeat(60) + '!'
  const start = Date.now()
  const result = applySedSubstitution(
    evil,
    { pattern: '(a+)+$', replacement: 'X', flags: '', filePath: 'f', extendedRegex: true },
    { timeoutMs: 150 },
  )
  const elapsed = Date.now() - start
  assert.equal(result, evil) // unchanged — the pathological edit is not applied
  assert.ok(elapsed < 2000, `expected the timeout to bound the run, took ${elapsed}ms`)
})

test('a normal edit completes well under the timeout', () => {
  // A non-catastrophic replace finishes in microseconds, so even a tiny timeout applies it.
  const result = applySedSubstitution(
    'the cat sat',
    { pattern: 'cat', replacement: 'dog', flags: 'g', filePath: 'f', extendedRegex: true },
    { timeoutMs: 50 },
  )
  assert.equal(result, 'the dog sat')
})

test('the permission dialog falls back to real sed on a no-change preview (no silent no-op)', () => {
  // When the preview returns content UNCHANGED — a genuine no-match OR a timed-out heavy/
  // catastrophic pattern — the dialog must NOT short-circuit to writing that unchanged
  // content (which would silently drop a legitimate-but-timed-out edit). It must let the
  // real shell `sed -i` run. Guard the source so this can't regress (the .tsx is React-
  // compiler output, not node-loadable, so we pin the invariant by source text).
  const src = readFileSync(
    fileURLToPath(
      new URL(
        '../src/components/permissions/SedEditPermissionRequest/SedEditPermissionRequest.tsx',
        import.meta.url,
      ),
    ),
    'utf8',
  )
  // the parseInput closure short-circuits (returns the parsed input, NO _simulatedSedEdit)
  // when newContent === oldContent, before attaching the precomputed edit.
  assert.match(
    src,
    /if \(newContent === oldContent\) \{[\s\S]*?return parsed;[\s\S]*?\}[\s\S]*?_simulatedSedEdit/,
  )
})
