# Sandbox Fortress — Public API Contract
Task: F0.3
Generated: 2026-05-10
Base commit: 059c6b73d2a38f01b19c240c955e4b762b1654ad
Status: contract-only (no implementation)

## Architecture overview

Sandbox Fortress is the public DeepCode-owned wrapper above the existing OS sandbox stack. The long-form rationale is in `SANDBOX_FORTRESS_PLAN.md:32-59`: Layer 1 remains `@anthropic-ai/sandbox-runtime` as an untouched black-box library; Layers 2-5 add DeepCode behavior without copying or depending on runtime internals.

The public API must preserve the existing `ISandboxManager` contract while adding Fortress-specific policy, observability, and DeepSeek-native hooks:

- Layer 1: `@anthropic-ai/sandbox-runtime`, called only through the adapter boundary. The contract never exposes runtime internals, source, or undocumented wire data.
- Layer 2: hardened adapter and per-tool profiles. It migrates the current chokepoint adapter and may extend `wrapWithSandbox` with tool profile context as described in `SANDBOX_FORTRESS_PLAN.md:289-335` and `SANDBOX_FORTRESS_PLAN.md:333-411`.
- Layer 3: four-layer rule engine, `builtin-default < org < agent < user`, including rule loading, matching, conflict resolution, and profile compilation. See `SANDBOX_FORTRESS_PLAN.md:439-503`.
- Layer 4: observability, SQLite violation persistence, stats, map, dry-run, and replay. See `SANDBOX_FORTRESS_PLAN.md:673-887`.
- Layer 5: DeepSeek-native effort coupling, violation feedback, cache-aware policy serialization, and auto-learn rule promotion. See `SANDBOX_FORTRESS_PLAN.md:890-1085`.

This document is binding for downstream F1-F5 tasks. Implementations may add private helpers, but public exports and method semantics below require explicit contract updates.

## Type contracts

All public types are exported from `packages/deep-code/src/sandbox-fortress/index.ts`, which currently re-exports `FortressSandboxManager`, `IFortressSandboxManager`, and all types from `types.ts`.

### `FortressRuntimeConfig`

```ts
export type FortressRuntimeConfig = SandboxRuntimeConfig
```

Alias for the black-box runtime config accepted by the underlying sandbox runtime. Public callers may pass this shape only where the manager contract explicitly accepts a runtime config. Fortress must not widen this type with private fields; add wrapper-specific fields to Fortress-owned types instead. Stable as a pass-through alias while Layer 1 remains `@anthropic-ai/sandbox-runtime`.

### `FortressViolationEvent`

```ts
export type FortressViolationEvent = SandboxViolationEvent
```

Alias for sandbox-runtime violation events. These events are immutable observations. Implementations may enrich records with Fortress metadata through `FortressViolationRecord`, but must not mutate the original event object.

### `FortressAskCallback`

```ts
export type FortressAskCallback = SandboxAskCallback
```

Alias for the runtime permission callback used during sandbox initialization. Fortress may wrap this callback to record approvals, support auto-learn, or inject rule context, but wrapper code must preserve the callback's original input/output behavior.

### `FortressDependencyCheck`

```ts
export type FortressDependencyCheck = SandboxDependencyCheck
```

Alias for dependency probe results from the base sandbox manager. Fortress code may add derived diagnostics in future private helpers, but this exported alias remains the base result shape.

### `RulesetLayer`

```ts
export type RulesetLayer = 'builtin-default' | 'org' | 'agent' | 'user'
```

Allowed values are fixed and ordered as `builtin-default < org < agent < user`. The ordering is specified for F2.1 in `SANDBOX_FORTRESS_PLAN.md:462-470`. Layers are required for every `FortressRule` and `FortressRuleset`. Adding a layer is a breaking contract change because it changes conflict resolution and persistence semantics.

### `ResourceKind`

```ts
export type ResourceKind = 'fs-read' | 'fs-write' | 'net-host' | 'process-exec'
```

The resource class a rule controls. `fs-read` and `fs-write` patterns match normalized file-system paths; `net-host` patterns match hostnames, domains, or CIDR-expanded network targets; `process-exec` patterns match the invoked binary token **as written** in the command (`rm`, `/bin/rm`, `./tool`) — there is no `PATH` resolution, so a rule on `rm` does not by itself match `/bin/rm`; use a glob such as `**/rm` for cross-form matching. Adding values is a minor contract change only if the default action is implicit deny and old callers continue to compile.

**Enforcement fidelity.** `fs-read`/`fs-write`/`net-host` rules are enforced against a concrete resolved target (path / host), so matching is faithful. `process-exec` enforcement over the Bash tool is **best-effort / defense-in-depth, not a hard boundary**: it extracts the invoked binary from the command via static analysis, which catches direct invocations but can be evaded (command substitution / `eval` / `bash -c`, leading redirections, `$'…'` quoting, and wrapper commands such as `sudo rm` matching `sudo` not `rm`). The default build also runs without the tree-sitter parser (legacy splitter), which widens these gaps. Treat `process-exec` deny/ask as a tripwire that reduces attack surface, not a guarantee. The canonical evasion list lives in `packages/deep-code/src/sandbox-fortress/rule-engine/processExec.mjs`.

