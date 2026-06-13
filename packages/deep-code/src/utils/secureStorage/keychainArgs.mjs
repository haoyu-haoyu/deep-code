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
