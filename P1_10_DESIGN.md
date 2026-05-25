# P1.10 Design - GrowthBook Strip, Statsig Verification, OTel Rename

Status: scan and path recommendation
Date: 2026-05-25
Base: `194c35795c4a67125e910704959ab0268690d423`
Branch: `phase1/p1-10-scan`

## Summary

- P1.8 and P1.9 are closed: `packages/deep-code/src/` has 0 `@anthropic-ai/sdk` imports.
- P1.10 has three separate concerns: GrowthBook removal, Statsig residue verification, and OpenTelemetry namespace rename.
- GrowthBook is still an active runtime client in `packages/deep-code/src/services/analytics/growthbook.ts`.
- The GrowthBook client is 1155 LOC and imports `@growthbook/growthbook` directly.
- Direct GrowthBook consumer audit found 102 source files with a static or dynamic `growthbook.js` import.
- Helper-reference audit found 105 source files and 129 helper call sites outside `growthbook.ts`.
- Flag/config extraction found 80 distinct GrowthBook or Statsig-compat keys.
- Statsig SDK/package residue is 0, but semantic Statsig compatibility strings remain.
- OTel namespace audit found 7 source files and 21 source occurrences of `claude_code.` or `com.anthropic.claude_code.`.
- Perf-baseline audit found 8 JSON metric keys that need the `deepcode_` prefix.
- Recommendation: Path C, a local feature-flag shim plus mechanical consumer import migration.

## Phase A - Inventory (3 sub-systems)

### A1. GrowthBook usage inventory

#### A1.1 Audit result

- Client file: `packages/deep-code/src/services/analytics/growthbook.ts`
- Client size: 1155 LOC.
- Runtime package import: `import { GrowthBook } from '@growthbook/growthbook'`
- Direct source importers: 102 files.
- Static source importers: 101 files.
- Dynamic source importers: 1 file (`src/entrypoints/init.ts`).
- Helper-reference files outside implementation: 105 files.
- Helper call sites outside implementation: 129.
- Distinct flag/config/gate keys: 80.
- Raw `growthbook` text appears in more files because comments, generated types, test stubs, and dist references mention it.
- The earlier planning estimate of 145 consumer files does not match the current tree as files.
- The closest current-tree number is call-site-level, not file-level.

#### A1.2 `growthbook.ts` responsibility breakdown

| Lines | Area | Notes |
|---:|---|---|
| 1-27 | Imports | `@growthbook/growthbook`, config, auth, logging, user metadata, 1P experiment logger |
| 29-57 | Types | `GrowthBookUserAttributes`, malformed feature payload type |
| 59-107 | Module state | singleton client, process handlers, auth state, exposure maps, remote eval cache, refresh signal |
| 109-157 | Listener safety | `callSafe`, `onGrowthBookRefresh` subscription and catch-up microtask |
| 160-202 | Env overrides | `CLAUDE_INTERNAL_FC_OVERRIDES`, `hasGrowthBookEnvOverride` |
| 205-286 | Local config overrides | `/config` gate override read/write, clear, and refresh emission |
| 293-315 | Exposure logging | session dedupe and `logGrowthBookExperimentTo1P` calls |
| 317-391 | Remote eval payload processing | malformed `value` to `defaultValue` transformation, experiment metadata capture, local value cache |
| 397-415 | Disk sync | wholesale write to `cachedGrowthBookFeatures` |
| 420-448 | Enablement and API host | depends on 1P event logging; proxy host attribute |
| 452-486 | User attributes | device/session/platform/org/account/user/subscription/app metadata |
| 488-617 | Client construction | GrowthBook singleton, auth headers, `remoteEval: true`, init, payload processing, process cleanup |
| 620-662 | Blocking init | auth change re-create and periodic refresh setup |
| 667-788 | Feature value APIs | blocking, cached, and refresh-window variants |
| 792-836 | Statsig gate compatibility | `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` |
| 840-887 | Security gate compatibility | `checkSecurityRestrictionGate` with reinit wait and cache priority |
| 892-934 | Entitlement gate compatibility | `checkGate_CACHED_OR_BLOCKING` |
| 938-1010 | Auth refresh and reset | destroy/recreate, cache clearing, memo cache clearing |
| 1012-1121 | Periodic refresh | 20 min ant, 6h external, light refresh, stop helper |
| 1128-1155 | Dynamic config wrappers | Statsig API parity wrappers around feature values |

#### A1.3 Exported API currently consumed

| Export | Current role | Future Path C behavior |
|---|---|---|
| `getFeatureValue_CACHED_MAY_BE_STALE` | primary sync flag/config read | return `defaultValue` |
| `getFeatureValue_CACHED_WITH_REFRESH` | legacy sync read with refresh interval | return `defaultValue` |
| `getDynamicConfig_CACHED_MAY_BE_STALE` | sync object config read | return `defaultValue` |
| `getDynamicConfig_BLOCKS_ON_INIT` | async object config read | resolve `defaultValue` |
| `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` | legacy boolean gate | return `false` unless caller is re-defaulted |
| `checkSecurityRestrictionGate` | async security gate | resolve `false` unless caller is re-defaulted |
| `checkGate_CACHED_OR_BLOCKING` | async entitlement gate | resolve `false` unless caller is re-defaulted |
| `hasGrowthBookEnvOverride` | special ant override check | return `false` |
| `onGrowthBookRefresh` | refresh listener | return no-op unsubscribe |
| `initializeGrowthBook` | startup/background init | resolve `null` or no-op |
| `refreshGrowthBookAfterAuthChange` | auth flow notification | no-op |
| `resetGrowthBook` | reset singleton | no-op |
| `getAllGrowthBookFeatures` | settings UI inventory | return `{}` |
| `getGrowthBookConfigOverrides` | settings UI overrides | return `{}` |
| `setGrowthBookConfigOverride` | settings UI write | no-op |
| `clearGrowthBookConfigOverrides` | settings UI clear | no-op |
| `GrowthBookUserAttributes` | 1P event logger type import | replace or move type if still needed |

