import { isEnvTruthy } from './envUtils.js'
import { scrubSubprocessEnv } from './subprocessEnvScrub.mjs'

/**
 * Strips secret env vars from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets via
 * shell expansion (e.g., ${DEEPSEEK_API_KEY}) in Bash tool commands.
 *
 * The parent process keeps these vars (needed for API calls, lazy credential
 * reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are
 * scrubbed. The scrub set (SUBPROCESS_SCRUB_KEYS) lives in the pure, node-tested
 * subprocessEnvScrub.mjs leaf — the single source of truth, so it can't silently
 * drift from what the provider actually treats as a credential.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  // CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python
  // in agent subprocesses route through the local relay. Returns {} when the
  // proxy is disabled or not registered (non-CCR), so this is a no-op outside
  // CCR containers.
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  if (!isEnvTruthy(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)) {
    return Object.keys(proxyEnv).length > 0
      ? { ...process.env, ...proxyEnv }
      : process.env
  }
  // scrubSubprocessEnv strips each secret key AND its GitHub Actions INPUT_<KEY>
  // duplicate (GHA auto-creates these for `with:` inputs, e.g. INPUT_DEEPSEEK_API_KEY).
  return scrubSubprocessEnv({ ...process.env, ...proxyEnv })
}
