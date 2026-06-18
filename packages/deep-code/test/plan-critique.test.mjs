import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractPlanFileReferences,
  buildPlanFileReferenceNote,
} from '../src/tools/ExitPlanModeTool/planCritique.mjs'

// --- extraction -------------------------------------------------------------

test('extracts backtick-quoted file PATHS, dedup, first-seen order', () => {
  const plan = 'Modify `src/foo.ts` and `lib/util/parse.go`, then add `./x/y.mjs`. Re-touch `src/foo.ts`.'
  assert.deepEqual(extractPlanFileReferences(plan), ['src/foo.ts', 'lib/util/parse.go', './x/y.mjs'])
})

test('rejects bare member expressions that collide with a source extension (path required)', () => {
  // The major false-positive class: `response.json` / `res.json` etc. are member
  // expressions, not files. A reference must be a PATH (contain a separator).
  const plan = 'Return `res.json` from `response.json`; the `obj.go` and `result.py` helpers; `it.ts` runs.'
  assert.deepEqual(extractPlanFileReferences(plan), [])
})

test('a bare filename (no separator) is not treated as a path reference', () => {
  // package.json / README.md exist if real (so never flagged) — requiring a slash
  // forgoes flagging a typo'd ROOT file in exchange for zero member-expr noise.
  assert.deepEqual(extractPlanFileReferences('update `package.json` and `README.md`'), [])
  // …but the same files WITH a path are references.
  assert.deepEqual(extractPlanFileReferences('see `docs/README.md`'), ['docs/README.md'])
})

test('allows dotdir paths, rejects hostname-like first segments (bare-host URLs)', () => {
  assert.deepEqual(extractPlanFileReferences('edit `.github/workflows/ci.yml`'), ['.github/workflows/ci.yml'])
  assert.deepEqual(extractPlanFileReferences('relative `./a/b.ts` and `../c/d.go`'), ['./a/b.ts', '../c/d.go'])
  // a scheme-less URL must NOT be flagged as a workspace file
  assert.deepEqual(extractPlanFileReferences('docs at `example.com/page.html`'), [])
})

test('ignores non-file backtick spans: commands, member exprs, URLs, prose, unknown exts', () => {
  const plan = [
    'Run `npm test` and `git commit`.', // commands (whitespace) — excluded
    'Call `Foo.prototype.bar` and read `obj.length`.', // member exprs (ext not in list)
    'See `https://example.com/page.html`.', // URL (has ://, excluded by charset)
    'The `foo` variable and the `Widget` class.', // no extension
    'Bump to `1.2.3`.', // version (numeric ext)
  ].join('\n')
  assert.deepEqual(extractPlanFileReferences(plan), [])
})

test('strips a :line(:col) locator and trailing punctuation (incl. locator+punctuation)', () => {
  assert.deepEqual(extractPlanFileReferences('error at `src/a.ts:42`,'), ['src/a.ts'])
  assert.deepEqual(extractPlanFileReferences('see `src/b.ts:10:5`.'), ['src/b.ts'])
  assert.deepEqual(extractPlanFileReferences('(`lib/c.go`)'), ['lib/c.go'])
  // locator FOLLOWED BY punctuation (the minor that previously dropped the ref)
  assert.deepEqual(extractPlanFileReferences('error at `src/a.ts:42`.'), ['src/a.ts'])
  assert.deepEqual(extractPlanFileReferences('at `src/d.ts:42:7`.'), ['src/d.ts'])
})

test('rejects unknown extensions even with a path', () => {
  assert.deepEqual(extractPlanFileReferences('the `req/request.body` field'), [], 'body is not a file extension')
})

test('non-string input yields no references', () => {
  assert.deepEqual(extractPlanFileReferences(undefined), [])
  assert.deepEqual(extractPlanFileReferences(123), [])
  assert.deepEqual(extractPlanFileReferences(''), [])
})

// --- note building ----------------------------------------------------------

const existsIn = set => ref => set.has(ref)

test('returns null when every referenced path exists (or none referenced)', () => {
  const plan = 'Modify `src/foo.ts` and `src/bar.ts`.'
  assert.equal(buildPlanFileReferenceNote(plan, existsIn(new Set(['src/foo.ts', 'src/bar.ts']))), null)
  assert.equal(buildPlanFileReferenceNote('just prose, no refs', existsIn(new Set())), null)
})

test('flags only the missing paths, neutrally framed (to-create or typo)', () => {
  const plan = 'Update `src/exists.ts` and `src/typo.ts`.'
  const note = buildPlanFileReferenceNote(plan, existsIn(new Set(['src/exists.ts'])))
  assert.ok(note.includes('`src/typo.ts`'))
  assert.ok(!note.includes('`src/exists.ts`'), 'an existing path is not flagged')
  assert.ok(/CREATE/.test(note) && /typo/.test(note), 'framed as to-create or typo, not an error')
})

test('uses singular vs plural wording', () => {
  const one = buildPlanFileReferenceNote('add `src/new.ts`', existsIn(new Set()))
  assert.ok(/1 path /.test(one) && / was not found/.test(one))
  const many = buildPlanFileReferenceNote('add `src/a.ts` and `src/b.ts`', existsIn(new Set()))
  assert.ok(/2 paths /.test(many) && / were not found/.test(many))
})

test('bounds the list to maxShown with a (+N more) suffix', () => {
  const refs = Array.from({ length: 15 }, (_, i) => `\`src/f${i}.ts\``).join(' ')
  const note = buildPlanFileReferenceNote(refs, existsIn(new Set()), { maxShown: 5 })
  assert.match(note, /\(\+10 more\)$/)
  assert.ok(note.includes('src/f0.ts') && note.includes('src/f4.ts'))
  assert.ok(!note.includes('src/f5.ts'))
})

test('a throwing/invalid fileExists never produces a false "missing" flag', () => {
  const plan = 'edit `src/foo.ts`'
  assert.equal(
    buildPlanFileReferenceNote(plan, () => {
      throw new Error('io')
    }),
    null,
    'predicate error → treated as existing → not flagged',
  )
  assert.equal(buildPlanFileReferenceNote(plan, null), null, 'non-function predicate → null')
})