#### A1.4 Direct consumer summary by area

- `src/`: 4 files.
- `src/cli/`: 1 file.
- `src/commands/`: 4 files.
- `src/components/`: 13 files.
- `src/constants/`: 1 file.
- `src/coordinator/`: 1 file.
- `src/entrypoints/`: 1 file.
- `src/hooks/`: 5 files.
- `src/interactiveHelpers.tsx`: 1 file.
- `src/keybindings/`: 1 file.
- `src/memdir/`: 3 files.
- `src/query/`: 1 file plus `src/query.ts`.
- `src/screens/`: 1 file.
- `src/services/`: 19 files outside `services/analytics`.
- `src/services/analytics/`: 4 consumer files plus the client itself.
- `src/tools/`: 20 files.
- `src/utils/`: 24 top-level utility files.
- `src/utils/computerUse/`: 1 file.
- `src/utils/hooks/`: 1 file.
- `src/utils/model/`: 1 file.
- `src/utils/nativeInstaller/`: 1 file.
- `src/utils/permissions/`: 5 files.
- `src/utils/plugins/`: 3 files.
- `src/utils/shell/`: 1 file.
- `src/utils/telemetry/`: 2 files.

#### A1.5 Helper call-site counts

| Helper | Call sites outside `growthbook.ts` |
|---|---:|
| `getFeatureValue_CACHED_MAY_BE_STALE` | 93 |
| `getFeatureValue_CACHED_WITH_REFRESH` | 4 |
| `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` | 21 |
| `checkSecurityRestrictionGate` | 1 |
| `hasGrowthBookEnvOverride` | 1 |
| `initializeGrowthBook` | 3 |
| `onGrowthBookRefresh` | 3 |
| `refreshGrowthBookAfterAuthChange` | 2 |
| `resetGrowthBook` | 1 |
| Total | 129 |

#### A1.6 Distinct flags and defaults

- Distinct key count: 80.
- Boolean default `false` dominates rollout or kill-switch usage.
- Boolean default `true` exists where the feature is already GA and GrowthBook is a kill switch.
- Object defaults exist for `tengu_auto_mode_config`, cron jitter, session memory, telemetry, and 1P event batching.
- `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` has no explicit default argument; current fallback is `false`.
- Path C must preserve both two-argument and one-argument helper signatures.
- Where a production GrowthBook value differs from the checked-in default, removal will intentionally shift behavior to the checked-in default.
- Such shifts should be surfaced flag-by-flag before deleting the client.

### A2. Statsig verification

#### A2.1 SDK/package status

- No `@statsig` package import was found.
- No `statsig-node`, `statsig-js`, or `statsig-react` package import was found.
- `packages/deep-code/package.json` has no Statsig dependency.
- Root `package.json` and `package-lock.json` have no Statsig package dependency.
- This means the Statsig SDK removal is already complete at dependency/import level.

#### A2.2 Semantic residue status

- Raw `Statsig`/`statsig` strings are not zero.
- Remaining strings are compatibility names, cached config fields, comments, analytics wording, and generated schema comments.
- Important remaining config fields:
  - `cachedStatsigGates`
  - `cachedStatsigDynamicConfigs`
  - `recommendedSubscription?: string // Cached config value from Statsig (deprecated)`
- Important remaining helper:
  - `checkStatsigFeatureGate_CACHED_MAY_BE_STALE`
- Important remaining comments:
  - startup/headless profiler comments still say "log to Statsig"
  - generated event schema comments mention historical Statsig source tables
  - prompt/cache comments point to old Statsig console URLs
- Conclusion: "Statsig SDK/package residue = 0" is true.
- Conclusion: "all textual Statsig residue = 0" is false in the current tree.
- Recommended handling: fold semantic Statsig compatibility cleanup into GrowthBook strip follow-ups, not OTel rename.

### A3. OpenTelemetry rename inventory

#### A3.1 Decision doc

- `docs/otel-rename.md` exists and is 85 lines.
- Status: Decided.
- Decision date: 2026-05-10.
- Namespace mapping is:
  - `claude_code.*` -> `deepcode.*`
  - `com.anthropic.claude_code.*` -> `ai.deepcode.*`
- No dual-emit window.
- Chosen perf-gate transition is Option a: temporary mapping layer in `scripts/perf-compare.mjs`.

#### A3.2 Source files with OTel namespace residue

- Source file count: 7.
- Source occurrence count: 21.
- `packages/deep-code/src/bootstrap/state.ts`: 8 metric counter names.
- `packages/deep-code/src/services/analytics/firstPartyEventLogger.ts`: 1 instrumentation scope name.
- `packages/deep-code/src/services/analytics/firstPartyEventLoggingExporter.ts`: 1 instrumentation scope comparison.
- `packages/deep-code/src/utils/telemetry/events.ts`: 1 event body prefix.
- `packages/deep-code/src/utils/telemetry/instrumentation.ts`: 2 instrumentation scope names.
- `packages/deep-code/src/utils/telemetry/sessionTracing.ts`: 7 tracer/span names.
- `packages/deep-code/src/utils/workloadContext.ts`: 1 comment-only server sanitizer reference.

#### A3.3 Per-occurrence classification