### `RuleAction`

```ts
export type RuleAction = 'allow' | 'deny' | 'ask'
```

`allow` permits matching resources, `deny` blocks matching resources, and `ask` delegates to the configured ask callback. Implementations must treat absent matches as implicit deny unless an inherited base-manager setting explicitly provides a backward-compatible allow path.

### `FortressRule`

```ts
export interface FortressRule {
  layer: RulesetLayer
  resource: ResourceKind
  pattern: string
  action: RuleAction
  metadata?: {
    reason?: string
    expiresAt?: number
    sourceFile?: string
    sourceLine?: number
  }
}
```

`layer`, `resource`, `pattern`, and `action` are required. `pattern` must be non-empty after trimming; empty patterns are invalid because they are indistinguishable from deny-all in reviewer-facing docs. `metadata.reason` is human-readable and safe to display. `metadata.expiresAt` is Unix epoch milliseconds; expired rules must be ignored by effective-rule resolution but retained by persistence until normal retention cleanup. `sourceFile` and `sourceLine` identify configuration provenance and are optional.

Backward-compatible metadata additions are allowed. Removing or changing required fields is breaking.

### `FortressRuleset`

```ts
export interface FortressRuleset {
  layer: RulesetLayer
  rules: FortressRule[]
}
```

A complete rule collection for one layer. `layer` is required and every contained rule must use the same layer. `rules` is required and may be empty. Implementations must return defensive copies from public methods.

### `EffortLevel`

```ts
export type EffortLevel = 'off' | 'high' | 'max'
```

DeepSeek reasoning effort levels that Fortress understands. F4.1 maps effort to sandbox strictness (`SANDBOX_FORTRESS_PLAN.md:898-951`). Unknown effort values from future model providers must be normalized before reaching public methods.

### `StrictnessLevel`

```ts
export type StrictnessLevel = 'lenient' | 'standard' | 'paranoid'
```

Named rule presets for effort coupling. F4.1 defines initial preset intent in `SANDBOX_FORTRESS_PLAN.md:922-945`. Changing preset behavior is not a type break, but must be covered by compatibility notes because it changes runtime policy.

### `ToolSandboxProfile`

```ts
export interface ToolSandboxProfile {
  toolName: string
  fileSystemMode: 'read-only' | 'workspace-write' | 'no-fs'
  networkMode: 'allow' | 'deny' | 'allow-with-restrictions'
  additionalDenyPatterns?: string[]
  additionalAllowPatterns?: string[]
}
```

`toolName`, `fileSystemMode`, and `networkMode` are required. `toolName` must be non-empty and match the public tool identifier used at the `wrapWithSandbox` call site. Additional patterns are optional and layer on top of profile defaults. F1.2 defines baseline profile intent in `SANDBOX_FORTRESS_PLAN.md:333-411`.

The default profile for unknown tools is equivalent to the inherited global sandbox behavior until F2.5 wires rule-engine policy into every call. Implementations must not silently map an unknown tool to `danger-full-access`.

### `FortressViolationRecord`

```ts
export interface FortressViolationRecord {
  id: string
  timestamp: number
  event: SandboxViolationEvent
  toolName?: string
  command?: string
  dryRun?: boolean
}
```

`id`, `timestamp`, and `event` are required. `id` is a stable unique record identifier generated before persistence. `timestamp` is Unix epoch milliseconds. `toolName` and `command` are optional because legacy violations may lack tool context. `dryRun` marks "would have blocked" records and must never be used to imply actual enforcement.

### `IFortressViolationDb`

```ts
export interface IFortressViolationDb {
  recordViolation(record: FortressViolationRecord): Promise<void>
  listViolations(limit?: number): Promise<FortressViolationRecord[]>
  clearViolations(): Promise<void>
  close(): Promise<void>
}
```

This is the public minimal violation-store API exposed by the manager. F3.1 may use a richer internal SQLite API, but public callers can rely only on these four methods. `recordViolation` persists exactly one record or rejects with a typed persistence error. `listViolations` returns newest records first when the backend supports ordering; `limit` must be a positive integer when provided. `clearViolations` deletes visible records for the active store. `close` is idempotent.

### `CacheFriendlyConfigSummary`

```ts
export interface CacheFriendlyConfigSummary {
  static: string
  dynamic: string
}
```

`static` contains cache-stable policy text suitable for a stable prompt prefix. `dynamic` contains per-turn or frequently changing state. F4.3 requires dynamic-only changes to avoid changing the static prefix where possible (`SANDBOX_FORTRESS_PLAN.md:1008-1049`).

## FortressSandboxManager

`IFortressSandboxManager` extends `ISandboxManager` and adds Fortress-owned methods. Current scaffold lines show the inherited interface in `packages/deep-code/src/utils/sandbox/sandbox-adapter.ts:880-922` and Fortress additions in `packages/deep-code/src/sandbox-fortress/manager.ts:22-38`.

### Inherited methods (delegate to baseSandboxManager)

