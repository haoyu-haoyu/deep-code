# DeepCode

**A DeepSeek-V4-native terminal coding assistant for agentic software development.**

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Version](https://img.shields.io/badge/version-0.3.0-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0--only-orange)
![Status](https://img.shields.io/badge/status-prototype%20(Phase%202)-yellow)

> DeepCode is an independent, community project and is not affiliated with or endorsed by DeepSeek. It is an actively developed prototype. See [Project Status & License](#project-status--license).

---

## Table of Contents

- [What is DeepCode](#what-is-deepcode)
- [Highlights](#highlights)
- [Install & Quickstart](#install--quickstart)
- [Configuration](#configuration)
- [DeepSeek V4 Deep-Dive](#deepseek-v4-deep-dive)
- [Tools & Agentic Capabilities](#tools--agentic-capabilities)
- [Commands Reference](#commands-reference)
- [Security & Sandbox Fortress](#security--sandbox-fortress)
- [Architecture & Development](#architecture--development)
- [Project Status & License](#project-status--license)

---

## What is DeepCode

DeepCode is a DeepSeek-native terminal coding assistant for agentic software development. It pairs a mature terminal UI, a full local toolset, a permission system, sessions, skills, and subagent workflows with a model path built end-to-end on DeepSeek native chat completions, reasoning content, tool calls, and context-cache telemetry.

**Capabilities:**

- The React + Ink TUI and Yoga layout
- Local tools (file edit/read/write, Bash, search, todos/tasks, web fetch)
- The allow/deny/ask permission model and permission modes
- Sessions, history, skills, and subagent workflows
- MCP support (`@modelcontextprotocol/sdk`) and the Bun bundler

**DeepSeek-native by default:**

- Default main model `deepseek-v4-pro`, small/router model `deepseek-v4-flash`
- A hand-written DeepSeek client over `fetch`
- DeepSeek reasoning content, graded `reasoning_effort`, native tool calls, and context-cache telemetry
- Config directory `~/.deepcode`, default provider `deepseek`

---

## Highlights

- **DeepSeek V4 reasoning, on by default.** Thinking is enabled and `reasoning_effort` defaults to `max` — DeepCode runs the heavyweight reasoning path out of the box. A graded ladder (`low | medium | high | max | xhigh`) is selectable via `/effort` or env (`xhigh` is DeepSeek-V4 only and degrades gracefully on other models (xhigh -> max -> high, deepest-first)).
- **Prompt-cache moat + telemetry.** DeepCode keeps the request prefix byte-identical (append-only, locale-independent byte-ordered sorting) to maximize DeepSeek's automatic server-side prefix cache, and surfaces hit rate via `/cache` and cache telemetry in `/status`.
- **Cache-safe per-task effort.** `reasoning_effort` is **not** part of DeepSeek's prompt-cache key (probe-confirmed), so varying effort per task does not break the cache.
- **Strict function calling.** Opt-in DeepSeek `/beta` strict tools (`off | safe | all`) — when active the base URL switches to `/beta`, otherwise the request stays byte-identical.
- **Optional auto routing.** A `model=auto` router can pick between the pro and flash models per task (opt-in, not default).
- **Full agentic tool loop.** The tool loop runs concurrency-safe tools in parallel (shared cap, default 10) and serializes unsafe ones.
- **MCP, LSP, skills, subagents.** MCP servers over stdio/SSE/HTTP/WS/in-process; post-edit LSP diagnostics (when a server is configured); a bundled + on-disk skills system; and built-in/custom subagents.
- **Sandbox Fortress.** An opt-in, deny-first policy/observability layer over the bundled OS sandbox — default-inert, so a plain run is byte-identical to no sandbox.

---

## Install & Quickstart

> Install **from source**, a **pre-built binary**, or **Docker**. (DeepCode is not yet published to npm — npm distribution is planned for a later release.)

### Requirements

- Node.js **>= 18** (CI tests on Node 20 and 22)
- [Bun](https://bun.sh) (to build the full CLI from source)
- A DeepSeek API key

### Option A — From source (recommended)

```bash
git clone https://github.com/haoyu-haoyu/deep-code.git
cd deep-code

# Build the full bundled CLI (Bun.build → dist/deepcode-full.mjs; no tsc gate)
bun packages/deep-code/scripts/build-full-cli.mjs

# Provide your DeepSeek API key
export DEEPSEEK_API_KEY=sk-...

# Run
node packages/deep-code/deepcode.js "explain this repo"
```

### Option B — Pre-built single-file binary

Single-file binaries are built via `bun --compile` and published on GitHub Releases for **linux-x64**, **darwin-x64**, and **darwin-arm64** only. (Linux arm64 and Windows are not published as binaries — use Docker. Binaries are self-contained and ship without native add-ons such as `sharp`.)

```bash
# Download the binary for your platform from GitHub Releases, then:
chmod +x deepcode-darwin-arm64
export DEEPSEEK_API_KEY=sk-...
./deepcode-darwin-arm64 "explain this repo"
```

### Option C — Docker

```bash
docker pull ghcr.io/haoyu-haoyu/deepcode:latest
docker run --rm -it \
  -e DEEPSEEK_API_KEY=sk-... \
  -v "$PWD:/workspace" -w /workspace \
  ghcr.io/haoyu-haoyu/deepcode:latest "explain this repo"
```

> The GitHub Release and `ghcr.io` artifacts are the **documented** distribution channels. Check the repository's Releases page for what is actually published.

### Providing your API key

Authentication is **DeepSeek API-key only**. The key is resolved in this order, first non-empty wins:

1. `--api-key` flag
2. `DEEPSEEK_API_KEY` env var
3. `DEEPCODE_API_KEY` env var
4. `API_KEY` env var
5. The on-disk provider config (`~/.deepcode/deepseek-config.json`)

You can also run `/login` inside the TUI (it opens a setup dialog and writes the key atomically with mode `0600` under `providers.deepseek` in `~/.deepcode/deepseek-config.json`), or paste the key into the first-run box — on a missing key the TUI shows a paste box and blocks model calls until a key is present (Ctrl-C exits).

### Usage modes

```bash
# Interactive TUI
deepcode

# One prompt, print result, exit
deepcode -p "summarize the architecture"

# Pipe via stdin
echo "what does query.ts do?" | deepcode
```

---

## Configuration

Configuration is layered. Precedence (highest first):

```
CLI flag / override  >  DEEPSEEK_* env  >  DEEPCODE_* env  >  on-disk config file  >  built-in default
```

First-non-empty wins, so an **empty-string** env var falls through to the next layer.

### Environment variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` / `DEEPCODE_API_KEY` / `API_KEY` | DeepSeek API key (checked in this order) | — (required) |
| `DEEPSEEK_BASE_URL` / `DEEPCODE_BASE_URL` | API base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` / `DEEPCODE_MODEL` | Main model | `deepseek-v4-pro` |
| `DEEPSEEK_SMALL_MODEL` / `DEEPCODE_SMALL_MODEL` | Small / fast model | `deepseek-v4-flash` |
| `DEEPSEEK_THINKING` / `DEEPCODE_THINKING` | Toggle reasoning (`disabled`/`disable`/`false`/`0`/`no`/`off` ⇒ off; anything else, incl. unset ⇒ on) | enabled |
| `DEEPSEEK_REASONING_EFFORT` / `DEEPCODE_REASONING_EFFORT` | Reasoning depth: `low \| medium \| high \| max \| xhigh` (unset ⇒ `max`; unrecognized ⇒ `high`) | `max` |
| `DEEPCODE_PROVIDER` | Model provider: `deepseek \| ollama \| vllm \| openai-compatible` | `deepseek` |
| `DEEPCODE_MAX_OUTPUT_TOKENS` | Cap on generation output tokens | `64000` |
| `DEEPCODE_STRICT_TOOLS` | `/beta` strict function-calling scope: `off \| safe \| all` | `off` |
| `DEEPCODE_FEATURES` | Comma-separated opt-in feature flags (e.g. `PROACTIVE`, `KAIROS`, `WORKFLOW_SCRIPTS`, `TREE_SITTER_BASH`) | (empty) |
| `DEEPCODE_CONFIG_DIR` | Config / sessions directory | `~/.deepcode` |
| `DEEPCODE_CONFIG_FILE` / `DEEPSEEK_CONFIG_FILE` | Override the provider config file path | `~/.deepcode/deepseek-config.json` |
| `DEEPCODE_MAX_TOOL_USE_CONCURRENCY` | Per-turn parallel-tool cap | `10` |
| `ENABLE_LSP_TOOL` | Register the explicit model-callable `LSP` tool | off |

> Thinking is **on** and `reasoning_effort` defaults to **`max`** — DeepCode's default is the heavyweight reasoning path, not a lightweight one. `DEEPCODE_FEATURES` flags are experimental and OFF by default.

### On-disk files

There are **two distinct** config files under `~/.deepcode`:

- **`settings.json`** — read only by the lightweight `deepcode.js` front-controller. It layers an `env` block plus top-level keys (`thinkingEnabled`, `reasoningEffort`, `strictTools`, …) onto the environment.
- **`deepseek-config.json`** — the provider store read by the full CLI and written by `/login`. The on-disk shape is nested:

```jsonc
// ~/.deepcode/deepseek-config.json  (written 0600)
{
  "activeProvider": "deepseek",
  "providers": {
    "deepseek": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-v4-pro",
      "reasoningEffort": "max"
    }
  }
}
```

> `DEEPSEEK_API_KEY` (env) takes priority over a stored key by design.

The full CLI also reads broader settings keys: `permissions` (`allow`/`deny`/`ask`/`defaultMode`/`additionalDirectories`), `hooks`, `sandbox`, and `fortress` (see [Security & Sandbox Fortress](#security--sandbox-fortress)).

---

## DeepSeek V4 Deep-Dive

### Models

| Role | Default | Notes |
| --- | --- | --- |
| Main | `deepseek-v4-pro` | Override via `DEEPSEEK_MODEL` / `--model` / `/model` |
| Small / fast / router | `deepseek-v4-flash` | Override via `DEEPSEEK_SMALL_MODEL` / `--small-model` |

Base URL defaults to `https://api.deepseek.com`. A trailing `/beta` is auto-appended **only** when per-tool strict function-calling is active (see below).

### The `/effort` ladder and auto routing

`reasoning_effort` is a **graded** enum: `low | medium | high | max | xhigh`. Unset resolves to `max`; an unrecognized value falls back to `high`. Set it per-session with the `/effort` slash command or the `--effort` / `--reasoning-effort` flags, or globally via env.

- `xhigh` is DeepSeek-V4 only; on other models it clamps deepest-first (xhigh -> max -> high), landing on `max` only if the model supports it, otherwise `high`.
- **Auto routing** (`model=auto`) is **opt-in**, not the default. When enabled, the router can choose between the pro and flash models per task.

> **Cache-safe by design:** `reasoning_effort` is **not** part of DeepSeek's prompt-cache key (probe-confirmed), so changing effort per task does **not** invalidate the prefix cache.

### The prompt-cache moat

DeepSeek performs **automatic server-side positional prefix caching** — there are **no** manual `cache_control` wire fields to set. DeepCode's job is to keep the request **prefix byte-identical** so the server can hit the cache:

- The prefix is built **append-only** — new content is appended, never inserted in the middle.
- Tool schemas and merged tool pools are sorted with a **locale-independent byte comparison** so ordering is stable across machines and locales.
- Built-in tools form a contiguous, byte-sorted prefix; MCP tools are appended (also sorted) and deduped by name with built-ins winning — preserving the cacheable prefix.

Inspect and warm the cache with `/cache` (`inspect | warmup | clear`) and the `deepcode --warm-cache` subcommand; `/cost` and `/status` surface cost, duration, and cache telemetry.

### Strict function calling & structured output

`DEEPCODE_STRICT_TOOLS` (or `--strict-tools`) selects DeepSeek `/beta` strict function-calling:

- `off` (default) — tools are sent as ordinary OpenAI-compatible function schemas; the request stays byte-identical to a non-strict run.
- `safe` — apply strict mode to a safe subset of tools.
- `all` — apply strict mode to all tools.

When any tool is strict, the base URL switches to the `/beta` endpoint. Tools are always serialized as standard `{"type":"function", "function":{…}}` JSON schemas — there is **no** client-side "tool markup language."

---

## Tools & Agentic Capabilities

The agentic loop lives in `src/query.ts`; tool execution runs through a batched scheduler (`runTools` in `src/services/tools/toolOrchestration.ts`) that runs concurrency-safe tools in parallel up to a shared per-turn cap (default **10**, overridable via `DEEPCODE_MAX_TOOL_USE_CONCURRENCY`) and serializes non-safe ones. (A StreamingToolExecutor variant exists but is gated off by default.) The full tool registry is assembled in `src/tools.ts` (`getAllBaseTools()`), then filtered by permission deny rules, enablement, and mode.

### Default built-in tools

| Tool | Purpose |
| --- | --- |
| `Read`, `Edit`, `Write`, `NotebookEdit` | File read / edit / write (incl. notebooks) |
| `Bash` | Shell command execution |
| `Glob`, `Grep` | File globbing & content search (omitted when embedded `bfs`/`ugrep` binaries are present; `find`/`grep` are aliased in the shell instead) |
| `CodeGraph` | Default-on, read-only, dependency-free heuristic code index for JS/TS, Python, Go, Rust (`list_symbols`, `find_definition`, `import_graph`, `importers`). **Not a real parser** — does not resolve call graphs or shadowing. |
| `TodoWrite` + Task v2 (`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`) | Todo / task tracking (the v2 family is on by default in interactive mode) |
| `Agent` | Launch a subagent by `subagent_type` |
| `Skill` | Invoke a bundled or on-disk skill |
| `WebFetch` | Fetch a URL as markdown client-side (detects cross-host redirects) |
| `WebSearch` | Server-side web search — **provider-dependent** (see note) |
| `AskUserQuestion` | Ask the user a question |
| `EnterPlanMode` / `ExitPlanMode` | Plan mode |
| `EnterWorktree` / `ExitWorktree` | Git worktree mode (enabled by default) |
| `revert_turn` | Undo a prior turn's filesystem changes |
| `ListMcpResourcesTool`, `ReadMcpResourceTool` (plus per-server `mcp__<server>__<tool>` tools) | MCP tool & resource access |
| `ToolSearch` | Deferred-tool discovery — withhold tools and fetch on demand when the tool count is large |

> **WebSearch caveat.** WebSearch is present but issues a server-side `web_search` tool; whether DeepSeek's API actually serves that is provider-dependent and not guaranteed on the default model path.

> Many additional tools (REPL, Workflow, Cron, Monitor, Team swarms, PowerShell, etc.) are gated behind feature flags, OS, or internal user types and are **not** in the default DeepSeek build.

### Subagents

Subagents are launched via the `Agent` tool with a `subagent_type`. Built-in agents include an **explorer**, **general-purpose**, **worker**, **summarizer**, a **verification** agent, and **statusline-setup**; the read-only **Explore** / **Plan** agents are added when enabled. The Explore/explorer agents are **read-only** — they cannot Edit, Write, NotebookEdit, exit plan mode, or launch further agents.

### MCP

MCP servers are configured in `.mcp.json` and managed via `/mcp`. Supported transports: **stdio, sse, sse-ide, http, ws (websocket), sdk (in-process)**. MCP tools merge with built-ins via `assembleToolPool()`, sorted to preserve the cacheable prefix and deduped by name (built-ins win).

### LSP diagnostics

Post-edit LSP diagnostics are **config-default-on** and run automatically after `Edit`/`Write` — but only produce output when an LSP server is actually configured or a built-in server matches the file (zero servers ⇒ no output). The separate explicit **`LSP` tool** (model-callable) is **off** unless `ENABLE_LSP_TOOL` is set.

### Skills

Skills are invoked via the `Skill` tool. They ship as **bundled** skills (e.g. `verify`, `debug`, `batch`, `simplify`, `remember`, `skillify`, `stuck`, `update-config`, `keybindings-help`) and are also loaded from on-disk `/skills/` directories (and legacy `/commands/`) with YAML frontmatter (`name`, `description`, `whenToUse`, `hooks`, `paths`).

### Hooks

The hook system defines ~28 event names — including `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, and `Setup` — configured under a `hooks` settings key.

---

## Commands Reference

DeepCode exposes ~45–50 user-facing slash commands (the canonical set is the `COMMANDS` array in `src/commands.ts`). Descriptions are sourced from an i18n catalog (`en`, `zh-Hans`, `ja`), so the UI is localizable via `/locale` and `--locale`.

### Session & history

| Command | Description |
| --- | --- |
| `/resume` | Resume a previous conversation |
| `/session` | (remote mode only) Show remote session URL and QR code |
| `/rename` | Rename the current conversation |
| `/branch` | Create a branch of the conversation at this point |
| `/export` | Export the conversation to a file or clipboard |
| `/clear` | Clear conversation history and free up context |
| `/compact`, `/copy` | Compact context / copy |

### Model & reasoning

| Command | Description |
| --- | --- |
| `/model` | Set the AI model |
| `/effort` | Set effort level (`low \| medium \| high \| max \| xhigh`) |
| `/provider` | Switch provider (`deepseek` / `ollama` / `vllm` / `openai-compatible`) |
| `/config` | Open config panel |
| `/advisor` | Configure the advisor model (only appears when an advisor config is enabled) |

### Cache, cost & stats

| Command | Description |
| --- | --- |
| `/cache` | Inspect DeepSeek cache hit rate (`inspect \| warmup \| clear`) |
| `/cost` | Show total cost & duration of the session |
| `/stats` | Show usage statistics and activity |
| `/context` | Visualize current context usage as a colored grid |
| `/insights` | Generate a report analyzing your sessions |

### Planning & review

| Command | Description |
| --- | --- |
| `/plan` | Enable plan mode or view the session plan |
| `/review` | Review a pull request |
| `/security-review` | Security review of pending changes |
| `/pr-comments` | Get comments from a GitHub PR |
| `/tasks` | List and manage background tasks |

### Workspace & rewind

| Command | Description |
| --- | --- |
| `/add-dir` | Add a new working directory |
| `/diff` | View uncommitted changes and per-turn diffs |
| `/restore` | Restore workspace from a pre-turn snapshot |
| `/rewind` | Restore the code and/or conversation to a previous point (alias `/checkpoint`) |

### Extensibility

| Command | Description |
| --- | --- |
| `/mcp` | Manage MCP servers |
| `/skills` | List available skills |
| `/plugin` | Manage Deep Code plugins |
| `/reload-plugins` | Activate pending plugin changes |
| `/hooks` | View hook configurations for tool events |
| `/agents` | Manage agent configurations |
| `/memory` | Edit Deep Code memory files |
| `/init` | Initialize project context |

### Sandbox, permissions & diagnostics

| Command | Description |
| --- | --- |
| `/permissions` | Manage allow & deny tool permission rules |
| `/sandbox` | Toggle sandboxing |
| `/harness` | Show DeepSeek Harness mode, prompt pack, agent limits, strict-tool settings |
| `/doctor` | Diagnose your install, DeepSeek provider, and settings |
| `/status` | Show version, model, provider, cache telemetry, tool statuses |
| `/ide` | Manage IDE integrations and show status |
| `/help` | Show help and available commands |

### TUI personalization

`/theme` · `/color` · `/statusline` · `/keybindings` (may require a feature gate to appear) · `/vim` · `/output-style` (deprecated → `/config`)

### Non-interactive CLI

The CLI has two layers. A **lightweight native front-controller** (`deepcode.js`) handles a small flag set and delegates everything else (prompts, unknown flags) to the **full bundled CLI** (`dist/deepcode-full.mjs`).

**Native front-controller subcommands / flags:**

| Flag | Purpose |
| --- | --- |
| `--status` | Show status |
| `--doctor [--no-live]` | Run diagnostics |
| `--harness` | Show harness config |
| `--warm-cache` | Warm the prompt cache |
| `--compact` | Compact |
| `--tool-e2e`, `--agent-e2e` | End-to-end test modes |
| `-p` / `--print` | Print mode (one-shot, then exit) |
| `--help`, `--version` | Help / version |

Option flags (mapped to env): `--api-key`, `--base-url`, `--model`, `--small-model`, `--provider`, `--thinking`, `--reasoning-effort`, `--max-tokens`, `--strict-tools`.

**Full bundled CLI (commander tree):**

| Command / flag | Purpose |
| --- | --- |
| `deepcode "<prompt>"` | Top-level prompt mode |
| `-c` / `--continue`, `-r` / `--resume [value]`, `--fork-session`, `--from-pr` | Session continuation |
| `--output-format <text\|json\|stream-json>`, `--input-format <text\|stream-json>` | I/O formats |
| `--model`, `--provider`, `--effort <level>` | Model selection |
| `--permission-mode`, `--dangerously-skip-permissions`, `--allowedTools`/`--disallowedTools` | Permissions |
| `--mcp-config`, `--add-dir`, `--ide`, `--settings`, `--setting-sources`, `--session-id`, `--locale`, `--bare` | Misc |
| `deepcode mcp serve\|add-json\|list\|get\|remove` | MCP server management & server mode |
| `deepcode serve --http [--host --port]` | HTTP serve mode (Bearer-token auth required) |
| `deepcode serve --acp` | Start a stdio Agent Client Protocol (ACP) server over stdio for editor integration — a real tool-executing DeepSeek agent loop (read-only tools auto-approved, write tools permission-gated). (Note: the in-code flag help still reads "reserved for a future protocol phase" and is stale; the server is actually implemented and e2e-tested.) |
| `deepcode fork`, `deepcode session list\|show\|rm\|fork\|export` | Sessions |
| `deepcode plugin install\|uninstall\|enable\|disable\|list\|validate` | Plugins |
| `deepcode agents`, `deepcode doctor`, `deepcode update`, `deepcode install`, `deepcode completion` | Misc |

**IDE integration:** the `--ide` startup flag auto-connects to a single available IDE; `/ide` manages integrations from the TUI.

> Several commands (`/commit`, `/bughunter`, `/env`, `/share`, `/summary`, `/issue`, `/tag`, `/files`, …) are internal-only (`USER_TYPE=ant`) or disabled stubs and are **not** available to normal users. `/login` / `/logout` / `/mobile` are gated behind legacy-service env flags and hidden by default.

---

## Security & Sandbox Fortress

DeepCode layers a **Sandbox Fortress** — a five-layer security extension — on top of a bundled OS-sandbox library (consumed as a black box). The underlying OS sandbox uses macOS Seatbelt, Linux bubblewrap+landlock+seccomp, and an HTTP/SOCKS proxy; supported platforms are macOS, Linux, and WSL2.

> **Opt-in and default-inert.** The base OS sandbox is **OFF by default** (`sandbox.enabled` defaults to `false`), and the Fortress is default-inert with no `settings.fortress` block. With neither configured, behavior is **byte-identical** to a plain run.

### What the Fortress rule engine does

The Fortress governs four resource kinds — **fs-read, fs-write, net-host, process-exec** — with `allow | deny | ask` actions, organized into a four-layer trust hierarchy: **BuiltinDefault < Org < Agent < User**. Resolution is **deny-first and absolute**: any matching deny blocks, with no fail-open escape hatch.

**Enforcement is partial and honestly documented:**

| Resource | Enforcement |
| --- | --- |
| `fs-write` (DENY, absolute, glob-free) | Projected into the OS sandbox so it is enforced for Bash/shell commands |
| `fs-read` / `fs-write` (per-call) | File tools enforce per call on symlink-resolved paths |
| `process-exec` | Gates the binaries a Bash command invokes — **best-effort defense-in-depth, not a hard boundary** (obfuscated commands via `eval`, `bash -c`, `base64` can evade it; only explicit matching rules enforce) |
| `net-host` | **Parsed but inert** — enforced by no layer; `deepcode doctor` surfaces every net-host rule as an unenforced warning |

> Per-tool `networkMode` is documented in code as **advisory only — not a security boundary**; it does not block outbound traffic.

Other Fortress properties:

- **Effort ↔ strictness coupling.** Fortress effort (`off | high | max`, narrower than the main reasoning ladder) maps to lenient/standard/paranoid; only `paranoid` (effort `max`) makes an un-ruled access default to deny. Effort never weakens an explicit deny.
- **Case-folded deny on case-insensitive filesystems.** On macOS/Windows, fs-read/fs-write DENY rules match case-folded so `~/.SSH` can't bypass `~/.ssh`; ALLOW rules match verbatim to avoid over-granting.
- **Hardened matching.** A non-backtracking (no-regex) pattern matcher avoids ReDoS; config loaders are prototype-pollution-resistant and never throw on malformed input (fall back to the conservative default).
- **Observability.** Dry-run mode, a violation log, model-facing violation feedback, and a cache-friendly config summary that keeps the default request prefix byte-identical.

### Permission model

Separate from the Fortress, a full **allow / deny / ask** permission system governs tool use: rules plus `additionalDirectories` and `defaultMode` under `settings.permissions`, with five permission modes — `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`. A blanket deny rule for a tool name (including an `mcp__server` prefix) strips matching tools before the model ever sees them.

### Secret redaction

Before a transcript is shared, a redaction scrubber strips credentials from the JSON payload before it is POSTed — `sk-ant` keys, bare `sk-`/`sk-proj` DeepSeek/OpenAI keys, AWS (`AKIA`) keys, GCP (`AIza`, service accounts), and `authorization`/`x-api-key`/token/password values. It specifically targets DeepCode's primary credential — a bare `sk-` DeepSeek key stored on disk in `deepseek-config.json` — and is described in code as the **sole guard** on the transcript-share POST.

> This scrubber runs **only** on the transcript-share path, not on all logs everywhere. There is **no** `SECURITY.md` / responsible-disclosure policy in this repo.

---

## Architecture & Development

### Layout

DeepCode is a Bun-built **npm-workspaces monorepo**:

- **Root** `deep-code` (v0.1.0, private) — a thin workspace wrapper; its bin shims point at `packages/deep-code/deepcode.js`.
- **`packages/deep-code`** `@deepcode-ai/deep-code` (v0.3.0, AGPL-3.0-only, Node ≥18, ESM, **zero declared runtime deps** — `sharp` is optional-only) — the real implementation.

### Two runtime paths

1. **`deepcode.js`** — a thin native front-controller that serves `--status`, `--doctor`, `--tool-e2e`, `--version` directly…
2. **`dist/deepcode-full.mjs`** — …and delegates the TUI and rich CLI (entry `src/entrypoints/cli.tsx` / `src/main.tsx`) for prompts and unknown flags. (The path is resolvable via `DEEPCODE_FULL_CLI_PATH`.)

> The committed `cli.js` (~13 MB) and `cli.js.map` are **stale legacy artifacts**, not the runtime. The wrapper reports a version string (`0.1.0-deepseek-native`) that differs from the package version (`0.3.0`).

### Build

```bash
# Build the full bundled CLI (Bun.build, target node, ESM; no tsc gate)
bun packages/deep-code/scripts/build-full-cli.mjs   # → dist/deepcode-full.mjs
# Inline variant
# → dist/deepcode-full-inline.mjs

# Build single-file binaries (bun build --compile)
node packages/deep-code/scripts/build-binaries.mjs  # linux-x64, darwin-x64, darwin-arm64
```

A Dockerfile builds on `node:22-slim` with `ENTRYPOINT node …/deepcode.js`.

### Tests

- CI runs `node --test` over ~120 `.mjs` test files on **Node 20 and 22**, plus a PR-only **perf gate** (threshold 0.20) and a non-blocking Bun TUI harness.
- Note: the `.ts`/`.tsx` UI is exercised only via the Bun bundle and the non-blocking harness — it is **not** type-checked by the CI gate (there is no `tsc` gate).
- **Live DeepSeek e2e** is a separate workflow (manual or nightly cron), gated on `DEEPSEEK_API_KEY`.

### Multi-provider registry

The provider registry (`registry.mjs`) defines:

| Provider | Notes |
| --- | --- |
| `deepseek` | Default; native DeepSeek client over `fetch` |
| `ollama` | OpenAI-compatible (localhost `:11434/v1`, streaming + `tool_calls` only) |
| `vllm` | OpenAI-compatible |
| `openai-compatible` | OpenAI-compatible |

### Stack

TypeScript · React + Ink TUI (Ink vendored under `src/ink`) · Yoga layout · Zod · Bun bundler · `@modelcontextprotocol/sdk`. Entry: `src/entrypoints/cli.tsx`.

---

## Project Status & License

DeepCode is an actively developed **prototype** at a Phase 2 feature-parity baseline:

- **Phase 1** established the DeepSeek-native runtime path (`v0.2.0-pure`).
- **Phase 2** reached DeepSeek-TUI feature parity (`v0.3.0-feature-parity`).
- **Phase 3** (distribution) is in progress.

Licensed **AGPL-3.0-only** — full text in [`LICENSE.md`](packages/deep-code/LICENSE.md). DeepCode is an independent, community project ([github.com/haoyu-haoyu/deep-code](https://github.com/haoyu-haoyu/deep-code)) and is not affiliated with or endorsed by **DeepSeek**.
