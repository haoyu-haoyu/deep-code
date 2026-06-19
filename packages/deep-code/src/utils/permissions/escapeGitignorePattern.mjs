// Escape the gitignore metacharacters in a REAL filesystem path segment before it
// is interpolated into a permission rule pattern (e.g. createReadRuleSuggestion's
// `/${path}/**`). The rule is later fed to `ignore().add()`, which applies full
// gitignore semantics: `[...]` is a character class, a leading `#` is a comment, a
// leading `!` is a negation, `*` is a glob. Real paths legitimately contain these —
// Next.js dynamic routes `app/[id]/`, `app/[...slug]/`, a `#scratch.md`, a `!notes`
// dir — so an unescaped path both UNDER-matches its own file (the "always allow"
// never sticks → re-prompt forever) and OVER-matches unrelated paths (silently
// granting access the user never approved). The narrow getClaudeSkillScope guard
// (filesystem.ts) already rejects skill names with these chars for the same reason;
// this escapes them instead so ordinary project paths round-trip faithfully.
//
// Escapes `\ ! # [ ] *` with a leading backslash (the `ignore` lib's literal-escape
// form), plus any TRAILING space: gitignore strips unescaped trailing spaces, and
// the matcher peels the rule's `/**` suffix first, which would re-expose a path
// segment that ends in a space (e.g. `proj/ab `) as line-trailing → the rule loses
// its own file and over-grants the sibling `proj/ab/`. Deliberately NOT `/` (the
// structural path separator — must stay raw) and NOT `?`: the `ignore` lib does not
// treat `\?` as a literal `?` (verified), so escaping it would make the rule never
// match its own file; `?` is invalid in Windows paths and vanishingly rare on POSIX,
// so leaving it as a single-char wildcard is strictly less harmful than breaking the
// self-match. A path with no metacharacters is returned byte-identical (the common
// case → rules unchanged).

/**
 * @param {string} pathSegment a real filesystem path (POSIX-separated)
 * @returns {string} the path with gitignore metacharacters backslash-escaped
 */
export function escapeGitignorePattern(pathSegment) {
  return pathSegment
    .replace(/[\\!#[\]*]/g, '\\$&')
    .replace(/ +$/, spaces => spaces.replace(/ /g, '\\ '))
}
