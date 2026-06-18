// POSIX permission modes for on-disk files that hold secrets (e.g. the DeepSeek
// API key in ~/.deepcode/deepseek-config.json). A secret file must be accessible
// only by its owner (0o600); its containing directory owner-only (0o700).
export const SECURE_FILE_MODE = 0o600
export const SECURE_DIR_MODE = 0o700

/**
 * True if `mode` grants ANY group or other (world) permission bit — i.e. a
 * secret file/dir that a loose umask left readable or writable by other local
 * users. The 0o077 mask examines only the group/other permission bits, so the
 * owner bits and the file-type bits in an fs.statSync `mode` (e.g. 0o100644 for
 * a regular file) do not affect the result.
 *
 * @param {number} mode  st_mode from fs.statSync
 * @returns {boolean}
 */
export function isModeTooOpen(mode) {
  return (mode & 0o077) !== 0
}
