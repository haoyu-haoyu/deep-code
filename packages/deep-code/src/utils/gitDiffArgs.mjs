// Shared argv for the "uncommitted changes vs HEAD" git diff spawns in
// gitDiff.ts. Two flags fix two related DiffDialog bugs:
//
// `-c core.quotepath=false` (prepended, before the `diff` subcommand or git
// treats it as a pathspec) makes git emit a non-ASCII path as raw UTF-8 instead
// of a C-style octal escape (e.g. `"caf\303\251.txt"`). Without it BOTH the
// numstat key and the `diff --git a/… b/…` header are octal-quoted; the header
// regex `^a/(.+?) b/(.+)$` fails to match a `"a/caf…` line, the file's hunks are
// dropped, and the DiffDialog renders an un-expandable "large file" with a
// mojibake path label. (Mirrors worktreeLsFilesArgs.mjs.)
//
// `--no-renames` (appended to the numstat + full-diff spawns) stops git from
// collapsing a rename into a single `old => new` numstat entry, whose key never
// matches the diff header's destination-path key — the two parsers disagree, so
// the renamed file shows a bogus `=>` path, a false "large file", and can't be
// expanded. With it a rename is a plain delete + add and the keys agree.
//
// shortstat emits only totals (no per-file paths), so it needs neither flag for
// correctness; it keeps the quotepath prefix for uniformity (a no-op there) but
// NOT `--no-renames` (which would change its files-changed total).
const QUOTEPATH = ['-c', 'core.quotepath=false']
const BASE = ['--no-optional-locks', 'diff', 'HEAD']

export const gitDiffShortstatArgs = Object.freeze([...QUOTEPATH, ...BASE, '--shortstat'])
export const gitDiffNumstatArgs = Object.freeze([...QUOTEPATH, ...BASE, '--numstat', '--no-renames'])
export const gitDiffHunksArgs = Object.freeze([...QUOTEPATH, ...BASE, '--no-renames'])