| File | Count | Kind |
|---|---:|---|
| `src/bootstrap/state.ts` | 8 | metric counter names |
| `src/services/analytics/firstPartyEventLogger.ts` | 1 | log instrumentation scope |
| `src/services/analytics/firstPartyEventLoggingExporter.ts` | 1 | log instrumentation scope filter |
| `src/utils/telemetry/events.ts` | 1 | event body prefix |
| `src/utils/telemetry/instrumentation.ts` | 2 | log instrumentation scope names |
| `src/utils/telemetry/sessionTracing.ts` | 7 | tracer and span names |
| `src/utils/workloadContext.ts` | 1 | comment-only reference |

#### A3.4 Perf-baseline JSON keys

- `packages/deep-code/scripts/perf-baseline.mjs` currently emits 8 labels.
- Every emitted label should gain the `deepcode_` prefix.
- `packages/deep-code/test/perf-baseline.test.mjs` hard-codes the current unprefixed labels.
- `packages/deep-code/scripts/perf-compare.mjs` compares labels from base/head reports.
- The first rename PR needs a temporary mapping layer for old baseline keys.
- Without the mapping layer, the perf gate can silently compare zero overlapping metrics.

#### A3.5 Generated proto and schema files

- `src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts` exists and is 865 LOC.
- `src/types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts` exists and is 223 LOC.
- `firstPartyEventLoggingExporter.ts` imports both generated event modules.
- `services/analytics/metadata.ts` imports `EnvironmentMetadata` from the `claude_code` generated module.
- The generated path `events_mono/claude_code/v1` is itself product-named.
- The GrowthBook experiment generated event is linked to GrowthBook strip because experiment exposure logging is emitted only by `growthbook.ts`.
- P1.10.A should decide whether generated files are manually renamed or regenerated from `.proto` sources.

## Phase B - Path options for GrowthBook

### B1. Trade-off table

| Path | Description | Estimated touches | Pros | Cons |
|---|---|---:|---|---|
| A | Complete deletion and inline defaults at every call site | 100-130 source files | Full removal, no compatibility layer | Large behavior review, many call-site edits, defaults must be rechecked one by one |
| B | Replace `growthbook.ts` with in-place no-op stub | 1-5 files | Smallest blast radius, fastest | Keeps analytics path/name forever, hides debt, still leaves consumers coupled to old module |
| C | Add local feature flag shim and migrate imports mechanically | 110-130 files across batches | Clean boundary, mirrors P1.8 shim migration, incremental, reviewable | Many import-only touches, needs compatibility API surface |

### B2. Path A - Complete deletion

- Delete `services/analytics/growthbook.ts`.
- Replace each `getFeatureValue_CACHED_MAY_BE_STALE(flag, defaultValue)` with the literal default or a local constant.
- Replace each `getFeatureValue_CACHED_WITH_REFRESH(flag, defaultValue, refreshMs)` with default.
- Replace dynamic config reads with default config objects.
- Replace `checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate)` with `false` or an explicitly chosen default.
- Replace `checkSecurityRestrictionGate(gate)` and `checkGate_CACHED_OR_BLOCKING(gate)` with async `false` or explicit default logic.
- Remove listener/init/reset calls.
- Remove GrowthBook experiment exposure logging.
- Delete generated GrowthBook experiment event only after exporter references are removed.
- Net effect: maximum cleanup.
- Main risk: hidden production flag values might have diverged from checked-in defaults.
- Main cost: each call site becomes a behavior decision rather than an import-only migration.

### B3. Path B - Local stub in place

- Keep `services/analytics/growthbook.ts` path.
- Remove `@growthbook/growthbook` import and network/client logic.
- Keep exported helper functions with same names.
- Return `defaultValue` for feature/dynamic config helpers.
- Return `false` for Statsig/gate helpers without default arguments.
- Keep refresh/listener APIs as no-op.
- Keep settings UI override APIs as `{}`/no-op.
- Net effect: removes runtime SDK pull with minimal file touches.
- Main benefit: smallest PR and least merge risk.
- Main drawback: old GrowthBook path remains the permanent API.
- This is operationally safe but architecturally untidy.

### B4. Path C - Hybrid shim and mechanical migration

- Create `packages/deep-code/src/utils/featureFlags.ts`.
- Export the GrowthBook-compatible helper API from that module.
- Stub implementations return caller defaults or safe false/no-op values.
- Migrate consumers from `services/analytics/growthbook.js` to `utils/featureFlags.js` in batches.
- Keep call shapes unchanged during migration.
- Delete `services/analytics/growthbook.ts` after no source consumer imports it.
- Remove GrowthBook experiment exposure logging and generated GrowthBook event dependencies in the runtime cleanup PR.
- This mirrors the P1.8 SDK shim pattern: scaffold first, migrate consumers mechanically, delete old runtime later, refresh dist at the end.
- Main cost is file count.
- Main benefit is reviewability and a clean final boundary.

### B5. Recommended path

Recommendation: Path C.

Path C gives a clear local boundary without forcing 80 flag default decisions into the same PR that removes the remote feature system. It also follows the exact migration shape that worked in P1.8: introduce a local compatibility module, move consumers mechanically in bounded batches, then delete the old implementation when import count reaches zero. Compared with Path A, this avoids mixing behavior edits with import-path churn. Compared with Path B, it prevents `services/analytics/growthbook.ts` from becoming a permanent stub module.

## Phase C - Recommended path and rationale

### C1. Why Path C fits this repo

