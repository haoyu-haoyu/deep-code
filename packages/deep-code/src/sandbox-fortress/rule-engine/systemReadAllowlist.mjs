// Tight system-read allowlist for the F3 paranoid fs-read floor (effort 'max').
//
// At effort 'max' the fortress default-decision for an un-ruled fs-read is 'deny'. The
// shell still needs to read system paths (dynamic libs, the dyld cache, /etc/ssl, the
// interpreter, …) to run ANY command, so reads of these system roots — plus the workspace
// — are EXEMPT from that no-match floor. Everything else (notably $HOME dotfiles such as
// ~/.aws, ~/.ssh, ~/.config and other users' data) falls through and is denied.
//
// IMPORTANT: this exemption applies ONLY to the paranoid NO-MATCH deny. An explicit user
// fortress deny rule (e.g. `deny fs-read /etc/shadow`) is a MATCHED deny and is enforced
// regardless of this allowlist (the adapter checks `matched` before consulting it).
//
// macOS note: /var, /etc, /tmp are symlinks to /private/* — both forms are listed so a
// pre-realpath path matches either way.

export const SYSTEM_READ_PREFIXES = [
  // executables + libraries (Linux + macOS)
  '/bin', '/sbin', '/usr', '/lib', '/lib32', '/lib64', '/libx32', '/libexec',
  // config, runtime, devices, temp, kernel fs
  '/etc', '/var', '/run', '/proc', '/sys', '/dev', '/tmp', '/opt', '/boot', '/snap',
  // macOS system roots. NOT a blanket '/private' (too broad — that would exempt all of
  // /private/**); only the specific /private/* subroots reads actually need (the realpath
  // forms of /etc, /var (incl. /private/var/db/dyld and /private/var/folders temp), /tmp).
  '/private/etc', '/private/var', '/private/tmp',
  '/System', '/Library', '/Applications', '/cores',
]

function trimTrailingSlashes(s) {
  // non-backtracking trim (avoid the O(n^2) /\/+$/ regex on a pathological input)
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--
  return s.slice(0, end)
}

function isUnderPrefix(absPath, prefix) {
  return absPath === prefix || absPath.startsWith(prefix + '/')
}

/** True if absPath is at/under a system-read root. */
export function isSystemReadPath(absPath) {
  if (typeof absPath !== 'string' || absPath === '') return false
  for (const p of SYSTEM_READ_PREFIXES) {
    if (isUnderPrefix(absPath, p)) return true
  }
  return false
}

/** True if absPath is at/under a single workspace directory. */
export function isUnderWorkspace(absPath, workspaceDir) {
  if (typeof absPath !== 'string' || typeof workspaceDir !== 'string' || workspaceDir === '') return false
  const ws = trimTrailingSlashes(workspaceDir)
  if (ws === '') return false
  return isUnderPrefix(absPath, ws)
}

/** True if absPath is at/under ANY of the workspace directories (originalCwd ∪ additional). */
export function isUnderAnyWorkspace(absPath, workspaceDirs) {
  if (!Array.isArray(workspaceDirs)) return false
  for (const dir of workspaceDirs) {
    if (isUnderWorkspace(absPath, dir)) return true
  }
  return false
}

/**
 * A read path is exempt from the paranoid NO-MATCH floor if it is a system path or under
 * one of the workspace directories. (A MATCHED user deny rule is enforced separately,
 * BEFORE this check, so this never overrides an explicit deny.)
 * @param {string} absPath
 * @param {string[]} workspaceDirs the live workspace dirs (originalCwd ∪ additionalWorkingDirectories)
 */
export function isAllowlistedRead(absPath, workspaceDirs) {
  return isSystemReadPath(absPath) || isUnderAnyWorkspace(absPath, workspaceDirs)
}
