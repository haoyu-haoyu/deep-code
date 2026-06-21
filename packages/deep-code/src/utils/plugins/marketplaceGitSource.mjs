// Validate the git URL and ref of a marketplace `git`/`github` source BEFORE
// they reach `git clone` / `git fetch|checkout|pull` as shell-free-execa
// POSITIONALS (marketplaceManager.ts gitClone:832 / gitPull:542,552,562).
//
// Two concrete injection vectors closed here:
//
//   (1) URL transport / option-injection. The marketplace `git` source's
//       `url` was a raw `z.string()` (schemas.ts) passed straight to
//       `git clone <url>` with no `--` and NO scheme allowlist — while the
//       PLUGIN git path runs the same value through validateGitUrl
//       (pluginLoader.ts) first. So `url:'ext::sh -c "<cmd>"'` reached
//       `git clone ext::...`, and git's ext transport executes the command at
//       clone time (protocol.ext.allow defaults to `user` for a top-level
//       clone) → clone-time RCE on first install of a folder-trusted
//       workspace marketplace. A leading-dash url is also reparsed as a clone
//       flag. isSafeMarketplaceGitUrl mirrors validateGitUrl exactly: allow
//       only https:/http:/file: plus the `git@host:` SSH shorthand; reject
//       ext:: and every other transport (and any value `new URL()` can't
//       parse, which includes a leading-dash url).
//
//   (2) Ref option-injection. The `ref` was a raw `z.string()` passed as the
//       trailing positional of `git fetch origin <ref>` / `git checkout <ref>`
//       / `git pull origin <ref>` with no `--` separator and no validation, so
//       `ref:'--upload-pack=<cmd>'` is reparsed by git as the --upload-pack
//       OPTION (local command exec over a file://or ssh transport). A `--`
//       separator is the WRONG fix — `git checkout -- <ref>` reparses ref as a
//       PATHSPEC — so the correct guard is a leading-dash/allowlist check.
//       isSafeMarketplaceGitRef mirrors isSafeRefName (utils/git/gitFilesystem.ts):
//       reject empty, leading '-' or '/', any '..', empty/'.' path components,
//       and anything outside the ASCII ref allowlist.
//
// Pure value-in/value-out so it is node-testable (schemas.ts and
// marketplaceManager.ts are bun-tainted). file:// stays allowed to match the
// plugin path's validateGitUrl (legit local marketplaces); the ref guard is
// what closes the file://+--upload-pack chain.

export function isSafeMarketplaceGitUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  if (url.includes('\0')) return false
  // SSH shorthand `git@host:path` is not a URL new URL() can parse.
  if (/^git@[a-zA-Z0-9.-]+:/.test(url)) return true
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' ||
    parsed.protocol === 'http:' ||
    parsed.protocol === 'file:'
  )
}

export function isSafeMarketplaceGitRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return false
  if (ref.startsWith('-') || ref.startsWith('/')) return false
  if (ref.includes('..')) return false
  // Reject empty / single-dot path components (`.`, `foo/./bar`, `foo//bar`, `foo/`).
  if (ref.split('/').some(component => component === '.' || component === '')) {
    return false
  }
  // Allowlist-only: alphanumerics, /, ., _, +, -, @. Rejects shell metachars,
  // whitespace, NUL, and non-ASCII.
  return /^[a-zA-Z0-9/._+@-]+$/.test(ref)
}