- P1.8 proved the compatibility-shim migration model across 97 SDK consumers.
- Consumer migrations can stay import-only with no JSX/business logic changes.
- File caps can be respected by batching directories.
- The final delete PR has a simple import-count gate.
- The new module can be named around product intent (`featureFlags`) instead of vendor implementation (`growthbook`).
- The shim can intentionally encode the post-vendor behavior: defaults only, no network, no cache, no exposure events.
- It separates risky review topics: flag defaults, OTel rename, generated proto naming, and dist refresh.

### C2. Required compatibility surface for Path C

- `getFeatureValue_CACHED_MAY_BE_STALE<T>(feature: string, defaultValue: T): T`
- `getFeatureValue_CACHED_WITH_REFRESH<T>(feature: string, defaultValue: T, refreshIntervalMs: number): T`
- `getDynamicConfig_CACHED_MAY_BE_STALE<T>(configName: string, defaultValue: T): T`
- `getDynamicConfig_BLOCKS_ON_INIT<T>(configName: string, defaultValue: T): Promise<T>`
- `checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate: string): boolean`
- `checkSecurityRestrictionGate(gate: string): Promise<boolean>`
- `checkGate_CACHED_OR_BLOCKING(gate: string): Promise<boolean>`
- `hasGrowthBookEnvOverride(feature: string): boolean`
- `onGrowthBookRefresh(listener: () => void | Promise<void>): () => void`
- `initializeGrowthBook(): Promise<null>`
- `refreshGrowthBookAfterAuthChange(): void`
- `resetGrowthBook(): void`
- `getAllGrowthBookFeatures(): Record<string, unknown>`
- `getGrowthBookConfigOverrides(): Record<string, unknown>`
- `setGrowthBookConfigOverride(feature: string, value: unknown): void`
- `clearGrowthBookConfigOverrides(): void`

## Phase D - Sub-PR breakdown

### P1.10.A - OTel rename first

- Scope: rename `claude_code.*` to `deepcode.*`.
- Scope: rename `com.anthropic.claude_code.*` to `ai.deepcode.*`.
- Scope: prefix perf-baseline labels with `deepcode_`.
- Scope: add temporary perf-compare mapping from old base labels to new head labels.
- Scope: update perf-baseline tests for new labels.
- Source files: 7 OTel files.
- Script files: `perf-baseline.mjs`, `perf-compare.mjs`.
- Test files: `perf-baseline.test.mjs`, possibly workflow test fixture if it asserts labels.
- Estimated touches: 10-12 files.
- Risk: generated proto path decision.
- Verification: `bun test`, `node --test test/perf-baseline.test.mjs`, perf compare with old/new fixture labels.

### P1.10.A.cleanup - remove temporary perf mapping

- Run after one successful full perf-baseline cycle with new `deepcode_` keys.
- Remove mapping layer from `scripts/perf-compare.mjs`.
- Estimated touches: 1 file.
- Verification: perf compare still compares same-name new keys.

### P1.10.B.0 - featureFlags scaffold

- Create `src/utils/featureFlags.ts`.
- Implement compatibility API listed in C4.
- No GrowthBook import.
- No Statsig import.
- No network.
- No disk cache.
- No exposure logging.
- Return defaults or safe false/no-op values.
- Consider a node:test-compatible unit test only if it does not repeat the P1.8 buffer-test mistake.
- Estimated touches: 1-2 files.

### P1.10.B.a - migrate tools consumers

- Migrate `src/tools/` direct imports from `services/analytics/growthbook.js` to `utils/featureFlags.js`.
- Keep call shapes unchanged.
- Expected files: 20 direct tool files.
- Hard cap suggestion: 25 files.
- Verification: no `growthbook.js` imports under `src/tools/`.

### P1.10.B.b - migrate utils consumers

- Migrate top-level `src/utils/` and selected subdirectories.
- Current direct utility importers are 37 files including permissions/plugins/telemetry subdirectories.
- Split if needed to keep file caps below 30.
- Keep call shapes unchanged.
- Verification: no `growthbook.js` imports under migrated utility scopes.

### P1.10.B.c - migrate services consumers

- Migrate non-analytics `src/services/` direct imports.
- Current direct service importers outside analytics: 19 files.
- Special attention: `SessionMemory`, compacting, MCP, runtime token policy, settings sync, tips.
- Keep call shapes unchanged.
- Verification: no `growthbook.js` imports under non-analytics service scopes.

### P1.10.B.d - migrate components, commands, hooks, cli, query, screens

- Migrate UI and command consumers.
- Current direct consumers in this group: about 30 files.
- Split if review size gets too large.
- Special attention: `main.tsx`, `interactiveHelpers.tsx`, `cli/print.ts`, `screens/REPL.tsx`.
- Keep call shapes unchanged.

### P1.10.B.runtime - delete GrowthBook runtime

- Delete `src/services/analytics/growthbook.ts`.
- Remove `@growthbook/growthbook` source import.
- Remove experiment exposure runtime path.
- Update `firstPartyEventLogger.ts` if `GrowthBookUserAttributes` remains only for experiment logging.
- Update `firstPartyEventLoggingExporter.ts` if `GrowthbookExperimentEvent` becomes unused.
- Delete or defer `types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts` depending on exporter cleanup.
- Remove settings UI GrowthBook override affordances if they become dead UI.
- Verification: `rg "growthbook\\.js" packages/deep-code/src` returns 0 except deliberate comments if any.
- Verification: `rg "@growthbook/growthbook" packages/deep-code/src` returns 0.

### P1.10.B.semantic - Statsig wording cleanup

- Rename compatibility helper names only after all GrowthBook imports are gone.
- Remove `cachedStatsigGates`/`cachedStatsigDynamicConfigs` if config migration allows.
- Update comments that say "log to Statsig" when the actual logger is 1P/OTel.
- Update old Statsig console URL comments if still meaningful.
- This can be combined with runtime cleanup or kept separate.

