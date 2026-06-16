import { constants as osConstants } from 'node:os'

// Map a child process's (code, signal) to the exit code we report, using the
// shell convention: a numeric code passes through (incl 0); a signalled exit
// maps to 128 + signum (SIGTERM→143, SIGINT→130, SIGHUP→129, SIGKILL→137) so
// downstream sees the real cause instead of a flattened 1; an unknown signal
// name maps to 128+1; neither code nor signal → 1.
//
// Single source of truth for this convention, shared by ShellCommand's child
// exit handler and the full-CLI wrapper's resolveFullCliExitCode. Previously
// ShellCommand hard-coded `signal === 'SIGTERM' ? 144 : 1`, which (a) reported
// 144 — SIGUSR1's conventional code — for a SIGTERM'd child, and (b) collapsed
// every other signal to 1. 144 was used to dodge a collision with the internal
// timeout sentinel (the reported code 143); that coupling is now removed (the
// timeout message keys off an explicit flag, not the exit code), so SIGTERM can
// report its correct 143 here.
/**
 * @param {number | null | undefined} code
 * @param {NodeJS.Signals | string | null | undefined} signal
 * @returns {number}
 */
export function shellExitCode(code, signal) {
  if (typeof code === 'number') return code
  if (signal) {
    const signum = osConstants.signals?.[signal]
    return 128 + (typeof signum === 'number' ? signum : 1)
  }
  return 1
}
