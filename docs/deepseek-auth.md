# DeepSeek Authentication UX

Status: Decided
Decision date: 2026-05-10

## Summary

DeepCode authenticates to DeepSeek API using API keys only. OAuth and
claude.ai login flows are removed.

## API key intake

Two paths, env-first:

1. **Environment variable** `DEEPSEEK_API_KEY` — read at startup, takes
   priority over stored config.
2. **TUI paste flow** — if env is unset and no stored key exists in config,
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
      "base_url": "https://api.deepseek.com"
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

Missing-key behavior at startup

1. Check env DEEPSEEK_API_KEY. If set, use it (no profile system involved).
2. Check active profile in config. If api_key set, use it.
3. Otherwise render the first-run TUI paste box.
4. Block model calls until a key is present.
5. After paste, write to ~/.deepcode/config.json under the active profile.
6. User can Ctrl-C to exit cleanly.

Removed surfaces

- ConsoleOAuthFlow.tsx — deleted.
- claude.ai/code OAuth redirect — deleted.
- Long-lived OAuth token (CLAUDE_CODE_OAUTH_TOKEN) — env name kept in the
scrub denylist only (so legacy keys in subprocess env do not leak), reader
removed.

Tests required before P1.3 OAuth UI deletion

- API key paste flow: empty config to paste to file written with 0600 perms.
- Profile switch: /profile work updates active profile, next model call
uses work key.
- Logout: clears api_key, next call shows paste box.
- Missing key: env unset, config empty to paste box renders, blocks model
calls.
- Env priority: env set plus config also has key to env wins.
- Config corruption: malformed JSON to graceful error, does not crash,
suggests recreating.

Phase 1 unblock

This decision unblocks P1.3 (delete ConsoleOAuthFlow.tsx, OAuth env
readers, claude.ai login copy).
