import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// The model-facing diagnostics summary must name files the model can ACT on. The old
// renderer used `file.uri.split('/').pop()` — the bare BASENAME — so two files with
// the same basename in different directories (index.ts, types.ts, Modal.tsx — ubiquitous)
// were rendered under one identical header, and the model could not tell which file
// each diagnostic belonged to and edited the wrong file. The user-facing
// DiagnosticsDisplay already shows the relative path; this gives the model the same.
//
// Diagnostic uris arrive in two shapes: a raw file:// URI (the IDE/MCP path,
// percent-encoded by the editor) or an already-decoded absolute OS path (the passive
// path's fileURLToPath result). Convert both to a cwd-relative path. fileURLToPath
// also decodes percent-encoding (%20 -> a space) and handles Windows drive letters /
// backslashes, so the model sees the real on-disk name rather than a percent-encoded
// or backslash-mangled basename.
//
// cwd is injected (getCwd lives in a .ts module the .mjs layer cannot import).
//
// @param {string} uri
// @param {string} cwd
// @returns {string}
export function diagnosticFileLabel(uri, cwd) {
  const localPath = uriToLocalPath(uri)
  if (!localPath) return String(uri ?? '')
  // Only relativize an ABSOLUTE path. relative(cwd, nonAbsolute) resolves the second
  // arg against the real process.cwd() (not the logical cwd arg), producing a garbage
  // ../<process.cwd>/... label — so a non-absolute localPath (a malformed-URI / unknown-
  // scheme fallback) is kept verbatim, which is still more informative than a bare basename.
  if (!isAbsolute(localPath)) return localPath
  // relative() returns '' when localPath === cwd; keep the path then. A file outside
  // cwd yields a '../'-prefixed relative path, which is still informative.
  return relative(cwd, localPath) || localPath
}

const FS_RIGHT_SCHEME = '_claude_fs_right:'

function uriToLocalPath(uri) {
  if (typeof uri !== 'string' || uri.length === 0) return ''
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri)
    } catch {
      // Malformed / UNC URI fileURLToPath rejects: best-effort strip the scheme,
      // mirroring the user-facing display's naive fallback.
      return uri.slice('file://'.length)
    }
  }
  // Some IDE diff schemes carry the path after a `scheme:` prefix; strip the known one.
  if (uri.startsWith(FS_RIGHT_SCHEME)) return uri.slice(FS_RIGHT_SCHEME.length)
  // Already an absolute OS path (the passive fileURLToPath result).
  return uri
}