### P1.10.Z - dist refresh

- Rebuild `packages/deep-code/dist/deepcode-full.mjs`.
- Expected effect: GrowthBook SDK code is stripped after source imports reach 0.
- Check `@growthbook/growthbook` literal count in dist before/after.
- Check `node_modules/@growthbook/growthbook` bundle block disappears.
- Verify idempotent rebuild.

### P1.10.cite - close phase

- Update `EXECUTION_LOG.md`.
- Cite scan, OTel rename, featureFlags scaffold, migration batches, runtime deletion, dist refresh.
- Advance A track to the next phase after P1.10.

## Phase E - Risk assessment

### E1. Feature flag default value correctness

- Current GrowthBook values may differ from checked-in defaults.
- Removing GrowthBook means checked-in defaults become authoritative.
- Defaults of `false` are common but may disable behavior currently enabled in production.
- Defaults of `true` are often GA features where GrowthBook is a kill switch.
- Object defaults may be partial and rely on remote config in production.
- `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` call sites have no explicit default and currently fall back to `false`.
- Mitigation: keep Path C stub returning defaults first, then do targeted behavior PRs only when a default needs changing.
- Mitigation: identify any flags whose production desired state is known before B.runtime.
- Mitigation: for GA features, set the call-site default to the intended GA state before deleting the vendor.

### E2. Async gate behavior

- `checkSecurityRestrictionGate` currently waits for reinitialization if it is in progress.
- A stub will resolve immediately.
- This changes timing but should not change final value if final behavior is default-only.
- Permission/security gates default to false unless explicitly re-defaulted.
- Any gate that must stay enabled needs an explicit local default.

### E3. Listener and refresh behavior

- `onGrowthBookRefresh` currently rebuilds long-lived subscribers when remote values change.
- A stub can return an unsubscribe and never fire.
- Consumers such as `useMainLoopModel` and `useSkillsChange` should be checked for reliance on refresh churn.
- If defaults are static, losing refresh events is intended.
- If local settings should still trigger rebuilds, those settings should own their own signal.

### E4. Settings UI and override behavior

- `/config` gate overrides currently write `growthBookOverrides`.
- Path C can initially no-op those APIs.
- A later cleanup should remove dead UI affordances.
- Leaving UI controls that do nothing is worse than removing them after migration.

### E5. Experiment exposure logging

- `growthbook.ts` logs GrowthBook experiment exposure to 1P events.
- Removing GrowthBook removes experiment exposure events.
- Generated `growthbook_experiment_event.ts` may become dead after runtime deletion.
- Exporter logic should be checked for mixed event unions and dead branches.

### E6. Perf-baseline JSON key transition

- Old key: `jsonl_parse_1k_msgs_ms`.
- New key: `deepcode_jsonl_parse_1k_msgs_ms`.
- The same pattern applies to all 8 metrics.
- `perf-compare.mjs` compares metric labels.
- Without mapping, old base and new head have no overlapping keys.
- A silent pass would be worse than an explicit transition.
- Option a from `docs/otel-rename.md` is the right path.
- Remove the mapping after a full new-baseline cycle.

### E7. Generated proto naming

- `events_mono/claude_code/v1` is a path-level product name.
- Manual edit of generated TS may be faster but less reproducible.
- Regeneration is preferable if proto source and generator are available.
- If source proto is unavailable, document manual generated edit as intentional.
- `growthbook_experiment_event.ts` is tied to GrowthBook removal and should not be renamed blindly in OTel PR unless still used.

## Phase F - Key decision points

### Q1. GrowthBook path

- Options: A complete deletion, B in-place stub, C local shim plus migration.
- Recommendation: C.
- Reason: separates import migration from behavior decisions and gives a clean final boundary.

### Q2. OTel rename fidelity

- `docs/otel-rename.md` already decides hard cutover.
- Any dual-emit or namespace deviation needs a new decision.
- Current recommendation: follow the decided hard cutover.

### Q3. Perf mapping layer

- Option a: add temporary mapping in `perf-compare.mjs`.
- Option b: skip perf gate for rename PR.
- Recommendation: Option a.
- Reason: keeps the perf gate meaningful during the first key-prefix PR.

### Q4. Proto regeneration

- Prefer regeneration from `.proto` sources if available.
- If generator/source is not available, manual generated edit is acceptable only with explicit PR body note.
- The scan found generated source files but did not find the generator workflow.

### Q5. Sub-PR cadence

- Recommendation: OTel first, then GrowthBook shim/migration.
- Reason: OTel is smaller and has an existing decision doc.
- GrowthBook can then proceed with P1.8-style batching.

### Q6. `featureFlags.ts` location

- Recommendation: `src/utils/featureFlags.ts`.
- Reason: consumers are scattered across tools, services, UI, CLI, and hooks; `utils/` is the least vendor-specific shared home.
- Avoid `services/analytics/` because the future behavior is not analytics.
- Avoid `types/` because runtime helpers are included.

## Phase G - Reference appendix

### G1. Direct GrowthBook consumer files