| method name | inherited from | delegation contract | when override is allowed |
| --- | --- | --- | --- |
| `initialize` | `ISandboxManager` | Delegates initialization and preserves the ask-callback contract. | F1/F4 may wrap callbacks for profiles, persistence, or auto-learn if callback behavior is preserved. |
| `isSupportedPlatform` | `ISandboxManager` | Returns the base platform support result. | Only if Fortress adds stricter platform support and documents the delta. |
| `isPlatformInEnabledList` | `ISandboxManager` | Returns the base enabled-list result. | Only if policy layers add documented platform gating. |
| `getSandboxUnavailableReason` | `ISandboxManager` | Returns the base unavailable reason. | Only to append Fortress-specific diagnostics without hiding base errors. |
| `isSandboxingEnabled` | `ISandboxManager` | Returns whether sandboxing is active according to base settings. | F5.4 may override after Fortress is the canonical manager. |
| `isSandboxEnabledInSettings` | `ISandboxManager` | Returns the user/settings enabled flag. | Only if yaml policy becomes authoritative and backward compatibility is documented. |
| `checkDependencies` | `ISandboxManager` | Returns base dependency checks. | F1 may aggregate Fortress dependency checks, but base errors must remain visible. |
| `isAutoAllowBashIfSandboxedEnabled` | `ISandboxManager` | Returns base setting. | Only if per-tool profiles replace this behavior with explicit policy. |
| `areUnsandboxedCommandsAllowed` | `ISandboxManager` | Returns base setting. | Only if Org/User policy can forbid unsandboxed execution. |
| `isSandboxRequired` | `ISandboxManager` | Returns base required state. | F2.5/F5.4 may consult Org-layer policy as anticipated by `SANDBOX_FORTRESS_PLAN.md:276-279`. |
| `areSandboxSettingsLockedByPolicy` | `ISandboxManager` | Returns base policy-lock state. | F2 may combine base policy with Org layer. |
| `setSandboxSettings` | `ISandboxManager` | Delegates base settings update. | F2.5 may translate yaml/rule-engine state to base settings. |
| `getFsReadConfig` | `ISandboxManager` | Returns base read restrictions. | F2.5 may return effective rule-derived read config. |
| `getFsWriteConfig` | `ISandboxManager` | Returns base write restrictions. | F2.5 may return effective rule-derived write config. |
| `getNetworkRestrictionConfig` | `ISandboxManager` | Returns base network restrictions. | F2.5 may return effective rule-derived network config. |
| `getAllowUnixSockets` | `ISandboxManager` | Returns base Unix socket allowlist. | Only when rule engine has a socket resource mapping. |
| `getAllowLocalBinding` | `ISandboxManager` | Returns base local-binding setting. | Only when rule engine has a local-binding mapping. |
| `getIgnoreViolations` | `ISandboxManager` | Returns base ignore-violations config. | Only if dry-run/replay semantics require visible ignore policy. |
| `getEnableWeakerNestedSandbox` | `ISandboxManager` | Returns base nested-sandbox setting. | Only for documented nested sandbox policy. |
| `getExcludedCommands` | `ISandboxManager` | Returns base excluded commands. | F2 may append rule-derived process-exec exclusions. |
| `getProxyPort` | `ISandboxManager` | Returns base HTTP proxy port. | Override prohibited unless adapter ownership moves in F5.4. |
| `getSocksProxyPort` | `ISandboxManager` | Returns base SOCKS proxy port. | Override prohibited unless adapter ownership moves in F5.4. |
| `getLinuxHttpSocketPath` | `ISandboxManager` | Returns base Linux HTTP socket path. | Override prohibited unless adapter ownership moves in F5.4. |
| `getLinuxSocksSocketPath` | `ISandboxManager` | Returns base Linux SOCKS socket path. | Override prohibited unless adapter ownership moves in F5.4. |
| `waitForNetworkInitialization` | `ISandboxManager` | Delegates base network init wait. | Only to add observability timing without changing returned boolean semantics. |
| `wrapWithSandbox` | `ISandboxManager` | Delegates command wrapping and returns the wrapped command string. | F1.2/F2.5 may add optional tool context as a fifth argument and rule-engine config, preserving existing call behavior when no tool context is provided. |
| `cleanupAfterCommand` | `ISandboxManager` | Runs base cleanup after command completion. | F3 may flush violation records, but cleanup remains synchronous and idempotent. |
| `getSandboxViolationStore` | `ISandboxManager` | Returns the base in-memory violation store. | F3.1 may bridge to SQLite but must not remove this inherited API before cutover docs say so. |
| `annotateStderrWithSandboxFailures` | `ISandboxManager` | Delegates stderr annotation. | F4.2 may append DeepSeek feedback hints, preserving original stderr content. |
| `getLinuxGlobPatternWarnings` | `ISandboxManager` | Returns base warning list. | F2 may append Fortress pattern warnings. |
| `refreshConfig` | `ISandboxManager` | Delegates config refresh. | F2/F4 may reload yaml, profile, and effort-derived rules. |
| `reset` | `ISandboxManager` | Delegates reset and returns when manager state is clean. | May reset Fortress caches, rules, profiles, and DB handles after base reset succeeds. |

#### `wrapWithSandbox` Fortress extension

