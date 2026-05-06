import { join } from 'node:path'
import { shouldForceNativeInteractive } from './native-interactive.mjs'

export function shouldDelegateToFullCli({
  cli,
  env = process.env,
  input = process.stdin,
} = {}) {
  if (env.DEEPCODE_EXPERIMENTAL_FULL_TUI === '1') return true
  if (cli?.printMode) return true
  if ((cli?.promptArgs ?? []).length > 0) return true
  if ((cli?.unknownFlags ?? []).length > 0) return true
  if (shouldForceNativeInteractive(env)) return false
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
