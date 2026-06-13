// `core.quotePath` (default true) makes `git ls-files` C-quote any path byte
// >= 0x80, e.g. emitting `"\351\205\215\347\275\256.env"` for `配置.env`.
// copyWorktreeIncludeFiles splits the raw stdout on newlines and matches each line
// against the user's UTF-8 `.worktreeinclude` patterns with the `ignore` library,
// so a quoted non-ASCII path never matches its real pattern and the file is
// silently dropped from the new worktree (and a collapsed non-ASCII dir ends in `"`
// not `/`, defeating the trailing-slash partition). Disabling core.quotepath makes
// git emit those high bytes raw, so the split + match + join work for non-ASCII
// paths.
//
// (git still unconditionally quotes `"`, `\`, and control chars — core.quotePath
// does not govern those — so a filename containing one remains a pre-existing
// limitation here, identical to src/hooks/fileSuggestions.ts. The realistic case,
// and the one this fixes, is the non-ASCII >= 0x80 path.)
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