F1.2 and F2.5 must carry tool context as a fifth optional argument, not by adding wrapper-only fields to `customConfig`. `customConfig` remains a `Partial<FortressRuntimeConfig>` that can be passed to the runtime adapter without leaking Fortress metadata.

```ts
wrapWithSandbox(
  command: string,
  binShell?: string,
  customConfig?: Partial<FortressRuntimeConfig>,
  abortSignal?: AbortSignal,
  toolName?: string,
): Promise<string>
```

Existing four-argument calls keep their current behavior. When `toolName` is provided, the adapter resolves `getProfileForTool(toolName)`, combines it with active rules, and converts only the resulting runtime-safe fields into `customConfig` for Layer 1.

### New methods (currently notImplemented)

The current scaffold exposes 13 Fortress-specific manager methods. Each method is experimental until implemented and covered by tests in its owning layer.

#### `getRulesetByLayer`

```ts
getRulesetByLayer(layer: RulesetLayer): Promise<FortressRuleset>
```

- Input contract: `layer` must be one of `builtin-default`, `org`, `agent`, or `user`.
- Output contract: resolves to a defensive copy of that layer's complete `FortressRuleset`; missing configured files produce `{ layer, rules: [] }` except builtin defaults.
- Error contract: rejects `FortressValidationError` for impossible layer values at runtime, `FortressStorageError` when the layer cannot be loaded.
- Side effects: none; must not reload from disk unless implementation documents cache invalidation.
- Concurrency: re-entrant and async-safe; parallel callers observe the same committed layer snapshot.
- Performance budget: p50 < 2 ms from warm cache, p99 < 25 ms with file-backed load.
- Layer ownership: Layer 3, F2.1/F2.2.

```ts
const userRules = await fortress.getRulesetByLayer('user')
console.log(userRules.rules.length)
```

#### `setRuleset`

```ts
setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void>
```

- Input contract: `layer` is valid; every rule has the same `layer`, a non-empty `pattern`, valid `resource`, and valid `action`.
- Output contract: resolves after the layer is validated, persisted or cached, and visible to later reads.
- Error contract: rejects `FortressValidationError` for malformed rules, `FortressStateError` for attempts to write locked layers, `FortressStorageError` for failed persistence.
- Side effects: may write yaml-backed rules and invalidate effective-rule caches.
- Concurrency: async-safe; last committed write wins only after validation. Implementations should serialize writes by layer.
- Performance budget: p50 < 10 ms for 100 rules; p99 < 100 ms for 1000 rules plus persistence.
- Layer ownership: Layer 3, F2.1/F2.2.

```ts
await fortress.setRuleset('user', [{
  layer: 'user',
  resource: 'fs-write',
  pattern: '/tmp/deepcode/**',
  action: 'allow',
}])
```

#### `resolveEffectiveRules`

```ts
resolveEffectiveRules(): Promise<FortressRule[]>
```

- Input contract: no arguments; uses all loaded layers and active strictness/profile overlays.
- Output contract: returns a deterministic, sorted, defensive copy of rules after expiration filtering and conflict metadata resolution.
- Error contract: rejects if any layer cannot be loaded or validated.
- Side effects: may refresh internal caches; must not persist changes.
- Concurrency: re-entrant; concurrent calls may share an in-flight resolution promise.
- Performance budget: p50 < 2 ms for 100 rules, p99 < 10 ms for 1000 rules.
- Layer ownership: Layer 3, F2.1/F2.4/F2.5.

```ts
const effective = await fortress.resolveEffectiveRules()
const deniedHomes = effective.filter(rule => rule.action === 'deny')
```

#### `enableDryRunMode`

```ts
enableDryRunMode(enabled: boolean): void
```

- Input contract: `enabled` is a boolean.
- Output contract: subsequent rule evaluation records would-block violations but does not enforce deny config when dry-run is enabled.
- Error contract: no-op if called with current state; throws `FortressStateError` only if manager is closed or reset in progress.
- Side effects: toggles in-memory dry-run state and may update CLI warning state.
- Concurrency: synchronous and re-entrant; the new value is visible immediately after return.
- Performance budget: p50 < 1 ms.
- Layer ownership: Layer 4, F3.4.

```ts
fortress.enableDryRunMode(true)
console.warn(fortress.isDryRunMode() ? 'dry-run only' : 'enforcing')
```

#### `isDryRunMode`

```ts
isDryRunMode(): boolean
```

- Input contract: no arguments.
- Output contract: returns the current dry-run flag.
- Error contract: must not throw.
- Side effects: none.
- Concurrency: safe during command execution.
- Performance budget: p50 < 1 ms.
- Layer ownership: Layer 4, F3.4.

```ts
if (fortress.isDryRunMode()) {
  process.stderr.write('[sandbox] dry-run enabled\n')
}
```

#### `getViolationDb`

```ts
getViolationDb(): IFortressViolationDb
```

