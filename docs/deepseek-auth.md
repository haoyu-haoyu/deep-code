# DeepSeek Authentication UX

Status: Decided
Decision date: 2026-05-10

## Summary

DeepCode authenticates to DeepSeek API using API keys only. OAuth and
claude.ai login flows are removed.

## API key intake

Three paths, env-first:

1. **Environment variable** `DEEPSEEK_API_KEY` — read at startup, takes
   priority over stored config.
2. **Environment variable** `DEEPCODE_API_KEY` — compatibility alias for
   existing DeepCode installs; lower priority than `DEEPSEEK_API_KEY`.
3. **TUI paste flow** — if env is unset and no stored key exists in config,
   the TUI shows a first-run paste box.

## Storage

- Path: `~/.deepcode/config.json`
- Permissions: file mode `0600` (owner read/write only)
- Format:
  ```json
  {
    "default_profile": "default",
    "profiles": {
      "default": {
        "api_key": "sk-...",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-v4-pro",
        "small_model": "deepseek-v4-flash",
        "reasoning_effort": "high",
        "thinking": "enabled"
      },
      "work": {
        "api_key": "sk-...",
        "base_url": "https://api.deepseek.com"
      }
    }
  }
  ```
- Plain text. We trade key encryption for simplicity (single-user self-use).
- The config file is created on first paste with 0600 perms.

Secret handling

- `DEEPSEEK_API_KEY` and `DEEPCODE_API_KEY` are secrets.
- P1.3 must add both names to subprocess/env scrub filters before OAuth UI
  deletion lands. Bash, MCP stdio, LSP, and hooks must not inherit either
  variable.
- Legacy OAuth secret names remain in scrub denylists while their readers are
  deleted.

Compatibility migration

- Existing `~/.deepcode/deepseek-config.json` remains a read fallback during
  Phase 1.
- If `~/.deepcode/config.json` is absent and `deepseek-config.json` exists,
  startup reads the legacy file and the next successful `/login` or profile
  write migrates the legacy fields into `~/.deepcode/config.json`.
- Legacy field mapping: `apiKey` → `api_key`, `baseUrl` → `base_url`,
  `model` → `model`, `smallModel` → `small_model`,
  `reasoningEffort` → `reasoning_effort`, `thinking` → `thinking`.
- Unknown legacy fields are ignored; known non-secret settings are preserved
  under the active profile so custom endpoints/model choices are not reset.
- `DEEPCODE_API_KEY` remains accepted for one compatibility release; docs and
  new examples prefer `DEEPSEEK_API_KEY`.

Profiles

Multiple profiles supported under profiles key.

Active profile selection priority:

1. CLI flag --profile <name>
2. Env var DEEPCODE_PROFILE
3. default_profile field in config
4. Profile literally named default

Slash commands:

- /profile <name> — switch active profile in this session.
- /profile list — show configured profiles (key masked: sk-***...***last4).

Slash commands

- /login — prompts for API key, writes to active profile (or default if
none active), updates config file.
- /logout — clears api_key from active profile (keeps profile name +
base_url for re-login). /logout --all clears all profiles.

CLI auth commands

- `deepcode auth set --provider deepseek` — prompts for an API key and
  writes it to the active profile in `~/.deepcode/config.json`.
- `deepcode auth set --provider deepseek --api-key -` — non-interactive
  variant for scripts; reads the key from stdin only.
- No CLI command accepts a plaintext API key in argv. Scripts must use stdin or
  `DEEPSEEK_API_KEY` / `DEEPCODE_API_KEY`, so keys do not leak through shell
  history or process listings.
- P1.3 must remove or reject the existing top-level `deepcode --api-key <value>`
  parser path (`packages/deep-code/src/deepcode/cli-args.mjs`) for the same
  reason. `--api-key -` is only valid on the `deepcode auth set` subcommand.
- `deepcode auth set --provider deepseek --profile <name> --base-url <url>`
  writes to the named profile and optional DeepSeek-compatible endpoint.
- `deepcode auth login` is retained as a compatibility alias for
  `deepcode auth set --provider deepseek`; it must not start OAuth.
- `deepcode auth logout [--profile <name>] [--all]` clears API keys using the
  same semantics as `/logout`.
