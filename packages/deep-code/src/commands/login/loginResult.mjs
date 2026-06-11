// The user-facing result message for the DeepSeek login / setup flow.
//
// Distinguishes a real user CANCEL from a config-save FAILURE. The setup dialog's
// final step writes the config to disk (mkdir + atomic tmp write + rename), which
// can throw on EACCES (read-only/locked $HOME or ~/.deepcode), ENOSPC, or a
// permission-denied home dir. That failure used to be reported to the user as
// "Login cancelled" (the dialog called onDone(false), indistinguishable from a
// cancel) while the real cause was hidden in a debug log that is suppressed for
// normal users — actively misdirecting the user. When the dialog now forwards the
// failure reason, this maps it to a clear, actionable message instead.

/**
 * @param {boolean} saved whether the config was written successfully
 * @param {string} [error] the save-failure reason (error.message); absent on a cancel
 * @returns {string} the message shown after the login flow ends
 */
export function formatDeepSeekLoginResult(saved, error) {
  if (saved) return 'DeepSeek credentials configured'
  if (error) {
    return `Login failed — could not save config: ${error}. Check write permissions for your DeepSeek config directory (~/.deepcode).`
  }
  return 'Login cancelled'
}