- Input contract: no arguments; manager must be initialized or able to lazily initialize the store.
- Output contract: returns the singleton public violation DB facade for the active manager.
- Error contract: throws `FortressStorageError` if the DB cannot be opened; throws `FortressStateError` after `close` if lazy reopen is disabled.
- Side effects: may lazily open SQLite and create schema.
- Concurrency: returned facade must serialize writes and allow concurrent reads.
- Performance budget: p50 < 5 ms after warm open; opening schema p99 < 100 ms.
- Layer ownership: Layer 4, F3.1.

```ts
await fortress.getViolationDb().recordViolation(record)
const recent = await fortress.getViolationDb().listViolations(20)
```

#### `setEffortLevel`

```ts
setEffortLevel(effort: EffortLevel): Promise<void>
```

- Input contract: `effort` is `off`, `high`, or `max`.
- Output contract: active effort is updated and associated strictness rules are applied before resolution.
- Error contract: rejects `FortressValidationError` for invalid runtime values, `FortressRuntimeError` if the underlying runtime config update fails.
- Side effects: updates in-memory effort state, may persist resume state, and may call the base manager config update path.
- Concurrency: async-safe; callers observe efforts in commit order.
- Performance budget: switch latency < 50 ms as required by `SANDBOX_FORTRESS_PLAN.md:942-945`.
- Layer ownership: Layer 5, F4.1.

```ts
await fortress.setEffortLevel('max')
assert.equal(fortress.getCurrentEffort(), 'max')
```

#### `getCurrentEffort`

```ts
getCurrentEffort(): EffortLevel
```

- Input contract: no arguments.
- Output contract: returns the active effort; default is `high` unless configuration says otherwise.
- Error contract: must not throw.
- Side effects: none.
- Concurrency: safe during effort changes; returns last committed effort.
- Performance budget: p50 < 1 ms.
- Layer ownership: Layer 5, F4.1.

```ts
const effort = fortress.getCurrentEffort()
```

#### `setStrictnessByEffort`

```ts
setStrictnessByEffort(
  mapping: Record<EffortLevel, StrictnessLevel>,
): Promise<void>
```

- Input contract: mapping must include `off`, `high`, and `max`; every value is `lenient`, `standard`, or `paranoid`.
- Output contract: future effort changes use the new mapping; current effort is re-evaluated before the promise resolves.
- Error contract: rejects `FortressValidationError` for incomplete/invalid mappings and `FortressStorageError` if persistence fails.
- Side effects: updates effort coupling config and may update runtime config immediately.
- Concurrency: serialize with `setEffortLevel`.
- Performance budget: p99 < 50 ms excluding disk persistence.
- Layer ownership: Layer 5, F4.1.

```ts
await fortress.setStrictnessByEffort({
  off: 'lenient',
  high: 'standard',
  max: 'paranoid',
})
```

#### `buildViolationFeedback`

```ts
buildViolationFeedback(): string | null
```

- Input contract: no arguments; uses recent violation state.
- Output contract: returns a user/model-safe feedback block or `null` when no actionable violation exists.
- Error contract: must not throw for empty stores or malformed legacy records; returns `null` instead.
- Side effects: none; read-only.
- Concurrency: safe during violation writes; may use a snapshot.
- Performance budget: p50 < 2 ms, p99 < 20 ms for recent-session data.
- Layer ownership: Layer 5, F4.2.

```ts
const feedback = fortress.buildViolationFeedback()
if (feedback) nextTurnContext.push({ role: 'system', content: feedback })
```

#### `buildCacheFriendlyConfigSummary`

```ts
buildCacheFriendlyConfigSummary(): CacheFriendlyConfigSummary
```

- Input contract: no arguments; uses active rules, effort, and recent violation counters.
- Output contract: returns `{ static, dynamic }` where `static` is stable across per-turn state changes and `dynamic` contains volatile data.
- Error contract: must not throw for empty rules; returns stable defaults.
- Side effects: none.
- Concurrency: safe during rule updates by reading a consistent snapshot.
- Performance budget: p50 < 2 ms, p99 < 10 ms for 1000 rules.
- Layer ownership: Layer 5, F4.3.

```ts
const summary = fortress.buildCacheFriendlyConfigSummary()
systemPrompt.addStablePrefix(summary.static)
systemPrompt.addDynamicTail(summary.dynamic)
```

#### `getProfileForTool`

```ts
getProfileForTool(toolName: string): ToolSandboxProfile
```

- Input contract: `toolName` is non-empty and matches the public tool identifier used by the caller.
- Output contract: returns a defensive copy of the effective profile. Unknown tools return the default safe profile.
- Error contract: throws `FortressValidationError` for empty tool names.
- Side effects: none.
- Concurrency: safe during profile updates; returns last committed profile snapshot.
- Performance budget: p50 < 1 ms.
- Layer ownership: Layer 2, F1.2 and F2.5.

```ts
const fileReadProfile = fortress.getProfileForTool('FileRead')
assert.equal(fileReadProfile.fileSystemMode, 'read-only')
```

#### `setProfileForTool`

```ts
setProfileForTool(toolName: string, profile: ToolSandboxProfile): void
```

