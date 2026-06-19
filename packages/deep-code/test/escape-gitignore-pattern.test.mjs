import { test } from 'node:test'
import assert from 'node:assert/strict'
import ignoreLib from 'ignore'

import { escapeGitignorePattern } from '../src/utils/permissions/escapeGitignorePattern.mjs'

const ignore = ignoreLib.default || ignoreLib

// Build the rule the way createReadRuleSuggestion does (absolute path → //path/**),
// using the leaf, then test it the way matchingRuleForInput does: ignore().add(rule
// without the //-root prefix and /** suffix... ) — here we just reproduce the
// end-to-end ignore() behavior the matcher relies on.
const ruleMatches = (pathSegment, relPath) => {
  const ig = ignore().add('/' + escapeGitignorePattern(pathSegment) + '/**')
  return ig.test(relPath).ignored
}

test('escapeGitignorePattern: a metachar path matches ITS OWN file and nothing else', () => {
  const cases = [
    // [pathSegment, ownFile, anUnrelatedPathThatMustNotMatch]
    ['app/[id]', 'app/[id]/page.tsx', 'app/i/page.tsx'],
    ['app/[...slug]', 'app/[...slug]/page.tsx', 'app/x/page.tsx'],
    ['secrets[1]', 'secrets[1]/key.pem', 'secrets1/key.pem'],
    ['#scratch', '#scratch/note.md', 'zscratch/note.md'],
    ['!notes', '!notes/a.md', 'xnotes/a.md'],
    ['a*b', 'a*b/x', 'axyzb/x'],
  ]
  for (const [seg, own, avoid] of cases) {
    assert.equal(ruleMatches(seg, own), true, `${seg} must match its own file ${own}`)
    assert.equal(ruleMatches(seg, avoid), false, `${seg} must NOT over-match ${avoid}`)
  }
})

test('escapeGitignorePattern: a metachar-free path is returned byte-identical', () => {
  for (const p of ['src/utils', 'app/api/users', 'a/b/c', 'Components/Button']) {
    assert.equal(escapeGitignorePattern(p), p)
  }
  // and still matches as before
  assert.equal(ruleMatches('src/utils', 'src/utils/x.ts'), true)
  assert.equal(ruleMatches('src/utils', 'src/other/x.ts'), false)
})

test('escapeGitignorePattern: escapes exactly \\ ! # [ ] * (not / or ?)', () => {
  assert.equal(escapeGitignorePattern('[id]'), '\\[id\\]')
  assert.equal(escapeGitignorePattern('#a'), '\\#a')
  assert.equal(escapeGitignorePattern('!a'), '\\!a')
  assert.equal(escapeGitignorePattern('a*b'), 'a\\*b')
  assert.equal(escapeGitignorePattern('a\\b'), 'a\\\\b')
  // path separators stay raw (structural)
  assert.equal(escapeGitignorePattern('a/b/c'), 'a/b/c')
  // ? is intentionally left unescaped (ignore mishandles \?, ? is rare/invalid)
  assert.equal(escapeGitignorePattern('a?b'), 'a?b')
})

test('escapeGitignorePattern: a backslash dir and a trailing-space dir round-trip', () => {
  // POSIX dir literally named `a\b` (ignore treats \ as its escape char).
  assert.equal(escapeGitignorePattern('a\\b'), 'a\\\\b')
  assert.equal(ruleMatches('a\\b', 'a\\b/x'), true)
  // A path segment ending in a space: gitignore strips trailing spaces, and the
  // matcher peels /** first, so the space must be escaped or the rule over-grants.
  assert.equal(escapeGitignorePattern('proj/ab '), 'proj/ab\\ ')
  // simulate the matcher peeling the /** suffix, then matching
  const ruleMatchesPeeled = (seg, rel) => {
    const stripped = ('/' + escapeGitignorePattern(seg) + '/**').replace(/\/\*\*$/, '')
    return ignore().add(stripped).test(rel).ignored
  }
  assert.equal(ruleMatchesPeeled('proj/ab ', 'proj/ab /x'), true, 'matches its own trailing-space dir')
  assert.equal(ruleMatchesPeeled('proj/ab ', 'proj/ab/x'), false, 'does NOT over-grant the sibling')
  // a mid-path space is NOT trailing and stays raw
  assert.equal(escapeGitignorePattern('my docs/file'), 'my docs/file')
})

test('escapeGitignorePattern: deny-rule shape also round-trips (no false grant/skip)', () => {
  // A deny on secrets[1]/** must fire on the literal dir and not on secrets1.
  const ig = ignore().add('/' + escapeGitignorePattern('secrets[1]') + '/**')
  assert.equal(ig.test('secrets[1]/key.pem').ignored, true)
  assert.equal(ig.test('secrets1/key.pem').ignored, false)
})
