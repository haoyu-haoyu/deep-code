import { join } from 'node:path'
import { shouldForceNativeInteractive } from './native-interactive.mjs'
import { shellExitCode } from '../utils/shellExitCode.mjs'

export function shouldDelegateToFullCli({
  cli,
  env = process.env,
  input = process.stdin,
} = {}) {
  if (cli?.printMode) return true
  if ((cli?.promptArgs ?? []).length > 0) return true
  if ((cli?.unknownFlags ?? []).length > 0) return true
  if (shouldForceNativeInteractive(env)) return false
  return true
}

export function shouldLaunchFullTui({
  cli,
  env = process.env,
  input = process.stdin,
} = {}) {
  if (shouldForceNativeInteractive(env)) return false
  if (cli?.printMode) return false
  if ((cli?.promptArgs ?? []).length > 0) return false
  if ((cli?.unknownFlags ?? []).length > 0) return false
  return true
}

export function resolveFullCliPath({
  env = process.env,
  packageDir,
} = {}) {
  return env.DEEPCODE_FULL_CLI_PATH ?? join(packageDir, 'dist', 'deepcode-full.mjs')
}

export function formatMissingFullCliMessage(fullCliPath) {
  return (
    `Deep Code full CLI bundle is missing at ${fullCliPath}.\n` +
    'Run: npm run build:full-cli --workspace @deepcode-ai/deep-code'
  )
}

export function formatFullCliLaunchFailure(error) {
  return `Failed to launch Deep Code full CLI: ${error.message}`
}

// Map the full-CLI child's (code, signal) to the exit code the wrapper adopts,
// via the shared shell-convention SSOT (128 + signum; SIGTERM→143, SIGINT→130,
// SIGHUP→129) so `timeout`/CI see the real cause instead of a flattened 1.
export function resolveFullCliExitCode(code, signal) {
  return shellExitCode(code, signal)
}

// Forward termination signals to the spawned full-CLI child so a SIGINT/SIGTERM/
// SIGHUP delivered to the WRAPPER tears down the child (which owns the terminal
// in raw mode) instead of orphaning it on the terminal. Registering these
// handlers also keeps the wrapper alive to await the child rather than exiting
// first. SIGHUP is skipped on Windows (mirrors gracefulShutdown's platform
// handling). The child's own signal handling is idempotent, so the extra signal
// a terminal Ctrl-C already delivers to the shared process group is harmless.
// Returns an unsubscribe fn to remove the handlers once the child has exited.
export function forwardSignalsToChild(child, proc = process) {
  const signals =
    proc.platform === 'win32'
      ? ['SIGINT', 'SIGTERM']
      : ['SIGINT', 'SIGTERM', 'SIGHUP']
  const forwarders = signals.map(sig => {
    const handler = () => {
      try {
        child.kill(sig)
      } catch {
        // child already gone — nothing to forward
      }
    }
    proc.on(sig, handler)
    return { sig, handler }
  })
  return () => {
    for (const { sig, handler } of forwarders) {
      proc.removeListener(sig, handler)
    }
  }
}