- `deepcode auth status [--json|--text]` reports DeepSeek API-key auth only
  (env/config source, active profile, base URL, masked key).

Status behavior

- /status and any existing auth-status surface report DeepSeek API-key auth,
  never claude.ai OAuth.
- If `DEEPSEEK_API_KEY` is set, status shows source `env:DEEPSEEK_API_KEY`,
  active profile name if one resolved, configured base URL, and a masked key.
- If only `DEEPCODE_API_KEY` is set, status shows
  source `env:DEEPCODE_API_KEY (compat)`, active profile name if one
  resolved, configured base URL, and a masked key.
- If auth comes from config, status shows source `config`, active profile name,
  profile base URL, and masked key.
- If no key is available, status shows `not logged in` and points to `/login`
  or `DEEPSEEK_API_KEY`.
- Status must not read or display `CLAUDE_CODE_OAUTH_TOKEN`, claude.ai account
  email, OAuth expiry, or Anthropic subscription state after P1.3.

Missing-key behavior at startup

1. Resolve active profile from CLI/env/default config for non-secret settings
   (`base_url`, `model`, `small_model`, `reasoning_effort`, `thinking`).
2. Check env DEEPSEEK_API_KEY → if set, use it as `api_key` while preserving
   non-secret settings from the active profile.
3. Check env DEEPCODE_API_KEY → if set, use it as the compatibility alias
   while preserving non-secret settings from the active profile.
4. Check active profile in ~/.deepcode/config.json → if api_key set, use it.
5. Check legacy ~/.deepcode/deepseek-config.json → if key set, use it and
   preserve key/base/model/small-model/reasoning/thinking fields on the next
   config write.
6. If the session is non-interactive (`--print`, SDK / stream-json, or
   `--init-only`), fail fast with a structured auth error on stderr and exit
   non-zero. Do not render the TUI paste box and do not write prompt text to
   stdout.
7. Otherwise render the first-run TUI paste box.
8. Block model calls until a key is present.
9. After paste, write to ~/.deepcode/config.json under the active profile.
10. User can Ctrl-C to exit cleanly.

Removed surfaces

- ConsoleOAuthFlow.tsx — deleted.
- claude.ai/code OAuth redirect — deleted.
- Long-lived OAuth token (CLAUDE_CODE_OAUTH_TOKEN) — env name kept in the
scrub denylist only (so legacy keys in subprocess env do not leak), reader
removed.

Tests required before P1.3 OAuth UI deletion

- API key paste flow: empty config → paste → file written with 0600 perms.
- Profile switch: /profile work updates active profile, next model call
uses work key.
- Logout: clears api_key, next call shows paste box.
- Missing key in TUI: env unset, config empty → paste box renders, blocks
model calls.
- Missing key in non-interactive mode: env unset, config empty, `--print` or
SDK / stream-json mode → structured auth error on stderr, no TUI text on
stdout, non-zero exit.
- Env priority: env set + config also has key → env wins.
- Env alias: DEEPSEEK_API_KEY beats DEEPCODE_API_KEY; DEEPCODE_API_KEY beats
stored config.
- CLI secret safety: top-level `deepcode --api-key sk-...` is rejected with a
clear error; `deepcode auth set --provider deepseek --api-key -` reads from
stdin and does not expose the key in argv.
- Secret scrub: with DEEPSEEK_API_KEY, DEEPCODE_API_KEY, and legacy
CLAUDE_CODE_OAUTH_TOKEN set, Bash/MCP stdio/hooks/LSP child env does not
receive any of those variables.
- Legacy config migration: existing ~/.deepcode/deepseek-config.json is read
when config.json is absent and migrates `apiKey`, `baseUrl`, `model`,
`smallModel`, `reasoningEffort`, and `thinking` on next write.
- Status command: env key, stored-profile key, and missing-key states all
  report the correct source/profile/base URL/masked-key fields.
- Status OAuth deletion: with only legacy OAuth env/tokens present, status
  reports `not logged in` and does not mention claude.ai or Anthropic account
  metadata.
- Config corruption: malformed JSON → graceful error, does not crash,
suggests recreating.

Phase 1 unblock

This decision unblocks P1.3 (delete ConsoleOAuthFlow.tsx, OAuth env
readers, claude.ai login copy).
