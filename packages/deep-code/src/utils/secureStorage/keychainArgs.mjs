// Build the `security` CLI argv for keychain read/delete as a literal array.
//
// The username (from $USER) and service name are passed as discrete exec args
// (shell=false), NOT interpolated into a shell command STRING. A username — or a
// CLAUDE_CONFIG_DIR fragment that feeds the service name — containing a space,
// quote, `;`, `$(…)`, or other shell-significant char then can't break the
// quoting or inject a command; each value stays one literal token. This mirrors
// the already-safe argv form used by doReadAsync()/update(); read()/delete()
// previously used a shell string and were the inconsistent, injectable path.
export function buildKeychainFindArgs(username, serviceName) {
  return ['find-generic-password', '-a', username, '-w', '-s', serviceName]
}

export function buildKeychainDeleteArgs(username, serviceName) {
  return ['delete-generic-password', '-a', username, '-s', serviceName]
}

// Build the single `add-generic-password ...` line fed to `security -i` over stdin
// (the INC-3028 mitigation that keeps the hex secret out of argv/process listings).
//
// `security -i` is NOT a shell, but its interactive loop tokenizes each line with a
// quote-aware parser: an unescaped `"` toggles quoting, and `\` escapes the next
// char. So an un-escaped username from $USER like `evil" -A -l x` CLOSES the -a
// value and injects flags (-A = allow ANY app to read the credential, -s/-X =
// mis-target which item / what bytes are written). #424 converted read()/delete()
// to safe argv but left this stdin branch interpolating the raw value — the one
// remaining injectable seam, and the DEFAULT path for typical small credentials.
//
// Escape `\` then `"` in username and serviceName so each stays ONE literal token.
// hexValue is Buffer.toString('hex') = [0-9a-f]*, so it needs no escaping (guarded).
// Returns null when a value carries a newline/CR/NUL: those end the `security -i`
// line and backslash-escaping can't fix it, so the caller must use the (no-line-
// limit) argv branch, which passes each value as one literal token.
/**
 * @param {string} username
 * @param {string} serviceName
 * @param {string} hexValue  Buffer.toString('hex')
 * @returns {string | null} the stdin line (with trailing newline), or null to use argv
 */
export function buildKeychainAddInteractiveLine(username, serviceName, hexValue) {
  if (/[\n\r\0]/.test(username) || /[\n\r\0]/.test(serviceName)) return null
  if (!/^[0-9a-f]*$/.test(hexValue)) return null
  const esc = s => s.replace(/[\\"]/g, '\\$&')
  return `add-generic-password -U -a "${esc(username)}" -s "${esc(serviceName)}" -X "${hexValue}"\n`
}