- Input contract: `toolName` is non-empty; `profile.toolName` must equal `toolName`; modes and patterns must be valid.
- Output contract: subsequent `getProfileForTool` and `wrapWithSandbox` calls observe the new profile.
- Error contract: throws `FortressValidationError` for mismatched tool names or invalid patterns.
- Side effects: updates in-memory profile registry and invalidates derived config caches.
- Concurrency: synchronous and re-entrant; last call wins.
- Performance budget: p50 < 1 ms.
- Layer ownership: Layer 2, F1.2 and F2.5.

```ts
fortress.setProfileForTool('WebFetch', {
  toolName: 'WebFetch',
  fileSystemMode: 'no-fs',
  networkMode: 'allow-with-restrictions',
  additionalAllowPatterns: ['api.deepseek.com'],
})
```

## Layer ownership map

| API surface | Layer | Task refs | Contract role |
| --- | --- | --- | --- |
| `FortressRuntimeConfig`, runtime aliases, inherited base methods | Layer 1 boundary | `SANDBOX_FORTRESS_PLAN.md:25-28`, `SANDBOX_FORTRESS_PLAN.md:54-59` | Preserve black-box runtime boundary and existing manager behavior. |
| `wrapWithSandbox`, `ToolSandboxProfile`, `getProfileForTool`, `setProfileForTool` | Layer 2 | `SANDBOX_FORTRESS_PLAN.md:289-411` | Tailor sandbox config per tool while preserving legacy calls. |
| `RulesetLayer`, `ResourceKind`, `RuleAction`, `FortressRule`, `FortressRuleset`, `getRulesetByLayer`, `setRuleset`, `resolveEffectiveRules` | Layer 3 | `SANDBOX_FORTRESS_PLAN.md:439-669` | Load, validate, match, and resolve layered rules. |
| `FortressViolationRecord`, `IFortressViolationDb`, `enableDryRunMode`, `isDryRunMode`, inherited violation-store bridge | Layer 4 | `SANDBOX_FORTRESS_PLAN.md:673-887` | Persist, inspect, dry-run, and replay policy events. |
| `EffortLevel`, `StrictnessLevel`, `CacheFriendlyConfigSummary`, `setEffortLevel`, `getCurrentEffort`, `setStrictnessByEffort`, `buildViolationFeedback`, `buildCacheFriendlyConfigSummary` | Layer 5 | `SANDBOX_FORTRESS_PLAN.md:890-1085` | Couple policy to DeepSeek effort, feedback, cache, and auto-learn flows. |
| Canonical export binding | Cutover | `SANDBOX_FORTRESS_PLAN.md:1167-1195` | Make Fortress the canonical sandbox manager only after all layers pass tests. |

## High-risk task contract boundaries

### F2.1 Hardened adapter / rule-engine core boundary

Plan Appendix B marks F2.1 as high-risk because the conflict-resolution algorithm is a security boundary (`SANDBOX_FORTRESS_PLAN.md:1291-1296`). The user-facing task label also references the hardened adapter. This contract splits responsibilities as follows:

- Input: normalized `FortressRule[]`, active `RulesetLayer` order, a resource lookup `{ resource, target, toolName? }`.
- Output: one effective decision `{ action: RuleAction, rule?: FortressRule, reason: string }` that can be converted to `FortressRuntimeConfig`.
- Runtime wire-protocol: the only allowed Layer 1 wire output is a public `SandboxRuntimeConfig` passed to `baseSandboxManager.wrapWithSandbox(command, binShell, customConfig, abortSignal)`. No implementation may copy, persist, or depend on internal `@anthropic-ai/sandbox-runtime` source or undocumented fields.
- Compatibility: if no Fortress yaml/profile/rules are present, output must match current adapter behavior.
- Errors: invalid rules fail before command execution; runtime wrapping failures surface as adapter errors with the original cause preserved.

### F2.5 Per-tool sandbox profiles / adapter integration boundary

Plan F1.2 introduces per-tool profiles and plan F2.5 wires rule-engine output into `wrapWithSandbox` (`SANDBOX_FORTRESS_PLAN.md:333-411`, `SANDBOX_FORTRESS_PLAN.md:644-669`).

- Lookup order: explicit runtime override for `toolName`, then stored `ToolSandboxProfile`, then built-in profile, then legacy global config.
- Default profile: unknown tools inherit legacy global config with no added allow. They must not receive broader access than the base manager would have granted.
- Fallback rules: invalid profiles are rejected; missing profiles are safe defaults; missing yaml layers are empty except builtin defaults.
- Output: merged `SandboxRuntimeConfig` plus observability metadata. Only the runtime config is sent to Layer 1.

### F3.4 Longest-prefix matching / dry-run boundary

Plan places longest-prefix matching in F2.1 and dry-run in F3.4 (`SANDBOX_FORTRESS_PLAN.md:486-490`, `SANDBOX_FORTRESS_PLAN.md:823-851`). This contract binds both because dry-run depends on the same matcher.

