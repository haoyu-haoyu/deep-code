// `git ls-files` emits any path byte >= 0x80 — and `"`, `\`, and control chars —
// C-quoted (e.g. `"caf\303\251.env"`) when `core.quotePath` is left at its default
// of true. copyWorktreeIncludeFiles splits the raw stdout on newlines and matches
// each line against the user's UTF-8 `.worktreeinclude` patterns with the `ignore`
// library, so a quoted non-ASCII path never matches its real pattern and the file
// is silently dropped from the new worktree (and a collapsed non-ASCII dir ends in
// `"` not `/`, defeating the trailing-slash partition). Disabling core.quotepath
// makes git emit raw UTF-8 bytes, so the split + match + join all operate on real
// paths.
//
// Mirrors the same `-c core.quotepath=false` idiom already used by
// src/hooks/fileSuggestions.ts. The `-c` override must precede the `ls-files`
// subcommand. Shared by BOTH ls-files invocations in copyWorktreeIncludeFiles so
// neither call site can drift back to quoted output.
export function buildIgnoredLsFilesArgs(extraArgs = []) {
  return [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    ...extraArgs,
  ]
}
