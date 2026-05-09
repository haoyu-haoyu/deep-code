# DeepCode Sandbox — Codex Execution Plan

**Product name**: DeepCode Sandbox (positioning: "a DeepSeek-native sandbox layer for the DeepCode terminal coding agent")
**Package name**: `@deepcode-ai/sandbox` (workspace package inside the deep-code repo)
**Architectural label**: "Sandbox Fortress" — 5-layer extension architecture
**Mission**: Build an originally-architected sandbox product on top of the industry-best primitives (`@anthropic-ai/sandbox-runtime`'s 9 red-team-hardened defenses + OS-native sandbox APIs), specifically tuned for DeepSeek's reasoning-effort tiers, prefix-cache pricing model, and 1M-context workflows. Self-use, no public-release requirements.

**Target executor**: Codex CLI via `codex:rescue` agent.
**Pre-condition**: PURE_DEEPSEEK_PLAN.md Phase 0 (audit) is complete or in progress; this plan can run in parallel with Phase 1 excisions.
**Repo root**: `/Users/wanghaoyu/Downloads/deepcode源码`
**Current main**: `cfef929` or later.

---

## How to Read This File

Identical conventions to PURE_DEEPSEEK_PLAN.md — task ID, Goal/Pre-conditions/Files/Operations/Acceptance/Risk per task, 13-step Codex workflow per task. See PURE_DEEPSEEK_PLAN.md "Codex Execution Protocol" for the canonical reference.

**Naming convention**:
- Identifier: `Fortress` (in code/types/comments)
- Product name in user-visible strings: `DeepCode Sandbox`
- Package name: `@deepcode-ai/sandbox`
- Directory: `packages/deep-code/src/sandbox-fortress/`

**Critical gotchas before starting any task**:
- `@anthropic-ai/sandbox-runtime` package has NO public source/license (closed source, "© Anthropic All rights reserved"). We treat it as a pure library — call its public API only, never copy or vendor source code.
- Our existing `sandbox-adapter.ts` (985 lines, in `packages/deep-code/src/utils/sandbox/`) is **the single chokepoint** — every other file in the codebase imports from this adapter, never from `@anthropic-ai/sandbox-runtime` directly. Our Fortress hooks here.
- `Shell.ts:260` (~1 call site) is the only external `wrapWithSandbox()` invocation point.

---

## Architectural Overview

```
╔══════════════════════════════════════════════════════════════════╗
║   @deepcode-ai/sandbox  (DeepCode Sandbox = our original product)║
║                                                                  ║
║   Layer 5: DeepSeek-Native ✨ (F4)                               ║
║   Layer 4: Observability ✨ (F3)                                 ║
║   Layer 3: 4-Layer Rule Engine (F2)                              ║
║   Layer 2: Hardened Adapter (F1)  ← evolves from sandbox-adapter ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
                              ↓ uses as library
┌────────────────────────────────────────────────────────────────┐
│  @anthropic-ai/sandbox-runtime (untouched, library)            │
│   • macOS Seatbelt                                             │
│   • Linux bwrap+landlock+seccomp                               │
│   • HTTP/SOCKS proxy lifecycle                                 │
│   • 9 red-team-hardened defenses                              │
└────────────────────────────────────────────────────────────────┘
```

**Layer purpose summary**:
- **Layer 5 (DeepSeek-Native)**: features only DeepSeek users need. Reasoning-effort coupling, violation→context feedback, cache-aware policy serialization, auto-learn from approvals.
- **Layer 4 (Observability)**: SQLite violation persistence, /sandbox stats/map/dry-run/replay commands, cost telemetry.
- **Layer 3 (Rule Engine)**: 4-layer ruleset (BuiltinDefault < Org < Agent < User), typed PermissionProfile inspired by Codex CLI, yaml config schema.
- **Layer 2 (Hardened Adapter)**: per-tool sandbox profiles (Bash/FileEdit/FileRead/WebFetch each get tailored restrictions), evolves the existing 985-line adapter.
- **Layer 1 (untouched)**: `@anthropic-ai/sandbox-runtime` continues to do all OS-level work. Treated as a black-box library.

---

## Phase Overview & Effort

```
F0. Foundation                          (3 d)  ─ project skeleton + naming + tests harness
F1. Layer 2 — Hardened Adapter          (1 wk) ─ migrate adapter, per-tool profiles
F2. Layer 3 — 4-Layer Rule Engine       (2 wk) ─ ruleset model, yaml, conflict resolution
F3. Layer 4 — Observability             (2 wk) ─ SQLite + commands + dry-run + replay
F4. Layer 5 — DeepSeek-Native           (2 wk) ─ effort coupling + feedback + cache + auto-learn
F5. Polish + Cutover                    (1 wk) ─ docs, benchmarks, redteam, switch ISandboxManager binding
```

Total: **~8 weeks of focused engineering** (vs 11 weeks for full rewrite). 28 task IDs (F0.1–F5.5).

---

# Phase F0 — Foundation (3 days)

**Goal**: Establish the workspace structure, public API contract, test harness, and naming conventions before writing functional code. Ensures everything below builds on a stable foundation.

**Effort**: 3 days.

---

### F0.1 — Workspace skeleton + types

**Goal**: Create the `sandbox-fortress` directory tree with empty stub files, public types, and a minimal `IFortressSandboxManager` interface that extends the existing `ISandboxManager`.

**Branch**: `fortress/f0-1-skeleton`

**Files** (all new):
- `packages/deep-code/src/sandbox-fortress/index.ts` — public exports
- `packages/deep-code/src/sandbox-fortress/types.ts` — type definitions
- `packages/deep-code/src/sandbox-fortress/manager.ts` — placeholder for FortressSandboxManager class
- `packages/deep-code/src/sandbox-fortress/README.md` — architecture overview
- `packages/deep-code/src/sandbox-fortress/.gitkeep` — for empty subdirs (rule-engine/, observability/, deepseek/, adapter/)

**Operations**:
1. Create directory structure:
   ```
   packages/deep-code/src/sandbox-fortress/
     index.ts
     manager.ts
     types.ts
     README.md
     adapter/        (empty, for F1)
     rule-engine/    (empty, for F2)
     observability/  (empty, for F3)
     deepseek/       (empty, for F4)
   ```

2. `types.ts` defines:
   ```ts
   import type {
     SandboxRuntimeConfig,
     SandboxViolationEvent,
     SandboxAskCallback,
     SandboxDependencyCheck,
     // ... all types we need
   } from '@anthropic-ai/sandbox-runtime'

   export type RulesetLayer = 'builtin-default' | 'org' | 'agent' | 'user'

   export type ResourceKind = 'fs-read' | 'fs-write' | 'net-host' | 'process-exec'

   export type RuleAction = 'allow' | 'deny' | 'ask'

   export interface FortressRule {
     layer: RulesetLayer
     resource: ResourceKind
     pattern: string
     action: RuleAction
     metadata?: {
       reason?: string
       expiresAt?: number  // unix ms
       sourceFile?: string
       sourceLine?: number
     }
   }

   export interface FortressRuleset {
     layer: RulesetLayer
     rules: FortressRule[]
   }

   export type EffortLevel = 'off' | 'high' | 'max'

   export type StrictnessLevel = 'lenient' | 'standard' | 'paranoid'

   export interface ToolSandboxProfile {
     toolName: string
     fileSystemMode: 'read-only' | 'workspace-write' | 'no-fs'
     networkMode: 'allow' | 'deny' | 'allow-with-restrictions'
     additionalDenyPatterns?: string[]
     additionalAllowPatterns?: string[]
   }

   // ... etc
   ```

3. `manager.ts` defines:
   ```ts
   import type { ISandboxManager } from '../utils/sandbox/sandbox-adapter.js'
   import type {
     FortressRule, RulesetLayer, EffortLevel, StrictnessLevel,
     ToolSandboxProfile,
   } from './types.js'

   export interface IFortressSandboxManager extends ISandboxManager {
     // F2 — 4-layer rule engine
     getRulesetByLayer(layer: RulesetLayer): Promise<FortressRuleset>
     setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void>
     resolveEffectiveRules(): Promise<FortressRule[]>

     // F3 — Observability
     enableDryRunMode(enabled: boolean): void
     isDryRunMode(): boolean
     getViolationDb(): IFortressViolationDb

     // F4 — DeepSeek native
     setEffortLevel(effort: EffortLevel): Promise<void>
     getCurrentEffort(): EffortLevel
     setStrictnessByEffort(mapping: Record<EffortLevel, StrictnessLevel>): Promise<void>
     buildViolationFeedback(): string | null
     buildCacheFriendlyConfigSummary(): { static: string, dynamic: string }

     // F1 — Per-tool profiles
     getProfileForTool(toolName: string): ToolSandboxProfile
     setProfileForTool(toolName: string, profile: ToolSandboxProfile): void
   }

   // Placeholder export
   export class FortressSandboxManager implements IFortressSandboxManager {
     // ... all methods throw 'not implemented' for now
   }
   ```

4. `README.md` documents the 5-layer architecture with the diagram from this plan.

5. `index.ts` re-exports public API:
   ```ts
   export { FortressSandboxManager } from './manager.js'
   export type * from './types.js'
   ```

**Acceptance**:
- `tsc --noEmit` passes for all new files
- No new runtime imports from `@anthropic-ai/sandbox-runtime` outside of `types.ts` (re-exports only)
- README.md renders correctly in GitHub UI

**Risk**: 0 — pure scaffolding.

---

### F0.2 — Test harness + benchmark scaffolding

**Goal**: Set up test directory structure + benchmark scaffolding before any functional code. TDD foundation.

**Branch**: `fortress/f0-2-test-harness`

**Files**:
- `packages/deep-code/test/sandbox-fortress/` (new directory)
  - `harness.mjs` — shared test utilities (mock SandboxManager, fixture commands, etc.)
  - `redteam/.gitkeep`
  - `unit/.gitkeep`
  - `integration/.gitkeep`
  - `bench/.gitkeep`
- `packages/deep-code/bench/sandbox-fortress.bench.mjs` — benchmark suite (can be empty initially)

**Operations**:
1. Test harness exposes:
   ```js
   export function createMockBaseSandboxManager() { ... }
   export function fixture(name) { ... }   // load fixture
   export async function spawnTestCommand(cmd, sandboxConfig) { ... }
   export function expectViolation(violation, matchers) { ... }
   ```

2. CI workflow updated to include new test glob:
   ```yaml
   node --test \
     test/sandbox-fortress/unit/*.test.mjs \
     test/sandbox-fortress/integration/*.test.mjs \
     test/sandbox-fortress/redteam/*.test.mjs
   ```
   (Append to `.github/workflows/ci.yml`)

3. Benchmark scaffolding placeholder.

**Acceptance**:
- `node --test test/sandbox-fortress/` runs and exits 0 (zero tests yet, but no errors)
- CI workflow includes new path globs

**Risk**: 0.

---

### F0.3 — Public API contract docs

**Goal**: Write down the public API of `IFortressSandboxManager` as a stable contract. Codex tasks below cite this.

**Branch**: `fortress/f0-3-api-contract`

**Files**:
- `docs/sandbox-fortress/API_CONTRACT.md` — full method signatures with TSDoc

**Operations**:
1. Document every method of `IFortressSandboxManager` with:
   - Signature
   - Pre-condition
   - Post-condition
   - Error cases
   - Stability guarantees ("stable since v0.x", "experimental")

2. Document the deviations from existing `ISandboxManager`:
   - New methods (28 methods listed)
   - Method extensions (e.g., `wrapWithSandbox` accepts new `toolName` field in customConfig)
   - Method semantics that change (e.g., `isSandboxRequired()` now consults Org layer)

**Acceptance**:
- Doc exists and renders cleanly
- 100% of `IFortressSandboxManager` methods covered

**Risk**: 0.

---

# Phase F1 — Layer 2: Hardened Adapter (1 week)

**Goal**: Migrate the existing `sandbox-adapter.ts` (985 lines) into our Fortress structure, harden its API surface, and add per-tool sandbox profiles. After F1, every tool that exec's commands gets a profile-tailored sandbox config instead of all sharing one.

**Effort**: 1 week.

---

### F1.1 — Migrate adapter into Fortress structure

**Goal**: Move `src/utils/sandbox/sandbox-adapter.ts` to `src/sandbox-fortress/adapter/legacy.ts`. Replace the original location with a re-export shim for backwards compat. Zero behavior change.

**Pre-conditions**: F0.1, F0.3 merged.

**Branch**: `fortress/f1-1-migrate-adapter`

**Files**:
- `packages/deep-code/src/sandbox-fortress/adapter/legacy.ts` (new — destination)
- `packages/deep-code/src/utils/sandbox/sandbox-adapter.ts` (modified — becomes shim)

**Operations**:
1. `git mv packages/deep-code/src/utils/sandbox/sandbox-adapter.ts packages/deep-code/src/sandbox-fortress/adapter/legacy.ts`
2. Create new `src/utils/sandbox/sandbox-adapter.ts` as a re-export shim:
   ```ts
   /**
    * Legacy entry point. The real implementation lives in
    * src/sandbox-fortress/adapter/legacy.ts as part of the DeepCode Sandbox
    * Fortress architecture. This file is kept for backwards compatibility
    * with existing import paths and will be removed in a future major.
    */
   export * from '../../sandbox-fortress/adapter/legacy.js'
   ```
3. Update internal imports in legacy.ts to use new relative paths (lots of `../bootstrap/` → `../../bootstrap/` etc.)
4. Build, fix import errors.

**Acceptance**:
- `bun run build:full-cli` passes
- All 240 existing tests pass
- `grep -rn "src/utils/sandbox/sandbox-adapter" packages/deep-code/src/` still finds existing import sites (they go through the shim)

**Risk**: Low. Pure file rename + shim. No semantic change.

---

### F1.2 — Per-tool sandbox profiles

**Goal**: Define + apply per-tool `ToolSandboxProfile` so different tools get different restrictions. Currently all tools share the global config; we want FileRead to be denied write even if Bash has write enabled.

**Pre-conditions**: F1.1 merged.

**Branch**: `fortress/f1-2-per-tool-profiles`

**Files**:
- `packages/deep-code/src/sandbox-fortress/adapter/per-tool-profiles.ts` (new)
- `packages/deep-code/src/sandbox-fortress/adapter/legacy.ts` (modified — `wrapWithSandbox` accepts toolName)
- `packages/deep-code/src/utils/Shell.ts` (modified — pass toolName when calling)
- `packages/deep-code/src/tools/BashTool/BashTool.tsx` (modified — pass toolName when launching shell)

**Operations**:
1. Define profiles for known tools:
   ```ts
   export const TOOL_PROFILES: Record<string, ToolSandboxProfile> = {
     [BASH_TOOL_NAME]: {
       toolName: BASH_TOOL_NAME,
       fileSystemMode: 'workspace-write',
       networkMode: 'allow',
       additionalDenyPatterns: [], // inherit global
     },
     [FILE_READ_TOOL_NAME]: {
       toolName: FILE_READ_TOOL_NAME,
       fileSystemMode: 'read-only',
       networkMode: 'deny',
     },
     [FILE_EDIT_TOOL_NAME]: {
       toolName: FILE_EDIT_TOOL_NAME,
       fileSystemMode: 'workspace-write',
       networkMode: 'deny',
     },
     [WEB_FETCH_TOOL_NAME]: {
       toolName: WEB_FETCH_TOOL_NAME,
       fileSystemMode: 'no-fs',
       networkMode: 'allow-with-restrictions',
     },
   }
   ```

2. `wrapWithSandbox` signature gains optional `toolName`:
   ```ts
   async function wrapWithSandbox(
     command: string,
     binShell: string,
     customConfig?: Partial<SandboxRuntimeConfig>,
     abortSignal?: AbortSignal,
     toolName?: string,    // ← new
   ): Promise<string>
   ```

3. Inside `wrapWithSandbox`, if `toolName` provided, look up profile and merge into `customConfig`:
   ```ts
   const profile = TOOL_PROFILES[toolName]
   if (profile) {
     customConfig = mergeProfileIntoConfig(profile, customConfig, baseConfig)
   }
   ```

4. Update `Shell.ts:260` to pass toolName from caller.

5. Tests:
   - `test/sandbox-fortress/unit/per-tool-profiles.test.mjs`:
     - FileRead tool config: confirm allowWrite is empty in resulting customConfig
     - WebFetch tool: confirm fs is fully denied
     - Bash tool: confirm workspace-write preserved
   - `test/sandbox-fortress/integration/tool-isolation.test.mjs`:
     - Spawn a fake "FileRead" command that tries to write a file → must fail
     - Spawn a fake "WebFetch" command that tries to read project files → must fail (mock the tool name)

**Acceptance**:
- Unit tests pass (≥10 cases)
- Integration test confirms tool-level isolation actually works at OS sandbox level
- All 240 existing tests still pass
- BashTool unchanged (since Bash profile = current global behavior)

**Risk**: Medium. If toolName plumbing is wrong, BashTool gets wrong profile and breaks. Mitigation: defaults to current behavior when toolName missing.

---

### F1.3 — Adapter test coverage hardening

**Goal**: Get the migrated adapter to ≥90% test coverage so future refactors are safe.

**Pre-conditions**: F1.2 merged.

**Branch**: `fortress/f1-3-adapter-coverage`

**Files**:
- `packages/deep-code/test/sandbox-fortress/unit/adapter-*.test.mjs` (multiple)

**Operations**:
1. For each public method in `legacy.ts`, write at least one happy-path test + one error-path test.
2. Use mock `BaseSandboxManager` (from F0.2 harness) to avoid real OS sandbox spawning in unit tests.
3. Use `c8` or `bun --coverage` to measure.

**Acceptance**:
- Coverage of `src/sandbox-fortress/adapter/` ≥ 90% lines
- All tests in `test/sandbox-fortress/unit/adapter-*.test.mjs` pass

**Risk**: Low.

---

# Phase F2 — Layer 3: 4-Layer Rule Engine (2 weeks)

**Goal**: Replace the flat config model with a 4-layer rule engine (`BuiltinDefault < Org < Agent < User`), typed `PermissionProfile`, yaml config files. Conflict resolution: high-layer deny always wins; high-layer allow can be overridden by low-layer deny.

**Effort**: 2 weeks.

---

### F2.1 — Rule engine core

**Goal**: Implement the 4-layer rule engine with conflict resolution.

**Pre-conditions**: F1.3 merged.

**Branch**: `fortress/f2-1-rule-engine-core`

**Files**:
- `packages/deep-code/src/sandbox-fortress/rule-engine/layers.ts` — RulesetLayer + ordering
- `packages/deep-code/src/sandbox-fortress/rule-engine/resolver.ts` — conflict resolution
- `packages/deep-code/src/sandbox-fortress/rule-engine/matcher.ts` — pattern matching (longest prefix, glob, CIDR)
- `packages/deep-code/src/sandbox-fortress/rule-engine/types.ts` — extended types

**Operations**:
1. RulesetLayer ordering with explicit numeric values:
   ```ts
   export const LAYER_ORDER: Record<RulesetLayer, number> = {
     'builtin-default': 0,
     'org': 1,
     'agent': 2,
     'user': 3,
   }
   ```

2. Conflict resolution algorithm (commented in code):
   ```ts
   // For a given (resource, path) lookup:
   // 1. Find all matching rules across all layers
   // 2. Group by (layer, action)
   // 3. If ANY rule says deny in any layer with non-superseded match, return deny
   // 4. Else if ANY rule says ask, return ask
   // 5. Else if ANY rule says allow, return allow
   // 6. Else return implicit-deny (default-deny)
   //
   // Special: high-layer deny is NEVER overridden by low-layer allow.
   // Special: high-layer allow CAN be overridden by low-layer deny (defense-in-depth).
   ```

3. Pattern matching:
   - Longest-prefix match for fs paths
   - Wildcard glob (`*`, `**`) for paths and domains
   - CIDR for IP-based net rules (e.g., `192.168.0.0/16`)
   - Exact match for hosts

4. Tests in `test/sandbox-fortress/unit/rule-engine.test.mjs`:
   - Single-layer cases: 8 tests (each layer × allow/deny)
   - Two-layer conflicts: 12 tests (each pair × conflicting actions)
   - Three-layer cases: 8 tests
   - Four-layer cases: 4 tests
   - Total ≥ 32 tests

**Acceptance**:
- 32+ test cases pass
- Algorithm documented in source comments

**Risk**: Medium. Conflict resolution is subtle; one bug = security gap. Mitigation: extensive test matrix.

---

### F2.2 — yaml config loader

**Goal**: Read 4-layer config from yaml files, with Zod schema validation and friendly errors.

**Pre-conditions**: F2.1 merged.

**Branch**: `fortress/f2-2-yaml-loader`

**Files**:
- `packages/deep-code/src/sandbox-fortress/rule-engine/yaml-schema.ts` — Zod schema
- `packages/deep-code/src/sandbox-fortress/rule-engine/yaml-loader.ts` — file loading + parsing
- New config locations:
  - `/etc/deepcode/sandbox.yaml` (Org layer — system-wide, requires root to write)
  - `~/.deepcode/sandbox.yaml` (User layer)
  - `<workspace>/.deepcode/sandbox.yaml` (Agent layer)

**Operations**:
1. Add `js-yaml` as devDep (or use built-in alternative if Bun supports yaml natively).
2. Zod schema:
   ```ts
   const SandboxYamlSchema = z.object({
     version: z.literal('1'),
     filesystem: z.object({
       allow_read: z.array(PathPatternSchema).optional(),
       deny_read: z.array(PathPatternSchema).optional(),
       allow_write: z.array(PathPatternSchema).optional(),
       deny_write: z.array(PathPatternSchema).optional(),
       allow_git_config: z.boolean().optional(),
     }).optional(),
     network: z.object({
       allowed_domains: z.array(DomainPatternSchema).optional(),
       denied_domains: z.array(DomainPatternSchema).optional(),
       allowed_cidrs: z.array(CidrSchema).optional(),
       denied_cidrs: z.array(CidrSchema).optional(),
     }).optional(),
     // ... etc
   })
   ```

3. Loader logic:
   ```ts
   export async function loadAllLayers(): Promise<Map<RulesetLayer, FortressRuleset>>
   ```
   Reads all 3 paths (org/user/agent), applies BuiltinDefault from code, returns merged map.

4. `deepcode sandbox dump-yaml` command — outputs current resolved config as yaml.

5. Tests:
   - Load valid yaml from each layer
   - Friendly errors on malformed yaml (with line numbers)
   - Missing files = empty layer (not error)
   - Invalid pattern detection (e.g., `*.com` rejected as too broad)

**Acceptance**:
- 15+ tests pass
- Friendly error messages tested manually

**Risk**: Low.

---

### F2.3 — PermissionProfile typed system

**Goal**: Add Codex CLI-inspired typed PermissionProfile on top of the rule engine. Profiles are higher-level abstractions like "read-only" / "workspace-write" / "danger-full-access" / "external-sandbox".

**Pre-conditions**: F2.2 merged.

**Branch**: `fortress/f2-3-permission-profiles`

**Files**:
- `packages/deep-code/src/sandbox-fortress/rule-engine/permission-profile.ts`
- `packages/deep-code/src/sandbox-fortress/rule-engine/profile-presets.ts` — built-in profiles

**Operations**:
1. Type:
   ```ts
   export type PermissionProfile =
     | { kind: 'danger-full-access' }
     | { kind: 'read-only' }
     | { kind: 'workspace-write', writableRoots?: string[], networkAccess?: boolean, excludeTmpdir?: boolean }
     | { kind: 'external-sandbox', networkAccess?: boolean }
     | { kind: 'custom', baseProfile: PermissionProfile, additionalRules: FortressRule[] }
   ```

2. Compile profile → rules:
   ```ts
   export function profileToRules(profile: PermissionProfile, layer: RulesetLayer): FortressRule[]
   ```

3. Built-in presets:
   - `BUILTIN_DEFAULT_PROFILE` — workspace-write with no network, deny dangerous files
   - `READ_ONLY_PROFILE`
   - `DANGER_FULL_ACCESS_PROFILE`

4. Tests: each profile compiles to expected rule set.

**Acceptance**:
- 10+ tests pass
- Type system catches invalid profiles at compile time

**Risk**: Low.

---

### F2.4 — Conflict resolution priority tests + docs

**Goal**: Formal documentation of conflict resolution rules + 64+ priority test cases covering edge cases.

**Pre-conditions**: F2.3 merged.

**Branch**: `fortress/f2-4-priority-docs-tests`

**Files**:
- `docs/sandbox-fortress/RULE_PRIORITY.md`
- `test/sandbox-fortress/unit/priority.test.mjs`

**Operations**:
1. Document covers:
   - Layer ordering rationale
   - Allow/deny precedence rules
   - Pattern overlap semantics
   - Practical examples ("if Org denies `~/.aws` and User allows it, what happens?" → Org wins)

2. Test matrix:
   - 4 layers × 4 actions × N pattern overlap cases = 64+ tests
   - Edge cases: empty rule set, deny-everything baseline, conflicting same-layer rules

3. Use the test names as docs (each test name reads like a sentence describing the scenario).

**Acceptance**:
- 64+ priority tests pass
- Docs include 10+ worked examples

**Risk**: Low.

---

### F2.5 — Adapter integration: rule engine drives `wrapWithSandbox`

**Goal**: Wire the rule engine into the adapter so that `wrapWithSandbox()` evaluates rules per-call and produces the right `SandboxRuntimeConfig` to pass to BaseSandboxManager.

**Pre-conditions**: F2.4 merged.

**Branch**: `fortress/f2-5-adapter-integration`

**Files**:
- `packages/deep-code/src/sandbox-fortress/adapter/legacy.ts` (modified — `wrapWithSandbox` evaluates rules)
- `packages/deep-code/src/sandbox-fortress/manager.ts` (modified — implements rule-engine-related methods)

**Operations**:
1. On adapter init, load all yaml layers via F2.2 loader.
2. Per `wrapWithSandbox` call:
   - Combine current rules + per-tool profile + dynamic ask-callback inputs
   - Resolve to a `SandboxRuntimeConfig` (the flat shape Anthropic SR expects)
   - Pass as `customConfig` to `BaseSandboxManager.wrapWithSandbox()`
3. Backward compat: if no yaml files exist, fall back to existing settings.json behavior.

**Acceptance**:
- All 240 existing tests pass (backward compat)
- New test: yaml config takes effect end-to-end (write yaml, wrap a command, verify the OS sandbox got the right config)
- New test: 4-layer override works end-to-end (org denies, user allows → org wins)

**Risk**: Medium. Integration point — bugs here affect all sandboxed commands. Run full test suite + manual smoke test of bash/file tools.

---

# Phase F3 — Layer 4: Observability (2 weeks)

**Goal**: SQLite violation persistence, `/sandbox stats`, `/sandbox map`, `--sandbox-dry-run`, `/sandbox replay`. Make the sandbox visible and analyzable.

**Effort**: 2 weeks.

---

### F3.1 — SQLite violation store

**Goal**: Persistent violation log with structured queries. Replaces Anthropic's in-memory `SandboxViolationStore` with a SQLite-backed version that survives restarts.

**Pre-conditions**: F2.5 merged.

**Branch**: `fortress/f3-1-sqlite-violations`

**Files**:
- `packages/deep-code/src/sandbox-fortress/observability/violation-db.ts`
- `packages/deep-code/src/sandbox-fortress/observability/schema.sql`
- `~/.deepcode/sandbox.db` (created at runtime)

**Operations**:
1. Use `bun:sqlite` (Bun built-in, zero external dep).
2. Schema (also in `schema.sql` for documentation):
   ```sql
   CREATE TABLE IF NOT EXISTS violations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,           -- unix epoch ms
     session_id TEXT NOT NULL,
     command_hash TEXT NOT NULL,    -- SHA-256 of full command
     command_redacted TEXT,         -- command after PII redaction
     tool_name TEXT,
     rule_layer TEXT,
     rule_pattern TEXT,
     action TEXT NOT NULL,          -- 'deny' | 'ask-denied' | 'ask-allowed' | 'allow-after-warn'
     blocked_resource TEXT,         -- 'fs-read' | 'fs-write' | 'net-host' | 'process-exec'
     blocked_path TEXT,
     model_effort TEXT,             -- 'off' | 'high' | 'max' | null
     was_approved INTEGER NOT NULL DEFAULT 0,
     metadata_json TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_violations_ts ON violations(ts);
   CREATE INDEX IF NOT EXISTS idx_violations_command ON violations(command_hash);
   CREATE INDEX IF NOT EXISTS idx_violations_session ON violations(session_id);
   CREATE INDEX IF NOT EXISTS idx_violations_pattern ON violations(rule_pattern);
   ```

3. API:
   ```ts
   export interface IFortressViolationDb {
     insert(event: SandboxViolationEvent, context: ViolationContext): void
     query(opts: ViolationQueryOpts): SandboxViolationEvent[]
     stats(opts: { since?: number; until?: number }): ViolationStats
     pruneOlderThan(ts: number): number  // returns count pruned
   }
   ```

4. PII redaction: strip user-home prefix, env values, common secret patterns (AWS keys, tokens) from `command_redacted` field.

5. Auto-prune: 90-day retention + 100MB hard cap (oldest archived to `sandbox-archive-YYYYMM.db`).

6. Bridge: subscribe to `BaseSandboxManager.getSandboxViolationStore()` events, write each to SQLite.

7. Tests:
   - 1000 events/sec write throughput
   - Query by various dimensions
   - Restart preserves data
   - Auto-prune triggers at 100MB

**Acceptance**:
- Throughput test passes
- Restart preservation test passes
- 15+ unit tests pass

**Risk**: Low — SQLite is well-trodden ground.

---

### F3.2 — `/sandbox stats` command

**Goal**: TUI command showing recent violation aggregates with actionable insights.

**Pre-conditions**: F3.1 merged.

**Branch**: `fortress/f3-2-sandbox-stats-command`

**Files**:
- `packages/deep-code/src/commands/sandbox/stats.tsx` (new component)
- `packages/deep-code/src/commands/sandbox/index.ts` (slash-command registration)

**Operations**:
1. Slash command: `/sandbox stats [--days N]`. Default last 7 days.
2. UI sections (Ink):
   - Header: total violations, blocked vs approved %
   - Top blocked patterns (sorted by count)
   - Top approved patterns (suggest promoting to user-allow)
   - Suggested cleanups (deny rules with 0 hits)
   - Cost estimate (wasted DeepSeek tokens from retries)

3. Output format:
   - Interactive: Ink table with color coding
   - JSON: `--json` flag for CI use

**Acceptance**:
- Command works end-to-end on a non-empty SQLite db
- JSON output is valid JSON and matches schema
- UI snapshot test (Ink testing-library)

**Risk**: Low.

---

### F3.3 — `/sandbox map` visualization

**Goal**: Tree-view of currently active rules across all 4 layers, with color coding and filter.

**Pre-conditions**: F3.2 merged.

**Branch**: `fortress/f3-3-sandbox-map-command`

**Files**:
- `packages/deep-code/src/commands/sandbox/map.tsx`

**Operations**:
1. Tree structure:
   ```
   📁 /Users/me/proj                              [allow rw]
   ├─ 🚫 .env                                     [deny r]   org
   ├─ 🚫 .git/hooks/**                            [deny *]   builtin
   ├─ 📁 node_modules/                            [allow r]  agent
   │  └─ 🚫 **/.bin/postinstall.sh                [deny x]   user
   └─ 📁 src/                                     [allow rw]
   🌐 Network:
   ├─ ✅ api.deepseek.com                         [allow]    builtin
   └─ 🚫 *                                        [deny]     org
   ```

2. Layer color coding: builtin=gray, org=red, agent=blue, user=green.

3. Filters: `--layer org`, `--resource fs-read`, etc.

**Acceptance**:
- Renders 100+ rules without lag
- Filters work correctly
- Snapshot test passes

**Risk**: Low.

---

### F3.4 — `--sandbox-dry-run` mode

**Goal**: A mode where rules are evaluated but not enforced — log "would have blocked" instead. Useful for CI / debugging.

**Pre-conditions**: F3.3 merged.

**Branch**: `fortress/f3-4-dry-run`

**Files**:
- `packages/deep-code/src/sandbox-fortress/observability/dry-run.ts`
- `packages/deep-code/src/sandbox-fortress/adapter/legacy.ts` (modified)

**Operations**:
1. Global flag (CLI: `--sandbox-dry-run`, env: `DEEPCODE_SANDBOX_DRY_RUN=1`).
2. When enabled:
   - Rules evaluated normally
   - Violations recorded in SQLite (with `action='dry-run-would-block'`)
   - But the underlying `customConfig` passed to BaseSandboxManager has all denies relaxed
3. Output: jsonl stream of "would have blocked" events to stderr or `~/.deepcode/dry-run-<session>.jsonl`.
4. Three integration tests:
   - Dry-run does NOT modify files (fs operations succeed)
   - Dry-run produces correct violation log
   - Exit code matches normal mode (no error)

**Acceptance**:
- 3 integration tests pass
- Documentation example shows CI use case

**Risk**: Medium. Bug here could turn off real enforcement silently. Mitigation: explicit warning banner shown when dry-run enabled.

---

### F3.5 — `/sandbox replay` + audit format

**Goal**: jsonl replay format for audit / regression testing. `deepcode sandbox replay <log>` re-evaluates each event against current rules and reports differences.

**Pre-conditions**: F3.4 merged.

**Branch**: `fortress/f3-5-replay`

**Files**:
- `packages/deep-code/src/sandbox-fortress/observability/replay.ts`
- `packages/deep-code/src/commands/sandbox/replay.tsx`

**Operations**:
1. Export format (jsonl):
   ```json
   {"ts":1715180000000,"event":"command","command_hash":"abc...","tool":"Bash","attempted_paths":["/etc/passwd"]}
   {"ts":1715180000050,"event":"violation","rule_layer":"builtin","action":"deny","blocked_path":"/etc/passwd"}
   ```

2. `replay <log>`:
   - Reads jsonl
   - For each event, re-evaluate against current rules
   - Diff: new vs original action
   - Reports regressions (new denies = bad if were allowed) and improvements (was deny, now allow)

3. Use case: after a rule change, replay last week's events to predict impact.

**Acceptance**:
- End-to-end: record events, change rules, replay, see diff
- Format is forward-compatible (extra fields ignored)

**Risk**: Low.

---

# Phase F4 — Layer 5: DeepSeek-Native (2 weeks)

**Goal**: The unique features that justify "DeepCode Sandbox". No other project has these.

**Effort**: 2 weeks.

---

### F4.1 — Reasoning-effort coupling

**Goal**: Sandbox strictness changes based on current DeepSeek reasoning effort.

**Pre-conditions**: F3.5 merged.

**Branch**: `fortress/f4-1-effort-coupling`

**Files**:
- `packages/deep-code/src/sandbox-fortress/deepseek/effort-coupling.ts`
- `packages/deep-code/src/sandbox-fortress/manager.ts` (implement `setEffortLevel`/`setStrictnessByEffort`)
- Hooks into REPL effort-change events

**Operations**:
1. Config:
   ```yaml
   # ~/.deepcode/sandbox.yaml
   deepseek:
     strictness_by_effort:
       off: lenient      # flash + thinking off → permissive (speed)
       high: standard    # default
       max: paranoid     # max thinking → enterprise-grade
   ```

2. Three strictness presets:
   ```ts
   export const STRICTNESS_PRESETS: Record<StrictnessLevel, FortressRule[]> = {
     lenient: [
       // Just builtin DANGEROUS_FILES
     ],
     standard: [
       // builtin + .env + .git/config + .aws/*
     ],
     paranoid: [
       // standard + .git/config (write) + IPC sockets + ~/.ssh/* + /proc/*/maps + custom dotfiles
     ],
   }
   ```

3. On effort change (subscribe to REPL state):
   - Update active rules (remove old strictness preset, add new)
   - Call `BaseSandboxManager.updateConfig(newConfig)` to hot-update Anthropic SR
   - Persist last-used effort to a small file for resume

4. Tests:
   - Switching effort triggers `updateConfig`
   - Three presets give observable difference (`max` denies `~/.ssh`, `lenient` allows)
   - Bench: switch latency < 50ms

**Acceptance**:
- Tests pass
- Manual smoke: change effort in REPL, then attempt a previously-allowed command, verify it's now denied

**Risk**: Low — Anthropic SR's `updateConfig` is well-tested.

---

### F4.2 — Violation → DeepSeek context feedback

**Goal**: When a sandbox blocks something, structured feedback gets injected into the next turn's context so the model learns and adapts.

**Pre-conditions**: F4.1 merged.

**Branch**: `fortress/f4-2-context-feedback`

**Files**:
- `packages/deep-code/src/sandbox-fortress/deepseek/context-feedback.ts`
- `packages/deep-code/src/services/tools/toolExecution.ts` (modified — inject feedback)

**Operations**:
1. Feedback template:
   ```
   [Sandbox Notice]
   Your previous tool use tried to {action} {resource}: {path}.
   This was blocked by rule "{rule_pattern}" ({rule_layer} layer).
   Context: {reason}.

   Suggestions:
     • {suggestion 1}
     • {suggestion 2}
     • If essential, ask the user with: /sandbox approve {pattern}

   The original command was: {redacted_command}
   ```

2. Suggestion engine:
   - Pattern-match the violation to a database of "common workarounds":
     - Tried to write `.env` → "use a different file" or "ask user"
     - Tried to install global package → "use --user flag"
     - Tried network without allowlist → "request domain in /sandbox approve"

3. Injection point: `toolExecution.ts` after a tool returns with sandbox failure, before the model's next turn sees the assistant message.

4. **Cache impact**: feedback message goes in dynamic segment, NEVER in static prefix (this matters for DeepSeek prefix-cache).

5. Compression: if same pattern blocked 3+ times in session, replace verbose feedback with one-line summary "(repeated 3×: similar block on .env files — please reconsider approach)".

6. Tests:
   - Mock a violation, assert feedback string format
   - Pattern-matching engine returns expected suggestions for known cases
   - Compression triggers at 3rd occurrence

**Acceptance**:
- Unit tests pass (15+)
- Integration test: model attempts to write `.env` → blocked → sees feedback → next turn's response references the feedback content

**Risk**: Medium. Quality of suggestions affects user experience. Iterate based on real session logs.

---

### F4.3 — Cache-aware policy serialization

**Goal**: Sandbox config representation in system prompt is designed so config changes don't bust DeepSeek prefix cache. Static parts in prefix; dynamic parts at end.

**Pre-conditions**: F4.2 merged.

**Branch**: `fortress/f4-3-cache-aware`

**Files**:
- `packages/deep-code/src/sandbox-fortress/deepseek/cache-aware-config.ts`
- `packages/deep-code/src/services/systemPrompt/sandboxSection.ts` (new — replaces inline config in current system prompt)

**Operations**:
1. Three-tier serialization of sandbox state:
   ```
   STATIC (rarely changes — top of system prompt):
     - Sandbox is enabled. Working directory: <cwd>.
     - General rule: paths under /etc, /System, ~/.ssh are restricted.

   SEMI-STATIC (rule changes — middle, includes hash for diff detection):
     - Active rules (hash: <sha256>): [rule summary]

   DYNAMIC (per-turn — end of system prompt):
     - Recent violations this session: <count>
     - Current effort: <effort>
   ```

2. Hash design: stable hash of rules sorted in canonical order. If rules unchanged, hash same → cache hits.

3. Effort change → only DYNAMIC changes → maybe SEMI-STATIC if rules differ → STATIC unchanged.

4. Bench:
   - Connect to DeepSeek API
   - Run 10 turns with rotating effort
   - Measure `prompt_cache_hit_tokens / prompt_cache_miss_tokens`
   - Goal: cache hit% > 80% across the sequence

**Acceptance**:
- Bench passes target
- Unit test: changing only dynamic state doesn't change static prefix
- Integration test: turn count + cost dashboard shows cache hits

**Risk**: Low — pure presentation layer.

---

### F4.4 — Auto-learn from approval patterns

**Goal**: When user approves the same pattern 3+ times in session (or 5+ across sessions), suggest persisting it as User-layer allow rule.

**Pre-conditions**: F4.3 merged.

**Branch**: `fortress/f4-4-auto-learn`

**Files**:
- `packages/deep-code/src/sandbox-fortress/deepseek/auto-learn.ts`
- Hooks into the ask-callback in `BaseSandboxManager.initialize()`

**Operations**:
1. Track approvals in SQLite (already done by F3.1 with `was_approved=1`).
2. Auto-learn engine queries SQLite per session:
   ```sql
   SELECT rule_pattern, COUNT(*) FROM violations
     WHERE session_id = ? AND was_approved = 1
     GROUP BY rule_pattern HAVING COUNT(*) >= 3
   ```

3. When trigger condition met, inject TUI prompt: "You've allowed `~/.config/myapp/` 5 times. Promote to user-allow rule? [y/n/snooze]"

4. On 'y': append rule to `~/.deepcode/sandbox.yaml` user layer.

5. Throttle: don't ask same pattern more than once per 24h.

**Acceptance**:
- Unit test: simulate 5 approvals, prompt triggers
- Manual smoke: actual flow works

**Risk**: Low.

---

# Phase F5 — Polish + Cutover (1 week)

**Goal**: Documentation, benchmarks, redteam tests, switch the canonical `SandboxManager` import to point to FortressSandboxManager.

**Effort**: 1 week.

---

### F5.1 — Architecture & user docs

**Branch**: `fortress/f5-1-docs`

**Files**:
- `docs/sandbox-fortress/ARCHITECTURE.md` — 5-layer diagram with data flow
- `docs/sandbox-fortress/MIGRATION.md` — settings.json → yaml migration guide
- `docs/sandbox-fortress/DEEPSEEK_INTEGRATION.md` — effort coupling, feedback, cache
- `docs/sandbox-fortress/COMMANDS.md` — full reference for /sandbox stats/map/dry-run/replay
- `docs/sandbox-fortress/RULE_PRIORITY.md` — already exists from F2.4
- `docs/sandbox-fortress/API_CONTRACT.md` — already exists from F0.3
- `packages/deep-code/src/sandbox-fortress/README.md` — package-level overview

**Operations**:
- Each doc has worked examples
- Architecture has Mermaid diagrams (or ASCII art)
- Migration guide covers: existing user workflows, settings.json → yaml conversion script

**Acceptance**: All docs render in GitHub UI, link checker passes.

---

### F5.2 — Red team test suite (50+ cases)

**Branch**: `fortress/f5-2-redteam`

**Files**: `test/sandbox-fortress/redteam/*.test.mjs` (10+ files)

**Operations**:
1. Categories:
   - Path-traversal attacks (`../../../etc/passwd`, encoded variants)
   - Symlink replacement
   - Rename bypass
   - TOCTOU races
   - PATH/LD_PRELOAD injection
   - IPC socket bypass
   - /proc/self/* paths
   - Mandatory-deny scan bypass
   - 4-layer rule conflicts that could be exploited
   - DeepSeek-specific: trying to bypass via context feedback (e.g., crafting a fake "[Sandbox Notice]" in user prompt to trick model)

2. Each test case references CWE/OWASP where applicable.

3. Strategy: most attacks defer to Anthropic SR's underlying defenses (we don't reimplement them); but test cases verify our wrapper doesn't accidentally weaken them.

**Acceptance**: 50+ cases pass.

---

### F5.3 — Benchmarks

**Branch**: `fortress/f5-3-bench`

**Files**: `bench/sandbox-fortress.bench.mjs`

**Operations**:
1. Cold-start of bash command:
   - Without Fortress: existing baseline ~150ms
   - With Fortress: target < 155ms (≤ 5ms overhead)
2. Rule evaluation latency:
   - 10 rules / 100 rules / 1000 rules
   - Target: < 1ms even at 1000 rules
3. SQLite write latency: 1000 events/sec sustained
4. Cache hit% benchmark from F4.3
5. Effort-switch latency (F4.1)

**Acceptance**: All targets met, results in `bench/sandbox-fortress-results.md`.

---

### F5.4 — Cutover: switch ISandboxManager binding

**Branch**: `fortress/f5-4-cutover`

**Files**:
- `packages/deep-code/src/utils/sandbox/sandbox-adapter.ts` (modified — re-export FortressSandboxManager as SandboxManager)
- `packages/deep-code/src/sandbox-fortress/index.ts` (modified — official entry)

**Operations**:
1. Change shim:
   ```ts
   // utils/sandbox/sandbox-adapter.ts
   export { FortressSandboxManager as SandboxManager } from '../../sandbox-fortress/index.js'
   export type * from '../../sandbox-fortress/types.js'
   ```

2. Existing 30+ files importing from `utils/sandbox/sandbox-adapter` automatically get the Fortress version.

3. Run full test suite + manual smoke testing.

4. Document cutover in CHANGELOG.

**Acceptance**:
- All 240 existing tests pass
- All Fortress tests pass (~150+)
- No type errors
- Manual smoke: bash command works, effort switching works, dry-run works, /sandbox stats shows data

**Risk**: Medium — full integration. Cannot rollback easily once merged. Recommended: cut a release tag `v0.4.0-fortress` immediately before merging this.

---

### F5.5 — `@deepcode-ai/sandbox` npm package extraction

**Goal** (optional, only if you want a separate npm-publishable package).

**Branch**: `fortress/f5-5-package-extract`

**Operations**:
1. Move `packages/deep-code/src/sandbox-fortress/` to `packages/sandbox/`
2. Add `package.json` with name `@deepcode-ai/sandbox`
3. Update workspace config in root `package.json`
4. main package depends on `@deepcode-ai/sandbox` workspace

**Acceptance**:
- `npm pack --workspace @deepcode-ai/sandbox` succeeds
- Main package still builds via workspace resolution

**Risk**: Low — purely organizational.

---

# Definition of Done

```
原创性
✅ packages/deep-code/src/sandbox-fortress/ has ~3000 lines of original code
✅ docs/sandbox-fortress/ has 6+ comprehensive documents
✅ Zero copy of @anthropic-ai/sandbox-runtime internal source
✅ Public API only — through wrapWithSandbox, updateConfig, etc.

功能完整 — Layer 2 (F1)
✅ Per-tool sandbox profiles working
✅ Bash gets workspace-write, FileRead gets read-only, etc.

功能完整 — Layer 3 (F2)
✅ 4-layer rule engine (BuiltinDefault < Org < Agent < User) working
✅ yaml config files functioning
✅ PermissionProfile typed system
✅ 64+ priority test cases passing

功能完整 — Layer 4 (F3)
✅ SQLite violation persistence
✅ /sandbox stats / map / replay commands functional
✅ --sandbox-dry-run mode functional

功能完整 — Layer 5 (F4)
✅ Effort coupling triggers different strictness
✅ Violation → context feedback injects properly
✅ Cache-aware config: hit% benchmark > 80%
✅ Auto-learn approval pattern triggers prompt at 5 occurrences

底层不动
✅ @anthropic-ai/sandbox-runtime treated as black-box library
✅ Original 240 tests still pass
✅ Anthropic's 9 hardened defenses preserved

性能不退化
✅ Cold-start overhead < 5ms
✅ Rule evaluation < 1ms even at 1000 rules
✅ SQLite > 1000 events/sec sustained

DeepSeek 独占
✅ Effort coupling works on real DeepSeek API
✅ Context feedback measurably reduces model retry count (≥ 50% reduction)
✅ Cache hit% > 80% across config-changing turns

测试覆盖
✅ Adapter coverage > 90%
✅ Rule engine 64+ priority tests
✅ Red team 50+ cases
✅ DeepSeek integration end-to-end tests
```

---

# Appendix A — Codex Operational Cheatsheet

Same as PURE_DEEPSEEK_PLAN.md Appendix A. Per-task workflow:
1. Pick task (e.g., F2.1)
2. Read this file's spec for that task
3. Branch + execute Operations
4. Run build + full test gauntlet
5. Self-codex-review the diff
6. Commit + PR
7. Wait for CI green
8. Squash-merge
9. Sync local main
10. Report back to human

---

# Appendix B — Risk Register

**Highest-risk tasks** (where Codex must stop for human review):
- **F2.1** — Conflict resolution algorithm. One bug = security gap.
- **F2.5** — Adapter integration. Affects all sandboxed commands.
- **F3.4** — Dry-run mode. Bug here could silently disable enforcement.
- **F4.2** — Context feedback. Quality affects user experience materially.
- **F5.4** — Cutover. Hard to rollback.

For these, Codex must:
1. Do its work
2. Open PR but do NOT merge
3. Tag human reviewer in PR description
4. Wait for explicit human approval

For all other tasks (F0.x, F1.x, F3.1-3.3, F3.5, F4.1, F4.3, F4.4, F5.1-5.3, F5.5), Codex may merge after CI green + self-review.

---

# Appendix C — Why This Is Better Than Each Existing Project

| Dimension | Anthropic SR | OpenAI Codex CLI | DeepSeek-TUI | DeepCode Sandbox |
|---|---|---|---|---|
| Defense-in-depth (OS sandbox) | 9 hardened defenses | bwrap+landlock+seccomp | landlock only | **inherit Anthropic's 9** |
| Architecture | flat config | typed multi-crate | typed 3-layer | **typed 4-layer (BuiltinDefault < Org < Agent < User)** |
| Per-tool profiles | no | no | no | **yes** |
| SQLite violation persistence | no (in-memory) | no | no | **yes** |
| Stats/map/dry-run/replay commands | no | partial debug | no | **yes (4 commands)** |
| Reasoning-effort coupling | no | no | no | **yes (DeepCode unique)** |
| Violation → model context feedback | no | no | no | **yes (DeepCode unique)** |
| Cache-aware config (DeepSeek prefix cache) | no | no | no | **yes (DeepCode unique)** |
| Auto-learn approval patterns | no | no | no | **yes (DeepCode unique)** |
| Windows support | no | yes (production) | minimal | **defer to Anthropic SR (= no)** |
| License (self-use) | proprietary | Apache-2 | MIT | our wrapper, MIT/Apache-2 inherited from base |

**Net**: We inherit Anthropic's defensive depth (the hardest part to build), borrow Codex's typed architecture (the best layer model), match DeepSeek-TUI's open-source posture, and add 4 unique features that no one else has. That's a real product, not a fork.

---

# Appendix D — When Codex Should Stop and Ask

In addition to PURE_DEEPSEEK_PLAN.md's Appendix B rules, also stop and ask if:

- A task's `Acceptance` requires real DeepSeek API calls (F4.3 cache benchmark) and you don't have an API key configured. Don't skip the test — ask the user to provide one or set up a mock.
- A red team test in F5.2 actually finds a bypass (i.e., the test passes when it should fail). Don't ship a sandbox with known bypasses; escalate immediately.
- Performance benchmarks in F5.3 fail to meet targets. Investigate and propose mitigations rather than relaxing targets.
- Integration with `@anthropic-ai/sandbox-runtime` exposes a behavior we didn't anticipate (e.g., undocumented quirk of `updateConfig`). Document the quirk as a workaround in the architecture doc.