1. `packages/deep-code/src/cli/print.ts`
2. `packages/deep-code/src/commands/brief.ts`
3. `packages/deep-code/src/commands/logout/logout.tsx`
4. `packages/deep-code/src/commands/thinkback-play/index.ts`
5. `packages/deep-code/src/commands/thinkback/index.ts`
6. `packages/deep-code/src/components/FeedbackSurvey/useMemorySurvey.tsx`
7. `packages/deep-code/src/components/FeedbackSurvey/usePostCompactSurvey.tsx`
8. `packages/deep-code/src/components/LogoV2/EmergencyTip.tsx`
9. `packages/deep-code/src/components/PromptInput/PromptInputHelpMenu.tsx`
10. `packages/deep-code/src/components/Settings/Config.tsx`
11. `packages/deep-code/src/components/Spinner.tsx`
12. `packages/deep-code/src/components/TokenWarning.tsx`
13. `packages/deep-code/src/components/messages/UserPromptMessage.tsx`
14. `packages/deep-code/src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx`
15. `packages/deep-code/src/components/permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx`
16. `packages/deep-code/src/constants/prompts.ts`
17. `packages/deep-code/src/coordinator/coordinatorMode.ts`
18. `packages/deep-code/src/entrypoints/init.ts`
19. `packages/deep-code/src/hooks/useAwaySummary.ts`
20. `packages/deep-code/src/hooks/useDynamicConfig.ts`
21. `packages/deep-code/src/hooks/useGlobalKeybindings.tsx`
22. `packages/deep-code/src/hooks/useMainLoopModel.ts`
23. `packages/deep-code/src/hooks/useSkillsChange.ts`
24. `packages/deep-code/src/interactiveHelpers.tsx`
25. `packages/deep-code/src/keybindings/loadUserBindings.ts`
26. `packages/deep-code/src/main.tsx`
27. `packages/deep-code/src/memdir/memdir.ts`
28. `packages/deep-code/src/memdir/paths.ts`
29. `packages/deep-code/src/memdir/teamMemPaths.ts`
30. `packages/deep-code/src/query.ts`
31. `packages/deep-code/src/query/config.ts`
32. `packages/deep-code/src/screens/REPL.tsx`
33. `packages/deep-code/src/services/PromptSuggestion/promptSuggestion.ts`
34. `packages/deep-code/src/services/SessionMemory/sessionMemory.ts`
35. `packages/deep-code/src/services/analytics/firstPartyEventLogger.ts`
36. `packages/deep-code/src/services/analytics/sink.ts`
37. `packages/deep-code/src/services/analytics/sinkKillswitch.ts`
38. `packages/deep-code/src/services/autoDream/autoDream.ts`
39. `packages/deep-code/src/services/autoDream/config.ts`
40. `packages/deep-code/src/services/compact/autoCompact.ts`
41. `packages/deep-code/src/services/compact/compact.ts`
42. `packages/deep-code/src/services/compact/sessionMemoryCompact.ts`
43. `packages/deep-code/src/services/compact/timeBasedMCConfig.ts`
44. `packages/deep-code/src/services/extractMemories/extractMemories.ts`
45. `packages/deep-code/src/services/mcp/channelAllowlist.ts`
46. `packages/deep-code/src/services/mcp/channelPermissions.ts`
47. `packages/deep-code/src/services/mcp/vscodeSdkMcp.ts`
48. `packages/deep-code/src/services/runtime/tokenPolicy.ts`
49. `packages/deep-code/src/services/settingsSync/index.ts`
50. `packages/deep-code/src/services/tips/tipRegistry.ts`
51. `packages/deep-code/src/tools/AgentTool/AgentTool.tsx`
52. `packages/deep-code/src/tools/AgentTool/builtInAgents.ts`
53. `packages/deep-code/src/tools/AgentTool/prompt.ts`
54. `packages/deep-code/src/tools/AgentTool/runAgent.ts`
55. `packages/deep-code/src/tools/BashTool/bashPermissions.ts`
56. `packages/deep-code/src/tools/BashTool/shouldUseSandbox.ts`
57. `packages/deep-code/src/tools/BriefTool/BriefTool.ts`
58. `packages/deep-code/src/tools/FileEditTool/FileEditTool.ts`
59. `packages/deep-code/src/tools/FileReadTool/FileReadTool.ts`
60. `packages/deep-code/src/tools/FileReadTool/limits.ts`
61. `packages/deep-code/src/tools/FileWriteTool/FileWriteTool.ts`
62. `packages/deep-code/src/tools/ScheduleCronTool/prompt.ts`
63. `packages/deep-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`
64. `packages/deep-code/src/tools/TodoWriteTool/TodoWriteTool.ts`
65. `packages/deep-code/src/tools/ToolSearchTool/prompt.ts`
66. `packages/deep-code/src/tools/WebSearchTool/WebSearchTool.ts`
67. `packages/deep-code/src/utils/advisor.ts`
68. `packages/deep-code/src/utils/agentSwarmsEnabled.ts`
69. `packages/deep-code/src/utils/analyzeContext.ts`
70. `packages/deep-code/src/utils/api.ts`
71. `packages/deep-code/src/utils/attachments.ts`
72. `packages/deep-code/src/utils/autoUpdater.ts`
73. `packages/deep-code/src/utils/betas.ts`
74. `packages/deep-code/src/utils/claudemd.ts`
75. `packages/deep-code/src/utils/computerUse/gates.ts`
76. `packages/deep-code/src/utils/cronJitterConfig.ts`
77. `packages/deep-code/src/utils/effort.ts`
78. `packages/deep-code/src/utils/fastMode.ts`
79. `packages/deep-code/src/utils/file.ts`
80. `packages/deep-code/src/utils/hooks/skillImprovement.ts`
81. `packages/deep-code/src/utils/imagePaste.ts`
82. `packages/deep-code/src/utils/immediateCommand.ts`
83. `packages/deep-code/src/utils/mcpInstructionsDelta.ts`
84. `packages/deep-code/src/utils/mcpValidation.ts`
85. `packages/deep-code/src/utils/messages.ts`
86. `packages/deep-code/src/utils/model/antModels.ts`
87. `packages/deep-code/src/utils/nativeInstaller/pidLock.ts`
88. `packages/deep-code/src/utils/permissions/filesystem.ts`
89. `packages/deep-code/src/utils/permissions/permissionSetup.ts`
90. `packages/deep-code/src/utils/permissions/permissions.ts`
91. `packages/deep-code/src/utils/permissions/yoloClassifier.ts`
92. `packages/deep-code/src/utils/planModeV2.ts`
93. `packages/deep-code/src/utils/plugins/hintRecommendation.ts`
94. `packages/deep-code/src/utils/plugins/marketplaceManager.ts`
95. `packages/deep-code/src/utils/plugins/officialMarketplaceStartupCheck.ts`
96. `packages/deep-code/src/utils/sessionStorage.ts`
97. `packages/deep-code/src/utils/shell/prefix.ts`
98. `packages/deep-code/src/utils/telemetry/betaSessionTracing.ts`
99. `packages/deep-code/src/utils/telemetry/sessionTracing.ts`
100. `packages/deep-code/src/utils/thinking.ts`
101. `packages/deep-code/src/utils/toolResultStorage.ts`
102. `packages/deep-code/src/utils/toolSearch.ts`