- Matching algorithm: normalize the target, collect every matching exact, prefix, glob, and CIDR candidate, then pass the full candidate set to conflict resolution. Specificity ranks candidates only after action severity and layer rules have been considered; it must never discard a matching deny rule before the resolver sees it.
- Empty pattern: invalid at rule validation time.
- Anchors: file-system paths are normalized to absolute paths before prefix comparison; hostnames are lowercased and punycode-normalized before host/glob comparison.
- Tie-breaking: first compare action severity (`deny`, then `ask`, then `allow`), then layer priority where higher-priority user-facing layers are still constrained by lower-layer deny for defense-in-depth as described in `SANDBOX_FORTRESS_PLAN.md:472-484`.
- Dry-run output: dry-run must record the would-block decision and pass a relaxed runtime config to Layer 1; it must emit an obvious warning banner and never silently disable enforcement.

### F4.2 SQLite violation persistence / context feedback boundary

Plan places SQLite persistence in F3.1 and context feedback in F4.2 (`SANDBOX_FORTRESS_PLAN.md:681-747`, `SANDBOX_FORTRESS_PLAN.md:955-1004`). This contract keeps the persistence API stable for both.

- Schema: internal SQLite may use the richer schema in `SANDBOX_FORTRESS_PLAN.md:696-718`; public callers see `IFortressViolationDb`.
- Retention: default 90 days and 100 MB hard cap, with oldest records archived or pruned before writes fail.
- Concurrent writes: writes are serialized; readers see committed records only; duplicate IDs are idempotent no-ops or explicit conflict errors.
- Corrupt DB recovery: close the corrupt handle, rename the corrupt DB with a timestamp suffix, create a fresh schema, and record a user-visible diagnostic.
- Feedback input: `buildViolationFeedback` reads recent records and emits dynamic-context text only; it must not modify persisted records.

### F5.4 Auto-learn rule promotion / cutover boundary

Plan places auto-learn in F4.4 and cutover in F5.4 (`SANDBOX_FORTRESS_PLAN.md:1054-1085`, `SANDBOX_FORTRESS_PLAN.md:1167-1195`). This contract keeps promotion and cutover separate.

- Promotion criteria: suggest promotion after 3 approvals in one session or 5 across sessions, keyed by normalized `rule_pattern`.
- User confirmation: promotion requires explicit user consent and must support yes/no/snooze. No automatic persistent allow rule is written without confirmation.
- Demotion path: promoted rules must retain `metadata.sourceFile` and `metadata.reason` so users can remove them from the User layer yaml.
- Idempotency: accepting the same promotion twice must not duplicate yaml rules.
- Cutover: F5.4 must preserve the existing object-singleton import contract by exporting `SandboxManager` as an `IFortressSandboxManager` value, not as the `FortressSandboxManager` constructor. The preferred binding is:

```ts
export const SandboxManager: IFortressSandboxManager = new FortressSandboxManager()
```

F5.4 may expose that value through the legacy adapter shim only after all inherited and Fortress methods pass full existing and Fortress test suites.

## Error contract

Public Fortress methods use a small typed error surface. The current F0.1 scaffold may still throw the plain `notImplemented` error until methods are implemented, but the first implementation PR that throws one of the named errors must add these exports through `index.ts`.

```ts
export type FortressErrorCode =
  | 'FORTRESS_VALIDATION'
  | 'FORTRESS_CONFLICT'
  | 'FORTRESS_STORAGE'
  | 'FORTRESS_STATE'
  | 'FORTRESS_RUNTIME'

export interface FortressErrorOptions {
  cause?: unknown
  details?: Record<string, unknown>
}

export class FortressError extends Error {
  readonly code: FortressErrorCode
  readonly details?: Record<string, unknown>
  constructor(
    code: FortressErrorCode,
    message: string,
    options?: FortressErrorOptions,
  )
}

export class FortressValidationError extends FortressError {
  constructor(message: string, options?: FortressErrorOptions)
}

export class FortressConflictError extends FortressError {
  constructor(message: string, options?: FortressErrorOptions)
}

export class FortressStorageError extends FortressError {
  constructor(message: string, options?: FortressErrorOptions)
}

export class FortressStateError extends FortressError {
  constructor(message: string, options?: FortressErrorOptions)
}

export class FortressRuntimeError extends FortressError {
  constructor(message: string, options?: FortressErrorOptions)
}
```

Validation errors cover invalid layers, empty patterns, malformed profiles, and invalid limits. Conflict errors cover irreconcilable rule or layer combinations. Storage errors wrap SQLite or persistence failures. State errors cover closed managers, unavailable DB handles, and uninitialized runtime state. Runtime errors wrap failures returned by the base adapter or `@anthropic-ai/sandbox-runtime` without exposing private runtime internals.

## Public/private boundary

Current F0.3 public imports must use only symbols exported by the scaffolded `index.ts`:

```ts
import {
  FortressSandboxManager,
  type IFortressSandboxManager,
  type FortressRule,
  type RulesetLayer,
  type ToolSandboxProfile,
} from './sandbox-fortress/index.js'
```

After F5.4 cutover, callers may import the singleton value:

```ts
import {
  SandboxManager,
  type IFortressSandboxManager,
} from './sandbox-fortress/index.js'
```

After the first implementation PR adds typed Fortress errors, callers may import the public error classes:

```ts
import {
  FortressValidationError,
  FortressStorageError,
} from './sandbox-fortress/index.js'
```

Public export surface:

