# Pure DeepSeek TUI — Codex Execution Plan

**Mission**: Transform this repo from a Claude-Code-fork-adapted-for-DeepSeek into a **pure-blood, DeepSeek-native terminal coding agent** with zero Anthropic surface area, while combining the best of [Hmbown/DeepSeek-TUI](https://github.com/Hmbown/DeepSeek-TUI) (Rust, 22k stars) and our existing strengths (Ink TUI, voice mode, IDE integration, perf-tuned hot paths).

**Target executor**: Codex CLI (via `codex:rescue` agent or direct).
**Maintainer**: Human reviewer who runs Codex against this file task-by-task.
**Repo root**: `/Users/wanghaoyu/Downloads/deepcode源码`
**Package root**: `packages/deep-code/`
**Default branch**: `main` (currently at commit `ae04ac4`).

---

## How to Read This File

This plan is structured as a **sequence of self-contained tasks** identified by task ID (e.g., `P1.3`). Each task has:

- **Goal** — one sentence on what to achieve
- **Pre-conditions** — what must already be true (usually a prior task)
- **Files** — concrete paths to touch (Codex still searches; this is a hint)
- **Operations** — ordered, specific edits / commands
- **Acceptance** — verifiable criteria (test names, grep counts, build success)
- **Risk** — what can break, how to detect
- **Branch** — branch name to use (one task = one branch = one PR = one squash merge)

### Codex execution protocol (READ THIS BEFORE STARTING)

1. **Pick exactly one task** by ID. Do not bundle multiple tasks unless the plan says so.
2. **Read the task's `Files` and `Pre-conditions` first**. Confirm pre-conditions hold. If not, stop and report.
3. **Execute the `Operations`** in order. Do NOT improvise scope expansion.
4. **Run `Acceptance` checks**. All must pass before proceeding.
5. **Build + test gauntlet** (mandatory, every task):
   ```bash
   cd packages/deep-code
   bun run build:full-cli
   node --test test/deepcode-native.test.mjs test/deepcode-package.test.mjs \
     test/perf-baseline.test.mjs test/s3-render-perf.test.mjs \
     test/s2-streaming-text.test.mjs test/a2-bash-polling.test.mjs \
     test/a4-paste-cleanup.test.mjs test/s1-tool-streaming.test.mjs \
     test/s4-streaming-resume.test.mjs test/phase5-perf-compare.test.mjs \
     test/phase5-ci-workflow.test.mjs test/b3-voice-unmount.test.mjs \
     test/a1-mcp-nonblocking.test.mjs
   bun test test/tui-deepseek.test.mjs
   ```
   Plus any task-specific tests added by `Operations`. All green is mandatory.
6. **Self-review with codex:rescue** (mandatory): re-read the diff, check for sneaky regressions. If issues found, fix and re-review until clean.
7. **Commit** on the task's branch with message format:
   ```
   {phase}: {one-line summary} ({TASK_ID})

   {2-4 line motivation}
   {what changed at the file level}
   {acceptance evidence: "240 tests pass, ..."}
   ```
8. **Open PR** to `main`. Wait for CI green. Squash-merge.
9. **Delete branch** (local + remote). Sync main.
10. **Report back** in the format:
    ```
    Task: P{N}.{M}
    Status: completed
    Commit: <merged-squash-sha>
    PR: <url>
    Notes: <anything surprising / deviations / followups>
    ```

### Naming convention

| Symbol | Replacement |
|---|---|
| `Claude Code` (product, in user-visible / system-prompt strings) | `DeepCode` |
| `claude` (binary, in CLI hints) | `deepcode` |
| `CLAUDE.md` (filename convention) | `DEEPCODE.md` (with backward-read fallback for migration) |
| `CLAUDE_CODE_*` (env var prefix) | `DEEPCODE_*` (DEEPCODE_* takes precedence; CLAUDE_CODE_* removed entirely after Phase 1) |
| `~/.claude/` (config dir) | `~/.deepcode/` (with one-shot migration) |
| `@anthropic-ai/sdk` (npm dep) | Removed; replace with our DeepSeek client + minimal type stubs |
| Anthropic literal product names ("Claude Code on the web", "Claude Code Desktop", "Claude Code GitHub Action", `#claude-code-feedback` Slack) | **Remove the entire feature** — these reference services we cannot use |

### What stays untouched

- React + Ink + React Compiler memoization stack (our perf moat)
- Yoga layout + ClockContext shared-clock animations
- Voice Mode UI (audio capture pipeline; STT backend gets swapped — see P1.10)
- MCP support (open standard; keep `@modelcontextprotocol/sdk`)
- bun bundler
- Existing TODO.md achievements (Tier S/A/B optimizations stay)
- Existing test suite + CI gate

### What goes away entirely (no DeepSeek replacement)

These are Anthropic-platform-only features that cannot work in a DeepSeek-pure build:

1. **Bridge / Remote Control / claude.ai web sessions** — `src/bridge/`, `src/commands/bridge/`, `src/commands/btw/`
2. **Teleport** — `src/utils/teleport*`, `src/components/Teleport*`
3. **Ultraplan (CCR plan-on-the-web)** — `src/commands/ultraplan*`
4. **Chrome integration (Claude in Chrome)** — `src/commands/chrome/`, `src/components/ClaudeInChromeOnboarding.tsx`, `src/utils/claudeInChrome/`
5. **Desktop upsell** — `src/components/DesktopUpsell/`
6. **Anthropic OAuth flow** — `src/components/ConsoleOAuthFlow.tsx`, `src/cli/handlers/auth.ts` (keep auth surface but route to DeepSeek API key only)
7. **Schedule remote agents (CCR triggers)** — `src/skills/bundled/scheduleRemoteAgents.ts`, `src/tools/RemoteTriggerTool/`
8. **Trusted-device registration** — `src/bridge/trustedDevice.ts`
9. **firstTokenDate (Anthropic-billed metric)** — `src/services/api/firstTokenDate.ts`
10. **AUP refusal text** (mention Anthropic's Usage Policy by URL) — replaced with DeepSeek policy reference or generic
11. **Statsig sampling for `tengu_*` events** — `src/services/analytics/firstPartyEventLogger.ts` (keep telemetry hooks if user opts in; route to a DeepSeek-friendly endpoint or no-op)
12. **GrowthBook feature flags** (`tengu_*`, `tengu_desktop_upsell`, etc.) — replace with a local config flag system

### Strategic decisions (locked in)

| Decision | Choice | Why |
|---|---|---|
| **Language** | Stay on TypeScript / Bun / Ink | Rewriting to Rust loses our 6 months of perf work + voice mode + Ink TUI moat. DeepSeek-TUI's 22k stars came from Rust speed, but our angle is **TUI quality + multimodal**, not raw startup ms. |
| **Naming** | Keep "DeepCode" / `deepcode` binary | Already shipping; package name `@deepcode-ai/deep-code`. |
| **Config path** | `~/.deepcode/` (migrate from `~/.claude/` if found) | Backward-read once, write-forward only. |
| **API client** | Hand-written DeepSeek client over `fetch` (already exists in `src/services/providers/deepseek.mjs`); kill `@anthropic-ai/sdk` | Lighter, no Anthropic surface. |
| **MCP** | Keep `@modelcontextprotocol/sdk` | Open standard; the SDK doesn't pull Anthropic-specific code. |
| **Voice STT** | Replace Anthropic `voice_stream` with **local Whisper.cpp** (default) + **Deepgram cloud** (opt-in) | Anthropic STT goes; Whisper is free + local-only matches DeepSeek's privacy story. |
| **Multi-provider** | Add `--provider {deepseek,ollama,vllm,openai}` like DeepSeek-TUI | Drives adoption; trivially layered on top of our OpenAI-compatible client. |
| **Distribution** | npm primary, Docker secondary, no homebrew/cargo (we're not Rust) | Match what we can deliver. |

---

## Phase Overview

| Phase | Focus | Effort | Risk |
|---|---|---|---|
| **0** | Audit & inventory | 1-2d | low |
| **1** | Excise Anthropic surfaces | 5-8d | high (build breakage) |
| **2** | Adopt DeepSeek-TUI parity features | 3-4w | medium |
| **3** | Distribution pipeline | 1w | low |
| **4** | Differentiation polish | 1-2w | low |
| **5** | Documentation overhaul | 3-5d | low |

Total: ~2 months of focused engineering.

**Phase ordering rule**: do Phase 1 surgically before Phase 2 features. Cleaning the surface area first means new features land on a clean foundation, not on top of dying Anthropic plumbing.

---

# Phase 0 — Audit & Inventory

**Goal**: Build complete maps of (a) every Anthropic surface in the codebase, (b) every literal Anthropic product reference, (c) every config path / env var to migrate. No code changes in this phase — only generated artifacts.

**Effort**: 1-2 days.

**Success criteria**: Three machine-readable inventories committed to `audit/` directory. All subsequent phases reference these.

---

### P0.1 — Anthropic SDK import inventory

**Goal**: Generate a complete list of every `@anthropic-ai/*` import, with file path, line, and the imported symbol.

**Pre-conditions**: clean working tree on `main`.

**Branch**: `audit/anthropic-imports`

**Files**: writes `audit/anthropic-imports.json` and `audit/anthropic-imports.md`.

**Operations**:

1. Run:
   ```bash
   cd packages/deep-code
   grep -rnE "from ['\"]@anthropic-ai/[^'\"]+['\"]" src/ \
     --include='*.ts' --include='*.tsx' --include='*.mjs' \
     > /tmp/anthropic-imports.raw
   ```
2. Parse into `audit/anthropic-imports.json` with shape:
   ```json
   [
     {
       "file": "src/services/api/claude.ts",
       "line": 1,
       "import": "APIUserAbortError",
       "from": "@anthropic-ai/sdk",
       "category": "sdk-types | sdk-runtime | sdk-bedrock | sdk-foundry | sdk-mcpb"
     },
     ...
   ]
   ```
3. Categorize each import:
   - `sdk-types`: type-only (e.g., `MessageStream`, `Tool`, `MessageParam`)
   - `sdk-runtime`: runtime client (`Anthropic`, `APIError`, `APIUserAbortError`)
   - `sdk-bedrock` / `sdk-foundry` / `sdk-mcpb`: optional cloud variants
4. Write `audit/anthropic-imports.md` summarizing counts by category and listing top 20 most-imported symbols.

**Acceptance**:
- File `audit/anthropic-imports.json` is valid JSON with ≥140 entries (current count).
- File `audit/anthropic-imports.md` exists with category counts.
- `node -e "JSON.parse(require('fs').readFileSync('audit/anthropic-imports.json'))"` exits 0.

**Risk**: low. Pure read-only.

---

### P0.2 — Anthropic-only feature directory inventory

**Goal**: List every directory whose entire purpose is Anthropic-platform-only.

**Branch**: `audit/anthropic-features`

**Files**: writes `audit/anthropic-features.md`.

**Operations**:

1. Walk these directories and confirm their content is Anthropic-only:
   - `src/bridge/`
   - `src/commands/bridge/`
   - `src/commands/btw/`
   - `src/commands/chrome/`
   - `src/commands/desktop/`
   - `src/commands/ultraplan*`
   - `src/components/DesktopUpsell/`
   - `src/components/ConsoleOAuthFlow.tsx`
   - `src/components/Teleport*`
   - `src/components/ClaudeInChromeOnboarding.tsx`
   - `src/components/ClaudeMdExternalIncludesDialog.tsx`
   - `src/components/IdeOnboardingDialog.tsx`
   - `src/utils/teleport*`
   - `src/utils/claudeInChrome/`
   - `src/services/voiceStreamSTT.ts` (Anthropic voice endpoint)
   - `src/services/api/firstTokenDate.ts`
   - `src/services/api/claude.ts` (the Anthropic API client; we keep file scaffolding but gut Anthropic-specific paths)
   - `src/skills/bundled/scheduleRemoteAgents.ts`
   - `src/skills/bundled/stuck.ts` (`[ANT-ONLY]` gated; safe to delete)
   - `src/tools/RemoteTriggerTool/`
   - `src/constants/github-app.ts` (Anthropic GitHub Action template)

2. For each, classify as:
   - **DELETE**: pure Anthropic, no DeepSeek equivalent (most of above)
   - **REWRITE**: keep file, swap implementation (e.g., `voiceStreamSTT.ts` becomes Whisper)
   - **STUB**: keep exports as no-ops to avoid cascading import failures during transition

3. Write a table with columns: `path | classification | dependents (importing files count) | notes`.

**Acceptance**:
- `audit/anthropic-features.md` exists.
- Every entry has classification + dependent count.
- Total file count ≥ 47 (current grep result).

---

### P0.3 — Config + env-var migration map

**Goal**: Document every `CLAUDE.md` / `~/.claude/` / `CLAUDE_CODE_*` reference and the migration plan.

**Branch**: `audit/config-paths`

**Files**: writes `audit/config-migration.md`.

**Operations**:

1. Grep:
   ```bash
   grep -rnE "(CLAUDE_CODE_[A-Z_]+|\\.claude/|CLAUDE\\.md|~/.claude)" src/ \
     --include='*.ts' --include='*.tsx' --include='*.mjs' \
     > /tmp/config-refs.raw
   ```
2. For each ref, record:
   - File / line
   - Kind: `env-var` / `config-path` / `memory-file` / `slash-command-dir`
   - Already-aliased? (Phase 5 added DEEPCODE_* aliases for many env vars; check `src/utils/branchedEnv.mjs` callers)
   - Migration action: `delete legacy` / `keep alias for one release` / `rewrite reader to prefer .deepcode then fallback .claude (one-shot)`

3. Generate the **target end state**:
   - `~/.claude/` → `~/.deepcode/` (one-shot migration on first run if `.deepcode/` doesn't exist and `.claude/` does)
   - `CLAUDE.md` → `DEEPCODE.md` (read both, prefer `DEEPCODE.md`; fallback removed in next major)
   - `.claude/commands/` → `.deepcode/commands/` (read both for compat with existing user repos)
   - `CLAUDE_CODE_*` env vars → `DEEPCODE_*` (already aliased; remove `CLAUDE_CODE_*` reads in Phase 1)

4. Write `audit/config-migration.md` with the table + migration plan.

**Acceptance**:
- File exists.
- Every CLAUDE_CODE_* env var has a target action.
- Migration plan covers the one-shot ~/.claude → ~/.deepcode dance.

---

### P0.4 — Literal Anthropic product references

**Goal**: List every place a literal Anthropic product name appears (Claude Code, Claude Code Desktop, Claude Code on the web, etc.) that is NOT a code identifier.

**Branch**: `audit/anthropic-products`

**Files**: writes `audit/anthropic-product-refs.md`.

**Operations**:

1. Grep all string literals containing the patterns. Filter out:
   - Code comments
   - OAuth `client_name` (literal Anthropic OAuth client identifier — these go away in Phase 1.4)
   - URLs to claude.com / anthropic.com (these go too)
2. Categorize each finding into one of:
   - `feature-removal` (string lives inside a file we're deleting in Phase 1)
   - `rebrand` (string survives but needs DeepCode wording)
   - `link-removal` (URL to Anthropic content; replace with DeepSeek equivalent or remove)

**Acceptance**:
- File exists with ≥ 20 entries (we know there are user-visible refs, plus URLs).

---

### P0.5 — Risk register

**Goal**: Catalog every "if we touch this it will break X" hazard before Phase 1 starts.

**Branch**: `audit/risks`

**Files**: writes `audit/risk-register.md`.

**Operations**:

1. Identify and document risks in three categories:

   **Build-breaking risks**:
   - Removing `@anthropic-ai/sdk` will break the build everywhere `APIError` / `APIUserAbortError` / `MessageStream` / etc. are imported. Need a stub or rewrite to compile.
   - Removing `@anthropic-ai/bedrock-sdk` / `foundry-sdk` may be safe (already in `optionalBarePackages`). Verify.
   - The bundler (`scripts/build-full-cli.mjs`) has `optionalBarePackages` and `optionalStaticStubs` lists. Removing dependents may invalidate stubs.

   **Runtime-breaking risks**:
   - `useManageMCPConnections.ts` uses `claudeaiPromise` for claude.ai connectors. Removing claude.ai path means the hook needs simplification.
   - `print.ts` mode awaits MCP connection — verify removal of claude.ai parts doesn't desync the await.
   - The `--init-only` flag may rely on auth flow that we're removing.

   **User-visible regressions**:
   - Users who have `~/.claude/` won't find their settings unless we do the one-shot migration.
   - Users with `CLAUDE.md` files in their projects won't be picked up unless we read both names.
   - GrowthBook flag removal may default-off some features that were on for some users.

2. For each risk: `severity (low/med/high) | mitigation | testing strategy`.

**Acceptance**:
- File exists with ≥ 15 risks across 3 categories.
- Every risk has a mitigation plan.

---

### P0.6 — Phase 0 sign-off

**Goal**: One PR aggregating all five audit artifacts (P0.1–P0.5) into `audit/` directory at repo root.

**Branch**: `audit/phase-0-aggregate`

**Operations**:

1. After P0.1–P0.5 are merged individually, this task verifies all files exist and are consistent.
2. Generate `audit/README.md` with table of contents linking to the 5 files.

**Acceptance**:
- `audit/` contains: `README.md`, `anthropic-imports.json`, `anthropic-imports.md`, `anthropic-features.md`, `config-migration.md`, `anthropic-product-refs.md`, `risk-register.md`.
- All linked files render in GitHub UI.

---

# Phase 1 — Excise Anthropic Surfaces

**Goal**: Remove every Anthropic-only code path and dependency. After this phase, `grep -r "@anthropic-ai" src/` returns 0 hits, `grep -r "claude.ai\|anthropic.com" src/` only matches code comments documenting historical migration context.

**Effort**: 5-8 days.

**Strategy**: Bottom-up — leaves first (commands users see), then middle (services they call), then root (SDK imports). Each task is one PR. Build must stay green at every step.

**Order of attack**:
1. Delete pure-Anthropic command surfaces (`/bridge`, `/btw`, `/chrome`, `/desktop`, `/ultraplan`, etc.)
2. Delete tools that only call claude.ai APIs
3. Delete components that render Anthropic-only UI
4. Migrate config paths (`.claude` → `.deepcode`)
5. Replace voice STT with Whisper.cpp local
6. Stub or remove `@anthropic-ai/sdk` types
7. Remove `@anthropic-ai/sdk` runtime
8. Excise GrowthBook / Statsig flag surface

---

### P1.1 — Delete bridge / Remote Control feature

**Goal**: Remove all of `src/bridge/`, `src/commands/bridge/`, `src/commands/btw/`, and their integration points.

**Pre-conditions**: P0.5 risk register reviewed.

**Branch**: `excise/bridge`

**Files** (delete):
- `src/bridge/` (entire directory)
- `src/commands/bridge/`
- `src/commands/btw/`

**Files** (edit to remove imports):
- `src/main.tsx` — remove all bridge / RemoteControl imports + setup
- `src/screens/REPL.tsx` — remove any Bridge UI
- Any commander registration in `src/main.tsx` that references bridge subcommands

**Operations**:

1. `git rm -r src/bridge src/commands/bridge src/commands/btw`
2. Run `bun run build:full-cli`. Note every "Cannot find module" / unresolved import error.
3. For each error, locate the importing file and either:
   - Remove the import + the calling code path (preferred — bridge is a leaf feature)
   - Stub the import to a no-op (`export const launchBridge = () => Promise.reject(new Error('removed'))`) — only if the call site is hard to surgically remove
4. Re-run build until clean.
5. `grep -r "bridge\|Bridge" src/` — verify only legitimate uses (e.g., the word "bridge" in unrelated comments) remain.
6. Run all tests.

**Acceptance**:
- `bun run build:full-cli` exits 0.
- All 240+ existing tests pass.
- `find src/bridge src/commands/bridge src/commands/btw 2>/dev/null` returns nothing.
- No new lint warnings.

**Risk**:
- **medium**. Bridge has tendrils into REPL via permissions and trustedDevice. Use the audit P0.2 dependent count to plan.
- If you find > 5 import sites, that's an early-warning sign — pause and re-scope.

---

### P1.2 — Delete Teleport / Ultraplan / CCR features

**Goal**: Remove `src/utils/teleport*`, `src/components/Teleport*`, `src/commands/ultraplan*`, related skills.

**Pre-conditions**: P1.1 merged.

**Branch**: `excise/teleport-ccr`

**Operations** (same pattern as P1.1):
1. `git rm` each:
   - `src/utils/teleport.tsx`
   - `src/utils/teleport/` (directory)
   - `src/components/Teleport*` (3+ files)
   - `src/components/tasks/RemoteSession*` (CCR remote session UI)
   - `src/commands/ultraplan*` (commands + tsx components)
   - `src/skills/bundled/scheduleRemoteAgents.ts`
   - `src/tools/RemoteTriggerTool/`
2. Build, fix import errors, repeat.

**Acceptance**:
- Build green.
- Tests green.
- `grep -ri "teleport\|ultraplan\|CCR\|claude\.ai/code/remote" src/` returns 0 product-name hits.

---

### P1.3 — Delete Chrome / Desktop / OAuth UI

**Goal**: Remove `src/commands/chrome/`, `src/components/ClaudeInChromeOnboarding.tsx`, `src/utils/claudeInChrome/`, `src/components/DesktopUpsell/`, `src/components/ConsoleOAuthFlow.tsx`, `src/cli/handlers/auth.ts` (rewrite to DeepSeek-only API key flow).

**Pre-conditions**: P1.2 merged.

**Branch**: `excise/chrome-desktop-oauth`

**Operations**:

1. `git rm`:
   - `src/commands/chrome/`
   - `src/components/ClaudeInChromeOnboarding.tsx`
   - `src/utils/claudeInChrome/`
   - `src/components/DesktopUpsell/`
   - `src/components/ConsoleOAuthFlow.tsx`
   - `src/services/api/firstTokenDate.ts`
   - `src/skills/bundled/stuck.ts` (`[ANT-ONLY]` gated)
2. Rewrite `src/cli/handlers/auth.ts` to ONLY support DeepSeek API key (interactive prompt + save to `~/.deepcode/config.json`):
   ```ts
   // pseudocode
   export async function authSetHandler({ apiKey }: { apiKey?: string }) {
     const key = apiKey ?? await promptForKey();
     await saveDeepSeekKey(key);
     console.log(chalk.green('DeepSeek API key saved.'));
   }
   ```
3. Update `src/main.tsx` to remove `--chrome`, OAuth flow entry, etc.
4. Build + tests.

**Acceptance**:
- `auth set --provider deepseek` works.
- `auth set --provider claude` does NOT exist.
- All tests pass.
- `grep -r "claude\.ai\|console\.anthropic" src/` returns 0 user-facing hits.

---

### P1.4 — Migrate config paths: `~/.claude` → `~/.deepcode`

**Goal**: All config reads/writes target `~/.deepcode/`. On first launch, if `~/.deepcode/` doesn't exist but `~/.claude/` does, do a one-shot copy and emit a notice.

**Pre-conditions**: P1.3 merged.

**Branch**: `migrate/config-paths`

**Files**:
- `src/utils/getClaudeConfigHomeDir` (rename + rewrite) → `src/utils/getDeepCodeConfigHomeDir`
- All callers of `getClaudeConfigHomeDir` (~30+ sites)
- New file `src/bootstrap/migrateConfigDir.ts` that runs the one-shot

**Operations**:

1. Rename the function:
   ```ts
   // before:
   export function getClaudeConfigHomeDir(): string {
     return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
   }
   // after:
   export function getDeepCodeConfigHomeDir(): string {
     return process.env.DEEPCODE_CONFIG_DIR ?? join(homedir(), '.deepcode')
   }
   ```
2. Add `migrateConfigDir.ts`:
   ```ts
   export async function migrateConfigDirIfNeeded(): Promise<void> {
     const target = getDeepCodeConfigHomeDir();
     const legacy = join(homedir(), '.claude');
     if (existsSync(target)) return;
     if (!existsSync(legacy)) return;
     // copy entire dir
     await cp(legacy, target, { recursive: true });
     console.error(chalk.dim(`Migrated config from ${legacy} → ${target} (legacy directory left intact for safety)`));
   }
   ```
3. Call `migrateConfigDirIfNeeded()` once at startup, BEFORE any config read (in `src/main.tsx` near `eagerLoadSettings_start`).
4. Update all 30+ call sites of the renamed function (Codex: use grep + sed).
5. Add test: `test/p1-4-config-migration.test.mjs`:
   - Setup: create temp HOME with mock `.claude/config.json`.
   - Run: `migrateConfigDirIfNeeded()`.
   - Assert: `.deepcode/config.json` exists with same content. `.claude/` still exists (we don't delete legacy).
6. Add test for `DEEPCODE_CONFIG_DIR` env var override.

**Acceptance**:
- `getClaudeConfigHomeDir` no longer exists in src/.
- `process.env.CLAUDE_CONFIG_DIR` is no longer read.
- New `test/p1-4-config-migration.test.mjs` passes.
- All existing tests pass.

**Risk**:
- **medium**. Config dir is referenced everywhere. Missing one site means user data orphaned.
- Mitigation: regression test that lists every file in `audit/anthropic-imports.json` of category `config-path` and asserts none reference `.claude`.

---

### P1.5 — Migrate `CLAUDE.md` → `DEEPCODE.md`

**Goal**: Read both `DEEPCODE.md` and `CLAUDE.md` (DEEPCODE takes precedence; CLAUDE.md as fallback for one major version, with deprecation notice).

**Pre-conditions**: P1.4 merged.

**Branch**: `migrate/claude-md-to-deepcode-md`

**Files**:
- `src/utils/claudemd.ts` (rewrite)
- All callers (`src/interactiveHelpers.tsx`, system-prompt builders, etc.)

**Operations**:

1. Rewrite `claudemd.ts`:
   ```ts
   // Memory file lookup order, per directory:
   //   1. DEEPCODE.md (canonical)
   //   2. CLAUDE.md (deprecated; one-time warning per session)
   const MEMORY_FILENAMES = ['DEEPCODE.md', 'CLAUDE.md'] as const;
   ```
2. When `CLAUDE.md` is found and `DEEPCODE.md` is not, emit ONCE per session:
   `[deprecated] Found CLAUDE.md at <path>. Rename to DEEPCODE.md before next major release.`
3. Update import sites: `getExternalClaudeMdIncludes` → `getExternalDeepCodeMdIncludes`, `ClaudeMdExternalIncludesDialog` → `DeepCodeMdExternalIncludesDialog`. Update file names too.
4. Add tests:
   - DEEPCODE.md found → loaded, no warning
   - CLAUDE.md only → loaded with warning
   - Both exist → DEEPCODE.md wins, no warning

**Acceptance**:
- File `src/utils/claudemd.ts` is gone (renamed to `deepcodemd.ts`).
- Component `ClaudeMdExternalIncludesDialog.tsx` is gone (renamed).
- All references updated.
- Tests pass.

---

### P1.6 — Remove `CLAUDE_CODE_*` env-var legacy reads

**Goal**: Phase 5 (S3) added DEEPCODE_* aliases that take precedence over CLAUDE_CODE_*. Now remove the CLAUDE_CODE_* reads entirely.

**Pre-conditions**: P1.4, P1.5 merged.

**Branch**: `excise/claude-code-env`

**Files**:
- `src/utils/branchedEnv.mjs` (the helper)
- All call sites (~30+)

**Operations**:

1. Update `readBranchedEnv*` helpers to take ONLY a single env var name (not an array of fallbacks):
   ```ts
   export function readEnvInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number { ... }
   ```
2. Update call sites to pass only the `DEEPCODE_*` name. Drop the legacy `CLAUDE_CODE_*` array entry.
3. Audit special cases: `CLAUDE_CODE_ACCESSIBILITY` is read directly in some places (not via the helper). Those become `DEEPCODE_ACCESSIBILITY`.
4. Update `audit/anthropic-imports.json` to remove resolved entries.
5. Add a test that asserts `CLAUDE_CODE_*` reads do not exist:
   ```js
   test('no CLAUDE_CODE_* env reads remain', () => {
     // grep src/ for `process.env.CLAUDE_CODE_` — must be 0
   })
   ```

**Acceptance**:
- The new test passes.
- `grep -r "process.env.CLAUDE_CODE_" src/` returns 0.
- All existing tests pass.
- Existing user docs (CLAUDE.md / settings.json with `env: {CLAUDE_CODE_FOO: ...}`) **stop working** — this is acceptable as a major-version migration.

---

### P1.7 — Replace voice STT (`voiceStreamSTT.ts`)

**Goal**: Anthropic's voice_stream endpoint goes away. Replace with Whisper.cpp local + optional Deepgram cloud.

**Pre-conditions**: P1.3 merged.

**Branch**: `feature/whisper-stt`

**Files**:
- `src/services/voiceStreamSTT.ts` (rewrite)
- New: `src/services/stt/` (directory) with `whisperLocal.mjs`, `deepgramCloud.mjs`, `index.mjs`

**Operations**:

1. Create the new directory structure:
   ```
   src/services/stt/
     index.mjs        — STT facade with transport selection
     whisperLocal.mjs — spawn whisper.cpp binary, stream PCM in, get transcript
     deepgramCloud.mjs — Deepgram WebSocket client
     types.ts         — STTTransport interface
   ```
2. Define interface:
   ```ts
   interface STTTransport {
     start(audioStream: AsyncIterable<Buffer>, signal: AbortSignal): AsyncIterable<{ partial?: string; final?: string }>;
   }
   ```
3. Whisper local:
   - Detect `whisper.cpp` binary in PATH or `~/.deepcode/bin/whisper`.
   - If absent, prompt user to download (link to README install instructions).
   - Spawn with `--stdin --stream --model base.en` (model configurable).
4. Deepgram cloud:
   - Use existing `axios` or `node:fetch` for WebSocket upgrade.
   - API key from `DEEPGRAM_API_KEY` env var. Documented in DEEPCODE.md.
5. Update `src/hooks/useVoice.ts` to use `STTTransport` instead of importing `voiceStreamSTT.ts` directly.
6. Update settings UI to let user choose transport (`whisper-local` | `deepgram` | `disabled`).

**Acceptance**:
- `grep -r "voice_stream\|voiceStreamSTT\|conversation_engine" src/` returns 0.
- New tests cover the transport interface (mock audio stream → mock transcript).
- Voice mode either works with whisper-local (if installed) or shows a clean "STT not configured" message.

**Risk**:
- **medium-high**. Whisper.cpp install isn't bundled. Document fallback clearly.
- Mitigation: if neither transport is configured, voice mode is disabled with a clear setup hint, not a crash.

---

### P1.8 — Stub `@anthropic-ai/sdk` types (compile-time only)

**Goal**: Decouple from the SDK without rewriting every type import. Create local type stubs that mirror what we use, so source compiles without the dependency.

**Pre-conditions**: P0.1 inventory complete; P1.1–P1.7 merged.

**Branch**: `excise/anthropic-sdk-types`

**Files**:
- New: `src/types/external/anthropic-sdk-stubs.ts`
- All 140 importing files (path rewrite)

**Operations**:

1. Identify the actual symbols used (from P0.1):
   - Likely: `MessageStream`, `Tool`, `MessageParam`, `TextBlock`, `Usage`, `APIError`, `APIUserAbortError`, `Anthropic` (class), `BedrockClient`, `FoundryClient`, ...
2. Create `src/types/external/anthropic-sdk-stubs.ts`:
   ```ts
   // Local type stubs that match the shape of @anthropic-ai/sdk symbols we
   // historically used. The SDK is no longer a dependency. Runtime classes
   // (APIError, APIUserAbortError, Anthropic) are reimplemented in
   // src/services/api/errors.ts and src/services/providers/deepseek.mjs.
   export type MessageParam = { role: 'user' | 'assistant'; content: string | ContentBlock[] };
   // ... etc, sourced from grep of actual usage
   ```
3. Use a codemod (jscodeshift or sed) to rewrite imports:
   ```
   from '@anthropic-ai/sdk' → from 'src/types/external/anthropic-sdk-stubs'
   from '@anthropic-ai/sdk/resources/...' → from 'src/types/external/anthropic-sdk-stubs'
   ```
4. For runtime classes (`APIError`, `APIUserAbortError`, `Anthropic`), point to local implementations in `src/services/api/errors.ts` (which already exist post-P1.x for DeepSeek).
5. Build, fix any unresolved-symbol issue by adding to the stubs file.

**Acceptance**:
- `grep -r "from ['\"]@anthropic-ai" src/` returns 0.
- `bun run build:full-cli` succeeds without `@anthropic-ai/sdk` in `node_modules`.
- All tests pass.
- Bundle size delta documented in commit message.

**Risk**:
- **HIGH**. This is the surgery hour of Phase 1. Build will be broken for 30+ minutes during the migration. Use a feature branch and don't merge until green.
- Mitigation: do the codemod in a single commit on the branch, build, fix, commit fix, repeat.

---

### P1.9 — Drop `@anthropic-ai/sdk` from package.json

**Goal**: Remove the dependency declaration. Not strictly necessary for runtime (it was already optional via `optionalBarePackages` in the bundler), but seals the surface.

**Pre-conditions**: P1.8 merged. `node_modules/@anthropic-ai` no longer needed.

**Branch**: `excise/anthropic-sdk-package`

**Files**:
- `packages/deep-code/package.json`
- `packages/deep-code/scripts/build-full-cli.mjs` (`optionalBarePackages` and `optionalStaticStubs` lists)

**Operations**:

1. Remove `@anthropic-ai/*` entries from `optionalBarePackages` (they're no longer imported).
2. Remove `@anthropic-ai/*` entries from `optionalStaticStubs`.
3. Search the bundler script for any other Anthropic-specific stubs.
4. `bun run build:full-cli` to confirm the build still works.
5. `node dist/deepcode-full.mjs --version` to confirm the binary still runs.

**Acceptance**:
- `grep "@anthropic-ai" packages/deep-code/scripts/build-full-cli.mjs` returns 0.
- `grep "@anthropic-ai" packages/deep-code/package.json` returns 0.
- Build green, version output correct.

---

### P1.10 — Strip GrowthBook / Statsig surfaces

**Goal**: GrowthBook flags (`tengu_*`, `desktop_upsell`, etc.) and Statsig analytics are Anthropic-platform telemetry. Replace with a local config flag system + opt-in DeepCode telemetry (or just remove if no telemetry endpoint is operated).

**Pre-conditions**: Above merged.

**Branch**: `excise/growthbook-statsig`

**Files**:
- `src/services/analytics/growthbook.ts` (delete)
- `src/services/analytics/firstPartyEventLogger.ts` (delete or no-op)
- `src/services/analytics/index.ts` (rewrite — `logEvent` becomes a no-op or dispatches to local file logger)
- All `getDynamicConfig_CACHED_MAY_BE_STALE(...)` callers (~50+)

**Operations**:

1. Create `src/services/featureFlags.ts`:
   ```ts
   // Replaces GrowthBook. Reads from ~/.deepcode/feature-flags.json (user-editable).
   export function getFlag<T>(name: string, fallback: T): T { ... }
   ```
2. Codemod: replace `getDynamicConfig_CACHED_MAY_BE_STALE('tengu_X', defaultY)` with `getFlag('X', defaultY)` (drop `tengu_` prefix).
3. Document the new flag system in `DEEPCODE.md` (see Phase 5).
4. Rewrite `logEvent` to a no-op (no analytics endpoint) OR a local jsonl writer that users can `tail` for debugging.
5. Audit: every `tengu_*` event name should be removed or renamed.

**Acceptance**:
- `grep -r "tengu_\|growthbook\|statsig" src/` returns 0 (case-insensitive) or only inside `audit/` history.
- All tests pass.

**Risk**: medium. Some flags toggled features; their default may differ from runtime behavior.

---

### P1.11 — Cleanup pass: kill remaining `claude` / `Claude Code` strings (round 4)

**Goal**: After all the deletes, there should still be ~50 stragglers. Sweep them.

**Pre-conditions**: P1.1–P1.10 merged.

**Branch**: `cleanup/anthropic-strings-final`

**Operations**:

1. Run:
   ```bash
   grep -rEn "Claude Code|@anthropic|anthropic\.com|claude\.ai" packages/deep-code/src/ \
     | grep -v "^.*\.map:" \
     | grep -v "^.*//.*upstream" # comments documenting historical context are OK
   ```
2. For each remaining hit, decide:
   - User-visible? → rebrand to DeepCode
   - Internal comment about upstream Claude Code? → keep IF it documents non-trivial behavior; remove otherwise
   - URL to claude.com / anthropic.com → remove or replace with DeepSeek equivalent
3. Update `audit/anthropic-product-refs.md` to mark each item resolved.

**Acceptance**:
- The grep command returns ≤ 5 hits (only deeply-justified historical comments).
- All tests pass.

---

### P1.12 — Phase 1 sign-off PR

**Goal**: Single tracking PR (no code changes) with milestone summary.

**Branch**: `phase-1-complete`

**Operations**:

1. Update `TODO.md` — add a "Phase 1 — Anthropic Excision" section listing all P1.x commits.
2. Update `audit/README.md` to mark Phase 1 done.
3. Tag the merge commit `v0.2.0-pure`.

**Acceptance**:
- Tag `v0.2.0-pure` exists.
- TODO.md reflects new state.

---

# Phase 2 — Adopt DeepSeek-TUI Best-of-Breed Features

**Goal**: Close the feature gaps identified in `docs/COMPETITIVE_ANALYSIS.md` (DeepSeek-TUI's own audit). Implement the high-impact ones in priority order.

**Effort**: 3-4 weeks.

**Priority order** (by ROI):
1. Auto mode (router) — half day, high UX win
2. Multi-provider — 2-3 days, drives self-hosted adoption
3. Cache visualization — 3-5 days, DeepSeek killer feature
4. Workspace rollback — 1 week, safety net + competitive parity
5. Post-edit LSP diagnostics — 1-2 weeks, correctness multiplier
6. HTTP/SSE serve mode — 1 week, programmatic access
7. Session fork — 1 day, easy add
8. Doctor command — half day, polish
9. Workspace-local slash commands — 1 day, ecosystem

---

### P2.1 — Auto mode router

**Goal**: `--model auto` / `/model auto` runs a small `deepseek-v4-flash` routing call to pick model + thinking level for the real turn.

**Pre-conditions**: Phase 1 complete (clean DeepSeek API client).

**Branch**: `feature/auto-mode-router`

**Files**:
- New: `src/services/autoMode/router.ts`
- `src/services/providers/deepseek.mjs` (add lightweight router-call helper)
- `src/main.tsx` (CLI flag)
- `src/commands/model.tsx` or wherever `/model` is defined

**Operations**:

1. Define the router prompt:
   ```ts
   const ROUTER_SYSTEM = `You are a router. Given the user's latest message
   and a short context summary, output JSON: {"model":"flash"|"pro","thinking":"off"|"high"|"max"}.
   Use flash+off for short questions, pro+max for ambiguous multi-step coding tasks.
   No prose, only JSON.`;
   ```
2. Implement `routeTurn(messages, signal)`:
   - Single fetch to DeepSeek API with model `deepseek-v4-flash`, thinking `off`, temperature 0.
   - Parse JSON. On parse failure, fall back to local heuristic (length-based + keyword-based).
3. Wire into the turn loop: if `model === 'auto'`, call `routeTurn` before sending the real request. Use the router's choice.
4. Show the route decision in the TUI footer (e.g., `auto → pro/max`).
5. Sub-agents inherit auto unless explicitly assigned.
6. Add tests:
   - Mock the fetch, verify the right model gets the real call
   - Verify fallback heuristic when router fails

**Acceptance**:
- `deepcode --model auto "explain this"` works end-to-end.
- TUI footer shows `auto → flash/off` or similar.
- New tests `test/p2-1-auto-mode.test.mjs` pass.

---

### P2.2 — Multi-provider support

**Goal**: `--provider {deepseek,ollama,vllm,openai-compatible}` with their respective base URLs.

**Pre-conditions**: P2.1 merged.

**Branch**: `feature/multi-provider`

**Files**:
- `src/services/providers/` (already exists; add ollama.mjs, vllm.mjs, openaiCompatible.mjs)
- `src/services/providers/registry.mjs` — provider lookup by name
- `src/main.tsx` — `--provider` flag
- `src/cli/handlers/auth.ts` — per-provider key save

**Operations**:

1. Generalize the provider interface:
   ```ts
   interface Provider {
     id: 'deepseek' | 'ollama' | 'vllm' | 'openai-compatible';
     baseUrl: string;
     apiKey?: string; // optional for self-hosted
     models: string[]; // available models
     stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
   }
   ```
2. DeepSeek already exists; refactor it to fit.
3. Ollama: base URL `http://localhost:11434`, list models from `/api/tags`, no auth. Stream via `/api/chat`.
4. vLLM: same OpenAI-compatible shape, base URL configurable, no streaming differences.
5. OpenAI-compatible (generic): user provides base URL + key + model.
6. Update `auth set --provider X` to store per-provider keys in `~/.deepcode/config.json`.
7. Add `deepcode models` to list models from the active provider.
8. Tests: each provider's stream parser, model listing, error handling (401, 404, network).

**Acceptance**:
- `deepcode --provider ollama --model deepseek-coder:1.3b "hi"` works against a local Ollama instance.
- `deepcode auth set --provider ollama` no-ops (no key needed).
- New `test/p2-2-providers.test.mjs` passes.

---

### P2.3 — Cache visualization (`/cache inspect`, status-bar hit% chip)

**Goal**: Show DeepSeek prefix-cache hit rate in real time. Major DeepSeek-specific value-add.

**Pre-conditions**: P2.2 merged.

**Branch**: `feature/cache-visualization`

**Files**:
- `src/cache/deepseek-cache.mjs` (already exists; extend)
- `src/components/CacheStatusChip.tsx` (new)
- `src/commands/cache.tsx` (new — `/cache inspect`, `/cache warmup`, `/cache clear`)
- `src/services/providers/deepseek.mjs` (parse cache hit info from API response)

**Operations**:

1. Parse the DeepSeek API response's `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` (DeepSeek-specific fields).
2. Track per-turn + session totals in a small store.
3. Render a status-bar chip: `cache: 87% hit (12.3k / 14.1k)`.
4. `/cache inspect` opens a dialog showing:
   - Per-turn hit/miss for last 10 turns
   - Total session $ saved by cache
   - Layered prompt classification (static / history / dynamic) with SHA-256 hashes
5. `/cache warmup` — send a no-op turn that primes the cache for the current static prefix.
6. `/cache clear` — clear our local cache hash store (does NOT clear DeepSeek-side cache, which is automatic).
7. Tests: parse a known DeepSeek API response, assert the chip text is correct.

**Acceptance**:
- TUI footer shows a cache hit% chip after the first turn.
- `/cache inspect` opens a working dialog.
- Tests pass.

---

### P2.4 — Workspace rollback (side-git snapshots)

**Goal**: Before each turn, snapshot the workspace into a side `.git` directory. `/restore` rolls back to last snapshot. `revert_turn` tool lets the model self-revert.

**Pre-conditions**: P2.3 merged.

**Branch**: `feature/workspace-rollback`

**Files**:
- `src/services/snapshot/` (new directory)
- `src/commands/restore.tsx` (new)
- `src/tools/RevertTurnTool/` (new)
- `src/services/snapshot/diskCap.ts` (500MB hard limit, prune oldest)

**Operations**:

1. Side-git path: `~/.deepcode/snapshots/<workspace-hash>/.git`.
2. On turn start: `git --work-tree=<workspace> --git-dir=<side-git> add -A && commit -m "turn-<id>-pre"`.
3. On turn end: same with `-post` suffix.
4. `/restore` command:
   - Show last 10 snapshots
   - User picks one
   - `git --git-dir=<side> --work-tree=<workspace> checkout <snapshot> -- .`
5. `revert_turn` tool:
   - Model can call this with `{turn_id: number}` to undo a previous turn's changes.
6. Disk cap: total side-git size < 500MB. Prune oldest snapshots when over.
7. Never touch the user's `.git`. Use a separate `--git-dir` so workspace stays clean.
8. Tests:
   - Make a change, snapshot, restore — verify file content
   - Hit the 500MB cap with mock files, verify prune happens
   - Concurrent turn protection (lock file)

**Acceptance**:
- `/restore` works end-to-end.
- Disk cap enforced.
- User's `git status` shows their actual changes (not snapshot artifacts).
- Tests pass.

**Risk**:
- **medium-high**. File operations during turn can race. Use a queue.
- Mitigation: explicit lock file in side-git directory.

---

### P2.5 — Post-edit LSP diagnostics

**Goal**: After every successful `edit_file` / `write_file` / `apply_patch`, query the appropriate LSP for diagnostics, inject errors into the model's next turn context.

**Pre-conditions**: P2.4 merged.

**Branch**: `feature/lsp-post-edit-diagnostics`

**Files**:
- `src/services/lsp/` (new)
  - `client.ts` — JSON-RPC stdio LSP client
  - `registry.ts` — language → server map
  - `index.ts` — facade
- `src/tools/EditFileTool/` (existing — add post-edit hook)
- `src/tools/WriteFileTool/` (existing — same)

**Operations**:

1. Implement minimal LSP client (Content-Length framing, JSON-RPC, didOpen/didChange/publishDiagnostics).
2. Server registry:
   ```ts
   const SERVERS = {
     '.rs': 'rust-analyzer',
     '.go': ['gopls', 'serve'],
     '.py': ['pyright-langserver', '--stdio'],
     '.ts': ['typescript-language-server', '--stdio'],
     '.tsx': ['typescript-language-server', '--stdio'],
     '.c': 'clangd',
     '.cpp': 'clangd',
   };
   ```
3. Lazy-spawn server per language on first edit.
4. After successful edit tool: send `didChange`, wait `poll_after_edit_ms` (default 500ms, configurable), grab `publishDiagnostics`.
5. Format errors into a synthetic system message: `LSP diagnostics for <file>: <list>`.
6. Inject before next turn's user message.
7. Configurable: `[lsp]` section in settings.json (`enabled`, `poll_after_edit_ms`, `max_diagnostics_per_file`, `include_warnings`, per-language overrides).
8. Non-blocking: missing binary / crash / timeout = no diagnostics this turn (silent degrade).
9. Tests:
   - Mock LSP server with `FakeTransport`, verify diagnostics injected
   - Missing binary → no crash
   - Per-language enable/disable

**Acceptance**:
- After editing a TypeScript file with a deliberate type error, the model sees the error in its next turn context.
- Configurable enable/disable works.
- New tests pass.

---

### P2.6 — HTTP/SSE serve mode

**Goal**: `deepcode serve --http` exposes the agent as an HTTP API for headless workflows.

**Pre-conditions**: P2.5 merged.

**Branch**: `feature/serve-http`

**Files**:
- `src/cli/serve/http.ts` (new)
- `src/cli/serve/index.ts` (entry — also stubs `--acp` for future)

**Operations**:

1. HTTP server with these endpoints:
   - `POST /sessions` — create a session, returns `{session_id}`
   - `POST /sessions/:id/turns` — submit a prompt, returns SSE stream of events
   - `GET /sessions/:id` — session status
   - `GET /sessions/:id/turns/:turn_id` — turn status
   - `DELETE /sessions/:id` — cancel
2. Auth: Bearer token from `DEEPCODE_HTTP_TOKEN` env var. 401 if missing.
3. Default bind: `127.0.0.1:8765` (configurable).
4. SSE event shape: same as our internal event bus (text deltas, tool calls, tool results).
5. Tests:
   - Start server, POST a turn, assert SSE stream
   - Auth 401 path
   - Cancel mid-stream

**Acceptance**:
- `deepcode serve --http` starts a server.
- `curl -N -H "Authorization: Bearer X" -d '{"prompt":"hi"}' http://localhost:8765/sessions/<id>/turns` works.
- New tests pass.

---

### P2.7 — Session fork

**Goal**: `deepcode fork <session-id>` lets users branch a session at a chosen turn.

**Pre-conditions**: P2.6 merged.

**Branch**: `feature/session-fork`

**Files**:
- `src/cli/handlers/session.ts` (existing; add fork handler)
- `src/services/conversationRecovery/` (existing; add fork logic)

**Operations**:

1. New CLI: `deepcode fork <session-id> [--at-turn N]`. Default: last turn.
2. Implementation: copy session jsonl up to turn N into a new session id, save.
3. Update session list UI to show fork relationships (parent → child).
4. Tests: fork at turn 5 of a 10-turn session, verify the new session has 5 turns.

**Acceptance**:
- `deepcode fork <id> --at-turn 3` creates a new session.
- Original session unchanged.
- Tests pass.

---

### P2.8 — Doctor command

**Goal**: `deepcode doctor` checks API key, network, model availability, LSP servers, etc. With `--json` for machine-readable output.

**Pre-conditions**: P2.7 merged.

**Branch**: `feature/doctor`

**Files**:
- `src/commands/doctor.tsx` (existing; expand)
- `src/cli/handlers/doctor.ts` (new — non-interactive `--json` path)

**Operations**:

1. Diagnostics to run:
   - DeepSeek API key present? Source (env / config / keyring)?
   - Network reachable? Time-to-first-token from a tiny model call?
   - Models endpoint returns expected models?
   - LSP servers detected for installed languages?
   - Whisper.cpp binary detected?
   - Side-git snapshot directory writable?
   - Disk cap usage < 80%?
2. Output: pretty TUI in interactive mode, JSON with `--json`.
3. Exit code 0 = all green, 1 = warnings, 2 = errors.

**Acceptance**:
- `deepcode doctor` opens a TUI report.
- `deepcode doctor --json` outputs valid JSON.
- Exit codes correct.

---

### P2.9 — Workspace-local slash commands

**Goal**: `.deepcode/commands/foo.md` in any project → `/foo` works there.

**Pre-conditions**: P2.8 merged.

**Branch**: `feature/workspace-slash-commands`

**Files**:
- `src/commands/workspaceSlashLoader.ts` (new)
- `src/screens/REPL.tsx` (slash autocomplete integration)

**Operations**:

1. On REPL load, scan:
   - `<workspace>/.deepcode/commands/*.md`
   - `<workspace>/.cursor/commands/*.md` (compatibility)
   - `<workspace>/.claude/commands/*.md` (legacy compatibility, deprecation warning)
2. Each markdown file's filename (sans extension) becomes the command name.
3. File body becomes the prompt template; `$ARGUMENTS` placeholder substitutes.
4. Project-local shadows global by name.
5. Tests:
   - Drop a `.deepcode/commands/foo.md`, verify `/foo` appears in autocomplete and runs

**Acceptance**:
- New tests pass.
- Demo: a `.deepcode/commands/test.md` works in a fresh project.

---

### P2.10 — i18n (en, zh-Hans, ja minimum)

**Goal**: Match DeepSeek-TUI's locale support.

**Pre-conditions**: P2.9 merged.

**Branch**: `feature/i18n`

**Files**:
- `src/i18n/` (new)
  - `index.ts` — `t(key, params)` function
  - `locales/en.json`
  - `locales/zh-Hans.json`
  - `locales/ja.json`
- All UI components — replace literal strings with `t(...)` calls

**Operations**:

1. Choose i18n strategy: simple key-based, no fancy plurals (DeepSeek-TUI uses Fluent; we keep it simple).
2. Locale detection: `LC_ALL` / `LANG` env, settings.json `locale` key, `--locale` CLI flag.
3. The latest user message still wins for natural-language reasoning (don't force model output language; only UI chrome).
4. Codemod: for top 50 user-visible strings (welcome, common errors, dialog titles, status bar), wrap in `t(...)`.
5. Tests: `t('welcome', { name: 'Alice' })` returns correct string per locale.

**Acceptance**:
- `LANG=zh_CN.UTF-8 deepcode` shows Chinese chrome.
- `--locale ja` overrides.
- Top 50 strings localized.
- Tests pass.

---

### P2.11 — Phase 2 sign-off

**Branch**: `phase-2-complete`

**Operations**:
1. Update TODO.md.
2. Tag `v0.3.0-feature-parity`.

---

# Phase 3 — Distribution

**Goal**: Public, installable artifact. Real users.

**Effort**: 1 week.

---

### P3.1 — Public npm package

**Pre-conditions**: Phase 2 complete.

**Branch**: `dist/npm-publish`

**Files**:
- `packages/deep-code/package.json` (`"private": false`, public org)
- `.github/workflows/release.yml` (new)

**Operations**:

1. Decide org: `@deepcode-ai/deep-code` (already chosen) — confirm npm org owned.
2. Add release workflow that publishes on git tag `v*`.
3. Use `npm publish --access public --provenance` for SLSA provenance.
4. Auto-bump version via Changesets or manual.
5. Add `npm pack` test to CI to catch packaging issues.

**Acceptance**:
- `npm publish --dry-run` succeeds.
- Release workflow file exists and is valid.

---

### P3.2 — Docker image

**Branch**: `dist/docker`

**Operations**:

1. `Dockerfile`:
   ```dockerfile
   FROM node:22-slim
   COPY packages/deep-code /app
   WORKDIR /app
   RUN bun install --production
   ENTRYPOINT ["node", "dist/deepcode-full.mjs"]
   ```
2. Multi-arch build: linux/amd64 + linux/arm64.
3. Publish to GHCR on tag.
4. README install section: `docker run -e DEEPSEEK_API_KEY ghcr.io/<org>/deepcode:latest`.

**Acceptance**:
- `docker build .` succeeds.
- `docker run` produces a working session.

---

### P3.3 — Prebuilt binary releases (optional)

**Goal**: Use `pkg` or `bun build --compile` to produce single-file binaries for Linux/macOS/Windows.

**Branch**: `dist/binaries`

**Operations**:

1. `bun build --compile --target=bun-linux-x64 --outfile=deepcode-linux-x64 dist/deepcode-full.mjs`
2. Same for `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`.
3. Upload to GitHub Releases on tag.

**Acceptance**:
- Releases page has 5 binary artifacts.

---

### P3.4 — Phase 3 sign-off

Tag `v0.4.0-distributed`.

---

# Phase 4 — Differentiation Polish

**Goal**: Lean into our moat — Voice + IDE + TUI quality.

**Effort**: 1-2 weeks.

---

### P4.1 — Voice mode end-to-end loop

**Goal**: Voice → STT → text → DeepSeek → text-to-speech → audio playback. Full hands-free.

**Branch**: `feature/voice-loop`

**Operations**:

1. Add TTS via system voices (`say` on macOS, `espeak` on Linux, SAPI on Windows) or Deepgram TTS cloud (opt-in).
2. Settings: `[voice] tts_enabled`, `[voice] tts_voice`.
3. Streaming: as DeepSeek tokens arrive, accumulate sentences, send to TTS with low latency.
4. Mute hotkey: `Ctrl+M` toggles audio.

**Acceptance**:
- Full conversation works hands-free.
- Mute toggle works mid-utterance.

---

### P4.2 — IDE deep integration (VSCode extension)

**Goal**: Bidirectional VSCode extension. Editor sees DeepCode's edits live; user can drive DeepCode from editor commands.

**Branch**: `feature/vscode-extension`

**Operations**:

1. New `extensions/vscode/` directory at repo root.
2. Extension exposes: command palette entries, status bar, diff view integration.
3. Communication: HTTP serve mode (P2.6) on a unix socket.
4. Publish to VS Code Marketplace.

**Acceptance**:
- Install extension, run a turn from VS Code, see live diff in editor.

---

### P4.3 — TUI animation + theming

**Goal**: Configurable themes (dark / light / high-contrast) + animation library polish.

**Branch**: `feature/themes`

**Operations**:

1. Theme definitions in `src/themes/<name>.json`.
2. `/theme list`, `/theme set <name>` commands.
3. Hot-reload (no restart needed).

**Acceptance**:
- 3 themes ship.
- Hot-reload works.

---

### P4.4 — Phase 4 sign-off

Tag `v0.5.0-polish`.

---

# Phase 5 — Documentation Overhaul

**Goal**: Replace TODO.md with proper docs. Match DeepSeek-TUI's coverage.

**Effort**: 3-5 days.

---

### P5.1 — `docs/ARCHITECTURE.md`

**Branch**: `docs/architecture`

**Content**:
- Module layout (single-package / no Rust crates split, but document the logical layers)
- Render pipeline (Ink → Yoga → terminal)
- Engine loop (turn lifecycle, tool execution, streaming)
- Provider abstraction
- LSP / snapshot / cache subsystems
- Diagrams (ASCII or Mermaid)

---

### P5.2 — `docs/INSTALL.md`

**Branch**: `docs/install`

**Content**:
- npm install
- Docker
- Binaries
- From source
- Per-platform notes (macOS, Linux, Windows, WSL)
- Voice mode dependencies (Whisper.cpp install)

---

### P5.3 — `docs/CONFIGURATION.md`

**Branch**: `docs/configuration`

**Content**:
- All `~/.deepcode/config.json` keys
- All `DEEPCODE_*` env vars
- Per-project `.deepcode/config.json` overlay
- Provider configs

---

### P5.4 — `docs/MIGRATION.md` (Claude Code → DeepCode)

**Branch**: `docs/migration`

**Content**:
- For users coming from Claude Code: how to migrate
  - `~/.claude/` → `~/.deepcode/` (auto)
  - `CLAUDE.md` → `DEEPCODE.md` (rename when ready)
  - `.claude/commands/` still readable, prefer `.deepcode/commands/`
  - Removed features (chrome, ultraplan, bridge) — explanation
  - DeepSeek API key vs Anthropic API key

---

### P5.5 — `docs/TOOL_SURFACE.md`, `docs/MODES.md`, `docs/KEYBINDINGS.md`, `docs/MCP.md`

Match DeepSeek-TUI's doc structure.

---

### P5.6 — Update README.md

**Branch**: `docs/readme`

**Content**:
- Top-level pitch (DeepSeek-native, full-multimodal, Ink TUI quality)
- Comparison table vs DeepSeek-TUI (honest, our wins + losses)
- Install one-liners
- Quickstart
- Links to docs

---

# Appendix A — Codex Operational Cheatsheet

When in doubt, follow this default loop:

```bash
# 1. Pick a task. Read its section in this file.
# 2. Confirm pre-conditions:
git status                    # clean tree
git log --oneline -3          # know where you are
gh pr list --state open       # no conflicting PRs

# 3. Branch:
git checkout -b <task-branch>

# 4. Execute Operations.

# 5. Build:
cd packages/deep-code
bun run build:full-cli

# 6. Test gauntlet:
node --test test/<all 13 test files listed in plan>
bun test test/tui-deepseek.test.mjs

# 7. Self-codex-review:
# (use codex:rescue agent, prompt with "review the diff at <branch>")

# 8. Commit:
git add ...
git commit -m "<phase>: <summary> (<task-id>)"

# 9. Push + PR:
git push -u origin <task-branch>
gh pr create --base main ...

# 10. Wait for CI green:
until ! gh pr checks <num> 2>&1 | grep -qE 'pending|in.progress'; do sleep 15; done
gh pr checks <num>

# 11. Squash merge:
gh pr merge <num> --squash --delete-branch

# 12. Sync local main:
git checkout main && git pull origin main
git branch -d <task-branch>

# 13. Report back to human reviewer.
```

# Appendix B — When to Stop and Ask

Stop and ask the human reviewer if any of:

- Pre-conditions don't hold (a prior task was supposed to be merged but isn't).
- Build is broken in a way that requires architectural decisions (e.g., `@anthropic-ai/sdk` removal exposes a use case the plan didn't anticipate).
- Tests fail in unexpected ways (>5 unrelated tests broken by your change).
- A task's `Operations` are ambiguous about a specific file.
- You discover a feature dependency the plan missed (e.g., a tool secretly relies on `claude.ai`).
- A PR's CI fails for infrastructure reasons (not your code).
- You're about to do a destructive remote operation (force push, delete branch with unmerged work, drop a database).

DO NOT ASK for permission to:
- Run tests
- Run the build
- Open a PR (after CI green and self-review passes)
- Squash-merge a PR you opened (after CI green)
- Delete a merged feature branch

# Appendix C — Definition of Done

The pure-blood DeepSeek migration is **done** when:

- [ ] `grep -r "@anthropic-ai" packages/deep-code/src/` returns 0
- [ ] `grep -ri "claude.ai\|anthropic.com\|console.anthropic" packages/deep-code/src/` returns ≤ 5 hits (only in deeply-justified historical comments)
- [ ] `grep -r "Claude Code" packages/deep-code/src/` returns 0 outside of `audit/` history files
- [ ] `find packages/deep-code/src/bridge packages/deep-code/src/commands/{bridge,btw,chrome,desktop,ultraplan*} packages/deep-code/src/components/{Teleport*,DesktopUpsell*,ClaudeInChrome*,ConsoleOAuth*}` returns 0 results
- [ ] `process.env.CLAUDE_CODE_*` is read in 0 places
- [ ] `~/.claude/` is read in 0 places (only the migration helper)
- [ ] `CLAUDE.md` is read in 0 places (only as legacy fallback in the memory-file lookup, with a one-line deprecation)
- [ ] All 240 baseline tests pass + new feature tests pass
- [ ] Bundle size: < 110% of pre-Phase-1 baseline (we expect to shrink, not grow, after removing SDK)
- [ ] Cold-start time: ≤ pre-Phase-1 (no regressions from new features when not used)
- [ ] `deepcode doctor` reports all green on a fresh setup
- [ ] `npm install -g @deepcode-ai/deep-code && deepcode --version` works from a clean machine
- [ ] DeepSeek-TUI feature parity table (in `docs/COMPETITIVE.md`) shows ≥ 70% match + ≥ 3 unique advantages
- [ ] README.md positions DeepCode without ever mentioning Claude / Anthropic except in the migration guide