### G2. Distinct flag/config key inventory

| Key | Count | Default(s) |
|---|---:|---|
| `enhanced_telemetry_beta` | 1 | `false` |
| `tengu_agent_list_attach` | 1 | `false` |
| `tengu_amber_flint` | 1 | `true` |
| `tengu_amber_json_tools` | 1 | `false` |
| `tengu_amber_prism` | 1 | `false` |
| `tengu_amber_stoat` | 1 | `true` |
| `tengu_ant_model_override` | 1 | none |
| `tengu_auto_background_agents` | 1 | `false` |
| `tengu_auto_mode_config` | 4 | `{}` as `AutoModeConfig` |
| `tengu_basalt_3kr` | 1 | `false` |
| `tengu_birch_trellis` | 1 | `true` |
| `tengu_bramble_lintel` | 1 | `null` |
| `tengu_chair_sermon` | 4 | none |
| `tengu_chomp_inflection` | 2 | `false` |
| `tengu_cicada_nap_ms` | 1 | `0` |
| `tengu_cobalt_raccoon` | 3 | `false` |
| `tengu_collage_kaleidoscope` | 2 | `true` |
| `tengu_compact_cache_prefix` | 2 | `true` |
| `tengu_compact_line_prefix_killswitch` | 1 | `false` |
| `tengu_compact_streaming_retry` | 1 | `false` |
| `tengu_copper_panda` | 1 | `false` |
| `tengu_coral_fern` | 1 | `false` |
| `tengu_cork_m4q` | 1 | `false` |
| `tengu_destructive_command_warning` | 2 | `false` |
| `tengu_disable_bypass_permissions_mode` | 4 | none |
| `tengu_dunwich_bell` | 1 | `false` |
| `tengu_enable_settings_sync_push` | 1 | `false` |
| `tengu_fgts` | 1 | `false` |
| `tengu_glacier_2xr` | 2 | `false` |
| `tengu_grey_step2` | 1 | `OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT` |
| `tengu_harbor` | 1 | `false` |
| `tengu_harbor_permissions` | 1 | `false` |
| `tengu_hawthorn_steeple` | 1 | `false` |
| `tengu_herring_clock` | 2 | `false` |
| `tengu_hive_evidence` | 3 | `false` |
| `tengu_immediate_model_command` | 1 | `false` |
| `tengu_iron_gate_closed` | 1 | `true` |
| `tengu_kairos_brief` | 3 | `false` |
| `tengu_kairos_cron` | 1 | `true` |
| `tengu_kairos_cron_durable` | 1 | `true` |
| `tengu_keybinding_customization_release` | 1 | `false` |
| `tengu_lapis_finch` | 1 | `false` |
| `tengu_log_datadog_events` | 2 | none |
| `tengu_marble_fox` | 1 | `false` |
| `tengu_marble_sandcastle` | 1 | `false` |
| `tengu_miraculo_the_bard` | 1 | `false` |
| `tengu_moth_copse` | 4 | `false` |
| `tengu_otk_slot_v1` | 2 | `false` |
| `tengu_paper_halyard` | 2 | `false` |
| `tengu_passport_quail` | 2 | `false` |
| `tengu_pebble_leaf_prune` | 1 | `false` |
| `tengu_penguins_off` | 1 | `null` |
| `tengu_pid_based_version_locking` | 1 | `false` |
| `tengu_plan_mode_interview_phase` | 1 | `false` |
| `tengu_plugin_official_mkt_git_fallback` | 3 | `true` |
| `tengu_plum_vx3` | 1 | `false` |
| `tengu_post_compact_survey` | 1 | none |
| `tengu_quartz_lantern` | 2 | `false` |
| `tengu_quiet_fern` | 1 | `false` |
| `tengu_read_dedup_killswitch` | 1 | `false` |
| `tengu_scratch` | 2 | none |
| `tengu_sedge_lantern` | 1 | `false` |
| `tengu_session_memory` | 2 | `false` |
| `tengu_slate_prism` | 2 | `true`, `false` |
| `tengu_slate_thimble` | 1 | `false` |
| `tengu_slim_subagent_claudemd` | 1 | `true` |
| `tengu_sm_compact` | 1 | `false` |
| `tengu_strap_foyer` | 1 | `false` |
| `tengu_streaming_tool_execution2` | 1 | none |
| `tengu_terminal_panel` | 2 | `false` |
| `tengu_terminal_sidebar` | 2 | `false` |
| `tengu_thinkback` | 2 | none |
| `tengu_tool_pear` | 2 | none |
| `tengu_toolref_defer_j8m` | 2 | none |
| `tengu_trace_lantern` | 1 | `false` |
| `tengu_turtle_carbon` | 1 | `true` |
| `tengu_vscode_cc_auth` | 1 | `false` |
| `tengu_vscode_onboarding` | 1 | none |
| `tengu_vscode_review_upsell` | 1 | none |
| `tengu_willow_mode` | 2 | `'off'` |