- Runtime values: `FortressSandboxManager`; `SandboxManager` after F5.4 cutover as an `IFortressSandboxManager` singleton.
- Manager type: `IFortressSandboxManager`.
- Type exports from `types.ts`: `FortressRuntimeConfig`, `FortressViolationEvent`, `FortressAskCallback`, `FortressDependencyCheck`, `RulesetLayer`, `ResourceKind`, `RuleAction`, `FortressRule`, `FortressRuleset`, `EffortLevel`, `StrictnessLevel`, `ToolSandboxProfile`, `FortressViolationRecord`, `IFortressViolationDb`, `CacheFriendlyConfigSummary`.
- Error exports: `FortressError`, `FortressValidationError`, `FortressConflictError`, `FortressStorageError`, `FortressStateError`, `FortressRuntimeError`, `FortressErrorCode`, and `FortressErrorOptions` once the first implementation PR needs typed Fortress errors.

Private/internal surfaces:

- Deep imports from `adapter/`, `rule-engine/`, `observability/`, and `deepseek/`.
- Direct imports from `manager.ts` other than through `index.ts`.
- Any helper types that are not re-exported by `index.ts`.
- Any `@anthropic-ai/sandbox-runtime` import outside Fortress-owned type aliases and the adapter boundary.

Deep imports are prohibited because F1-F5 can reorganize implementation files without public API changes.

## Test contract

The F0.2 harness lives at `packages/deep-code/test/sandbox-fortress/harness.mjs`.

### `createMockBaseSandboxManager`

Guarantees an in-memory `ISandboxManager`-shaped object with configurable settings, cloned config return values, a `wrappedCommands` log, and a mock violation store. Unit tests must use this helper when testing manager delegation, config merging, profile application, and adapter behavior without spawning the OS sandbox.

### `createViolationStore`

Current harness implementation contains a local `createViolationStore` helper but does not export it. Until that changes, tests must obtain the store through:

```js
const base = createMockBaseSandboxManager()
const store = base.getSandboxViolationStore()
```

If F0.2 or later exports `createViolationStore`, it must provide the same add/clear/list/subscribe semantics as the store returned by the mock manager.

### `fixture`

```js
fixture(name): Promise<string>
```

Reads a text fixture relative to `test/sandbox-fortress/fixtures`. Tests must use it for red-team payloads, yaml examples, replay logs, and benchmark inputs that should stay reviewable in git.

### `spawnTestCommand`

```js
spawnTestCommand(cmd, sandboxConfig = {}): Promise<{
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}>
```

Spawns a command with optional `cwd`, `env`, `signal`, and `timeoutMs`. Red-team and integration tests must use this helper with explicit timeouts; long-running tests must not spawn raw child processes directly.

### `expectViolation`

```js
expectViolation(violation, matchers): void
```

Asserts that a violation exists and matches exact, regex, or predicate matchers. Tests must use it for violation-shape assertions instead of ad hoc partial checks.

## Versioning policy

Sandbox Fortress is internal until package extraction (`SANDBOX_FORTRESS_PLAN.md:1199-1208`), but this contract still follows SemVer-style discipline:

- Patch: documentation clarifications, added examples, internal implementation changes that preserve public exports and behavior.
- Minor: additive public methods/types, added enum union values with safe defaults, optional fields, or new private implementation modules.
- Major: removed/renamed public methods, removed union values, changed default-deny semantics, changed layer ordering, changed persistence retention guarantees, or made deep imports necessary.

Experimental methods may change before F5.4 cutover, but every change must update this document in the same PR.

## Out of scope (explicitly NOT contracted)

- Internal cache data structures in the rule engine and observability layer.
- Exact yaml parser library choice, provided public validation and errors match the contract.
- SQLite table names beyond the public `IFortressViolationDb` behavior, except where F3.1 docs explicitly freeze a schema.
- TUI layout details for `/sandbox stats`, `/sandbox map`, dry-run banners, and auto-learn prompts.
- Exact benchmark runner implementation, provided the F5.3 budgets are measured.
- Any public npm package extraction details before F5.5.
- Any runtime behavior that would require copying or inspecting private `@anthropic-ai/sandbox-runtime` internals.

## Open contract questions

1. Current `IFortressSandboxManager` exposes 13 Fortress-specific methods in `packages/deep-code/src/sandbox-fortress/manager.ts:22-38`, while the task context says 14 new methods and `SANDBOX_FORTRESS_PLAN.md:276-279` mentions "New methods (28 methods listed)". This contract covers all 13 current methods and all 32 inherited `ISandboxManager` methods. No type changes were made.
2. The requested high-risk labels differ from the plan: longest-prefix matching is specified under F2.1, SQLite persistence under F3.1, context feedback under F4.2, auto-learn under F4.4, and cutover under F5.4. This document maps the requested boundaries to the actual plan sections without editing the plan.
3. The task request names `createViolationStore` as a harness API, but current `harness.mjs` does not export it. This document treats the mock manager's `getSandboxViolationStore()` as the public test path until a later task intentionally exports the helper.
4. Resolved in F0.3-fix: canonical path is repo-root `docs/sandbox-fortress/API_CONTRACT.md`.