### G3. OTel source occurrence list

1. `src/bootstrap/state.ts:942` - `claude_code.session.count`
2. `src/bootstrap/state.ts:945` - `claude_code.lines_of_code.count`
3. `src/bootstrap/state.ts:949` - `claude_code.pull_request.count`
4. `src/bootstrap/state.ts:952` - `claude_code.commit.count`
5. `src/bootstrap/state.ts:955` - `claude_code.cost.usage`
6. `src/bootstrap/state.ts:959` - `claude_code.token.usage`
7. `src/bootstrap/state.ts:964` - `claude_code.code_edit_tool.decision`
8. `src/bootstrap/state.ts:970` - `claude_code.active_time.total`
9. `src/services/analytics/firstPartyEventLogger.ts:386` - `com.anthropic.claude_code.events`
10. `src/services/analytics/firstPartyEventLoggingExporter.ts:308` - `com.anthropic.claude_code.events`
11. `src/utils/telemetry/events.ts:72` - dynamic body prefix `claude_code.${eventName}`
12. `src/utils/telemetry/instrumentation.ts:389` - `com.anthropic.claude_code.events`
13. `src/utils/telemetry/instrumentation.ts:588` - `com.anthropic.claude_code.events`
14. `src/utils/telemetry/sessionTracing.ts:153` - `com.anthropic.claude_code.tracing`
15. `src/utils/telemetry/sessionTracing.ts:216` - `claude_code.interaction`
16. `src/utils/telemetry/sessionTracing.ts:319` - `claude_code.llm_request`
17. `src/utils/telemetry/sessionTracing.ts:505` - `claude_code.tool`
18. `src/utils/telemetry/sessionTracing.ts:559` - `claude_code.tool.blocked_on_user`
19. `src/utils/telemetry/sessionTracing.ts:640` - `claude_code.tool.execution`
20. `src/utils/telemetry/sessionTracing.ts:867` - `claude_code.hook`
21. `src/utils/workloadContext.ts:22` - comment-only `claude_code.py`

### G4. Perf-baseline key mapping

| Old key | New key |
|---|---|
| `cold_start_version_ms` | `deepcode_cold_start_version_ms` |
| `cold_start_status_ms` | `deepcode_cold_start_status_ms` |
| `jsonl_tail_100_msgs_ms` | `deepcode_jsonl_tail_100_msgs_ms` |
| `jsonl_parse_1k_msgs_ms` | `deepcode_jsonl_parse_1k_msgs_ms` |
| `keystroke_to_paint_p50_ms` | `deepcode_keystroke_to_paint_p50_ms` |
| `keystroke_to_paint_p99_ms` | `deepcode_keystroke_to_paint_p99_ms` |
| `scroll_1k_fps` | `deepcode_scroll_1k_fps` |
| `bash_first_chunk_ms` | `deepcode_bash_first_chunk_ms` |

### G5. Generated event dependency graph

- `firstPartyEventLoggingExporter.ts`
- imports `ClaudeCodeInternalEvent`
- from `types/generated/events_mono/claude_code/v1/claude_code_internal_event.js`
- imports `GrowthbookExperimentEvent`
- from `types/generated/events_mono/growthbook/v1/growthbook_experiment_event.js`
- `services/analytics/metadata.ts`
- imports `EnvironmentMetadata`
- from `types/generated/events_mono/claude_code/v1/claude_code_internal_event.js`
- `growthbook.ts`
- calls `logGrowthBookExperimentTo1P`
- `firstPartyEventLogger.ts`
- builds `event_type: 'GrowthbookExperimentEvent'`
- exporter branches on `GrowthbookExperimentEvent`
- runtime deletion should make that branch removable if no other producer remains.

### G6. Verification targets for follow-up PRs

- `rg "@growthbook/growthbook" packages/deep-code/src` should reach 0 after runtime deletion.
- `rg "growthbook\\.js" packages/deep-code/src` should reach 0 after all consumer migrations.
- `rg "from .*featureFlags\\.js" packages/deep-code/src` should equal migrated consumer count before deletion.
- `rg "@statsig|statsig-node|statsig-js|statsig-react" packages/deep-code/src packages/deep-code/test` should remain 0.
- `rg "claude_code\\." packages/deep-code/src` should reach 0 after P1.10.A except generated path decisions if deferred.
- `rg "com\\.anthropic\\.claude_code\\." packages/deep-code/src` should reach 0 after P1.10.A.
- `node --test test/perf-baseline.test.mjs` should pass after key rename.
- `bun test` should remain 69/69 throughout source PRs.
- `dist/deepcode-full.mjs` should remain out of source PR diffs.
- P1.10.Z should be the only PR that refreshes dist.

### G7. Scan conclusions

- GrowthBook is the large remaining vendor runtime in the source bundle path.
- Statsig is already gone as an SDK/package but not gone as compatibility vocabulary.
- OTel rename is well-scoped and should go first.
- GrowthBook removal is larger than the initial 30-60 flag estimate because 80 distinct keys are present.
- Path C is the best migration shape because it makes each consumer PR mechanical.
- The final behavior question is not "what does GrowthBook return today" but "what default should DeepCode own after GrowthBook is gone".
