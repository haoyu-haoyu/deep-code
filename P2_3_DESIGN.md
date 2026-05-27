# P2.3 Design - Cache Visualization Scan + Path Recommendation

## Executive summary

- P2.3 is the Phase 2 cache visualization feature.
- Goal: make DeepSeek prefix-cache behavior visible during normal TUI use.
- Scope: real-time cache hit percentage plus `/cache inspect`, `/cache warmup`, and `/cache clear`.
- Recommendation: Path B, the full design from `PURE_DEEPSEEK_PLAN.md`.
- P2.3 is DeepSeek-only feature work.
- Non-DeepSeek providers must stay cleanly hidden or unavailable through `provider.supports('cache_breakpoint')`.
- The important scan result: DeepSeek cache fields are already parsed today.
- The missing layer is a TUI-friendly in-memory per-turn/session store plus command and footer surfaces.
- Existing `cache-telemetry.mjs` persists last and total cache stats, but it is not enough for an interactive last-10-turn inspect dialog.
- Existing `deepseek-warmup.mjs` already implements a normal chat-completion warmup primitive.
- Existing `stable-prefix.mjs` already computes component hashes for static prefix diagnostics.
- P2.3 should reuse those primitives rather than replacing them.

## Phase A - Cache Infrastructure Inventory

### A1. Existing cache modules

#### `packages/deep-code/src/cache/deepseek-cache.mjs`

- Current size: 63 lines.
- Role: pure cache helper module.
- Exports: `createDeepSeekCacheUserId`, `calculateDeepSeekCacheHitRate`, `createDeepSeekCacheDiagnostics`, `createStableHash`, `createDeepSeekPrefixHash`.
- Cache hit rate already uses `prompt_cache_hit_tokens / (prompt_cache_hit_tokens + prompt_cache_miss_tokens)`.
- Diagnostics already expose hit tokens, miss tokens, total tokens, and hit rate.
- Stable hash helpers already provide deterministic JSON sorting.
- Gap: no mutable session history and no last-10-turn timeline.
- Recommendation: keep pure math here; create a separate store if mutable state grows.

#### `packages/deep-code/src/cache/deepseek-warmup.mjs`

- Current size: 76 lines.
- Role: existing backend primitive for `/cache warmup`.
- Exports: `createDeepSeekWarmupContext`, `warmDeepSeekCache`, `formatDeepSeekWarmupResult`.
- Warmup builds a stable prefix through `createDeepCodeStablePrefix`.
- Warmup uses ordinary streaming chat completion, not a dedicated cache endpoint.
- Warmup sends `Cache warm-up request. Reply exactly: ok`, requests `maxTokens: 8`, and sets `thinking: 'disabled'`.
- Result already includes prefix hash, content, finish reason, usage, cache diagnostics, and request.
- Formatter already prints hit, miss, and hit rate.
- Recommendation: wire this into `/cache warmup` instead of inventing a new transport.

#### `packages/deep-code/src/deepcode/cache-telemetry.mjs`

- Current size: 170 lines.
- Role: persisted cache telemetry.
- Exports: `resolveDeepSeekCacheStatsPath`, `createDeepSeekCacheStats`, `loadDeepSeekCacheStats`, `recordDeepSeekCacheUsage`, `formatDeepSeekCacheStatus`.
- P2.2.d already gates it through `provider.supports('cache_breakpoint')`.
- Stats path supports disabled env vars and `DEEPCODE_CACHE_STATS_PATH`.
- Default storage is under `~/.deepcode/cache-stats/`.
- Persisted stats include request count, last hit/miss/rate, total hit/miss/rate, prefix hashes, and changed prefix components.
- Recording is best effort and writes JSON stats to disk.
- Formatting already renders stable-prefix diagnostics and last/total telemetry.
- Gap: disk stats are not a live footer store and do not keep a last-10-turn UI timeline.
- Recommendation: keep this for status continuity; add an in-memory store for P2.3 UI.

#### `packages/deep-code/src/deepcode/stable-prefix.mjs`

- Current size: 115 lines.
- Role: stable prefix metadata.
- Exports: `DEEPCODE_STABLE_SYSTEM_PROMPT`, `createDeepCodeStablePrefix`, `formatDeepCodePrefixStatus`.
- It is gated by `provider.supports('stable_prefix_cache')`.
- It computes a prefix hash and component hashes for system prompt, tools, skills, repo summary, and stable history.
- Recommendation: reuse component hashes for `/cache inspect` layered prompt classification.

#### `packages/deep-code/src/deepcode/status.mjs`

- Current size: 257 lines.
- Role: text status report.
- It imports `formatDeepSeekCacheStatus`.
- It already gates DeepSeek cache rows through provider capability checks.
- It is a formatting reference, not the live footer state owner.

#### `packages/deep-code/src/services/providers/deepseek.mjs`

- Current size: 654 lines.
- Role: DeepSeek provider implementation.
- It parses streaming SSE lines and maps raw usage through `mapDeepSeekUsage`.
- It already preserves `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `prompt_tokens`, `completion_tokens`, `total_tokens`, and `reasoning_tokens`.
- P2.3 does not need first-time cache field parsing here.
- P2.3 only needs to ensure parsed usage reaches the new per-turn store.

#### `packages/deep-code/src/services/runtime/usage.ts`

- Current size: 159 lines.
- Role: provider usage to `NonNullableUsage` mapper.
- It gates cache mapping with `providerSupports(provider, 'cache_breakpoint')`.
- It maps hits to `cache_read_input_tokens` and misses to `cache_creation_input_tokens`.
- P2.3 should avoid changing `NonNullableUsage`; UI history can keep DeepSeek-specific raw fields separately.

#### `packages/deep-code/src/query/deepseek-call-model.mjs`

- This is an important cache data-flow file.
- It records query cache usage after streamed response completion.
- It passes `stablePrefix` only when supported and gates recording by `cache_breakpoint`.
- It is a likely P2.3.a ingestion point for the new per-turn store.

#### `packages/deep-code/src/deepcode/provider-capabilities.mjs`

- Role: centralized provider capability helper.
- P2.2.d established the rule: use `provider.supports(capability)`, not provider-name comparisons.
- `cache_breakpoint` gates P2.3 UI and commands.
- `stable_prefix_cache` gates warmup and layered prompt classification.

#### Existing test coverage

- `packages/deep-code/test/deepcode-native.test.mjs` already covers cache diagnostics.
- It covers `formatDeepSeekCacheStatus`.
- It covers persisted cache telemetry.
- It covers warmup formatting.
- It covers DeepSeek SSE usage parsing with cache fields.
- `packages/deep-code/test/p2-2-providers.test.mjs` covers provider capability gating.
- `packages/deep-code/test/tui-deepseek.test.mjs` includes DeepSeek SSE fixtures with cache fields.
- P2.3 tests can extend existing Node test patterns.

### A2. DeepSeek API cache response fields

#### Field schema observed in local code

| Field | Meaning | Current handling |
| --- | --- | --- |
| `usage.prompt_cache_hit_tokens` | Input tokens served from DeepSeek prefix cache | Parsed in `deepseek.mjs`; mapped in `usage.ts`; used by cache diagnostics |
| `usage.prompt_cache_miss_tokens` | Input tokens not served from prefix cache | Parsed in `deepseek.mjs`; mapped in `usage.ts`; used by cache diagnostics |
| `usage.prompt_tokens` | Total prompt/input tokens | Parsed in `deepseek.mjs`; mapped to input tokens |
| `usage.completion_tokens` | Completion/output tokens | Parsed in `deepseek.mjs`; mapped to output tokens |
| `usage.total_tokens` | Total API tokens | Parsed in `deepseek.mjs` |
| `usage.completion_tokens_details.reasoning_tokens` | DeepSeek reasoning token count | Parsed as `reasoning_tokens` |

#### Current parse location

- `parseDeepSeekSSELines(lines)` parses `data: {...}` SSE chunks.
- It ignores `data: [DONE]`.
- It emits `usage` events when a chunk contains `chunk.usage`.
- Usage events call `mapDeepSeekUsage(chunk.usage)`.
- `mapDeepSeekUsage` preserves cache hit tokens.
- `mapDeepSeekUsage` preserves cache miss tokens.
- This means P2.3 does not need to add raw API schema support from scratch.

#### Current runtime mapping

- `updateUsage` reads `prompt_cache_hit_tokens`.
- It treats hit tokens as cache read tokens.
- `updateUsage` reads `prompt_cache_miss_tokens`.
- It treats miss tokens as cache creation tokens.
- The mapping only happens when `provider.supports('cache_breakpoint')`.
- OpenAI-compatible providers receive zero cache fields from their adapter.
- This preserves the P2.2 non-DeepSeek degradation rule.

#### Current telemetry flow

- DeepSeek API response includes cache fields.
- The provider maps them into runtime usage events.
- Runtime usage can update aggregate usage counters.
- `query/deepseek-call-model.mjs` records cache usage to `cache-telemetry.mjs`.
- `cache-telemetry.mjs` persists last request and total stats to disk.
- `status.mjs` can format persisted stats.

#### Current gaps

- There is no dedicated live per-turn cache store.
- There is no footer chip that reads cache hit percentage.
- There is no `/cache inspect` dialog.
- There is no `/cache clear` for local UI/session stats.
- `/cache warmup` is not exposed as a slash command even though the primitive exists.
- Persisted stats do not capture the last 10 turns in a UI-ready form.
- Persisted stats are workspace-user oriented, not necessarily current-session oriented.

### A3. Status bar and footer structure

#### Current footer flow

- `PromptInputFooter.tsx` receives the current message list.
- It derives the last assistant message id.
- It derives the last auto route decision from stream events.
- It passes `autoRouteDecision` into `PromptInputFooterLeftSide`.
- `PromptInputFooterLeftSide.tsx` renders the left-side footer mode indicators.
- `ModeIndicator` reads app state for model and task context.
- `ModeIndicator` computes `activeModelSetting`.
- It shows the auto route chip only when the active model setting is `auto`.
- Current auto chip format is `auto -> {model}/{thinking}`.
- The auto chip is inserted into the `parts` array.
- It is rendered before PR status.

#### Cache chip placement

- P2.3 should mirror the P2.1 auto-mode chip pattern.
- Recommended component name: `CacheStatusChip.tsx`.
- Recommended display: `cache: 87% hit (12.3k / 14.1k)`.
- Place the cache chip next to the auto route chip in `ModeIndicator`.
- Keep it before PR status because it is session/runtime state, not repository state.
- Keep it after provider/mode/task indicators so operational state remains first.
- Hide it when no cache stats exist.
- Hide it when hit plus miss is zero.
- Hide it when the active provider does not support `cache_breakpoint`.
- Do not show `N/A` placeholders.
- Keep compact formatting for 80-column terminals.

#### Cache chip data source options

- Option 1: scan messages for the last usage event.
- Option 2: add a small in-memory cache session store.
- Option 3: read persisted `cache-telemetry.mjs` stats on render.
- Recommendation: use option 2.
- Message scanning is simple but weak for session totals and last-10-turn inspect.
- Disk reads in render are not appropriate for a footer.
- A store can serve both chip and `/cache inspect`.
- The store can still be fed by the same usage path that writes persisted telemetry.

#### Suggested live cache snapshot shape

```ts
type DeepSeekCacheTurnSnapshot = {
  turnId: string
  createdAt: number
  promptCacheHitTokens: number
  promptCacheMissTokens: number
  promptCacheTotalTokens: number
  promptCacheHitRate: number
  prefixHash?: string
  componentHashes?: Record<string, string>
}

type DeepSeekCacheSessionSnapshot = {
  turns: DeepSeekCacheTurnSnapshot[]
  totalPromptCacheHitTokens: number
  totalPromptCacheMissTokens: number
  totalPromptCacheTokens: number
  totalPromptCacheHitRate: number
}
```

### A4. Command UI patterns

#### Existing `/provider` pattern

- `src/commands/provider/index.ts` registers the command.
- It uses `type: 'local'`.
- It provides `name`, `description`, and `argumentHint`.
- It supports non-interactive execution.
- It lazy-loads `provider.js`.
- `provider.tsx` handles direct arguments.
- It can print current status.
- It can validate provider names.
- It can persist provider configuration.
- This is the best reference for simple text subcommands.

#### Existing `/model` pattern

- `src/commands/model/index.ts` registers a `local-jsx` command.
- `model.tsx` provides a picker UI.
- It handles direct arguments through effects.
- It can update app state.
- It is a good reference for interactive command surfaces.

#### Recommended `/cache` command layout

- Use `packages/deep-code/src/commands/cache/index.ts`.
- Use `packages/deep-code/src/commands/cache/cache.tsx`.
- Register the command in `packages/deep-code/src/commands.ts`.
- Keep subcommands in one command module at first.
- Supported subcommands: `inspect`, `warmup`, and `clear`.
- `/cache` with no args should behave like `/cache inspect`.
- `/cache inspect` should render a compact dialog in interactive mode.
- `/cache inspect` should print a text summary in non-interactive mode.
- `/cache warmup` should call `warmDeepSeekCache`.
- `/cache clear` should clear local session stats and, if appropriate, persisted stats.
- `/cache clear` must state that it does not clear DeepSeek-side remote cache.

#### Dialog reference

- A full-screen dialog is not required.
- The first version can use a compact local-JSX panel.
- It should show the last 10 turns.
- It should show hit tokens.
- It should show miss tokens.
- It should show hit percentage.
- It should show session totals.
- It should show estimated session dollars saved when pricing is available.
- It should show prefix hash and changed component hints when available.
- Non-DeepSeek sessions should show a short unavailable message.

## Phase B - Path Options for Cache Visualization

### Path A - Minimal chip-only

- Add only a footer cache chip.
- Reuse parsed usage fields.
- Possibly scan messages for last usage event.
- Defer `/cache inspect`.
- Defer `/cache warmup`.
- Defer `/cache clear`.
- Likely fits in one or two PRs.
- Lowest implementation risk.
- Lowest product value.
- It skips most of the P2.3 "killer feature" value.
- It does not help debug why a prefix cache misses.
- It does not expose warmup even though the primitive exists.
- It leaves users without session-level history.

### Path B - Full design per `PURE_DEEPSEEK_PLAN.md`

- Add live cache store.
- Add provider/runtime ingestion of cache snapshots.
- Add `CacheStatusChip`.
- Integrate the chip into the footer.
- Add `/cache inspect`.
- Add `/cache warmup`.
- Add `/cache clear`.
- Add tests for parsing, store math, chip rendering, command behavior, and non-DeepSeek gating.
- Preserve persisted telemetry.
- Reuse existing stable prefix hashes.
- Reuse existing warmup helper.
- Expected scope is three feature PRs plus test/hardening, bundle, and cite.
- This matches the plan intent.
- This maximizes user-visible value.

### Path C - Hybrid: chip plus inspect first, warmup/clear later

- Add live store.
- Add footer chip.
- Add `/cache inspect`.
- Defer `/cache warmup`.
- Defer `/cache clear`.
- This gives useful visibility sooner than Path A.
- It still postpones write operations.
- It is a reasonable fallback if warmup or clear semantics become risky.
- It is less complete than the plan.
- It would require another follow-up phase to finish P2.3.

## Phase C - Recommended Path + Rationale

- Recommendation: Path B.
- P2.3 is explicitly the DeepSeek cache visualization feature.
- A chip-only implementation would make the cache visible but not explain it.
- The inspect dialog is what turns a percentage into actionable feedback.
- The warmup command has direct practical value for repeated self-use sessions.
- The codebase already has most low-level cache primitives.
- The provider already parses cache hit and miss tokens.
- Runtime usage already maps those fields behind provider capability gates.
- Persistent telemetry already records last and total cache stats.
- Stable prefix component hashes already exist.
- Warmup already uses ordinary chat completion and reports cache diagnostics.
- The remaining work is integration and UI, not speculative API discovery.
- P2.2.d already made non-DeepSeek degradation safe.
- The expected 4-6 PR sequence matches the rhythm of P2.1 and P2.2.
- Path B should stay incremental by splitting store, chip, command, tests, dist, and cite.

## Phase D - Sub-PR Breakdown

### P2.3.scan - this PR

- Create this docs-only design scan.
- Confirm cache fields are already parsed.
- Identify the footer, command, warmup, stable-prefix, and telemetry integration points.
- Recommend Path B and define the downstream PR sequence.

### P2.3.a - DeepSeek cache store and ingestion

- Add pure session math to `src/cache/deepseek-cache.mjs` if small, or create `src/cache/deepseek-cache-store.mjs` if mutable state needs a separate owner.
- Store per-turn hit/miss tokens, hit rate, session totals, prefix hash, and component hashes.
- Do not store prompt text.
- Feed the store from the same usage path that writes persisted telemetry.
- Candidate ingestion points: `src/query/deepseek-call-model.mjs` and `src/services/runtime/messageSend.ts`.
- Preserve disk telemetry and gate all behavior by `provider.supports('cache_breakpoint')`.
- Add tests for store math, zero-token denominator behavior, and non-DeepSeek no-op ingestion.
- Do not add UI in this PR.

### P2.3.b - `CacheStatusChip` UI and footer integration

- Create `src/components/CacheStatusChip.tsx`.
- Format `cache: X% hit (Y / Z)`.
- Use compact token formatting and hide for missing or zero-total stats.
- Gate by `provider.supports('cache_breakpoint')`.
- Integrate with `PromptInputFooter.tsx`.
- Integrate with `PromptInputFooterLeftSide.tsx`.
- Mirror the P2.1 `auto -> flash/off` chip pattern.
- Keep non-auto and non-DeepSeek footer behavior unchanged.
- Add TUI tests for visible DeepSeek chip and hidden non-DeepSeek chip.

### P2.3.c - `/cache` command and inspect dialog

- Create `src/commands/cache/index.ts`.
- Create `src/commands/cache/cache.tsx`.
- Register the command in `src/commands.ts`.
- `/cache` defaults to inspect.
- `/cache inspect` shows last 10 turns, hit/miss/rate, session totals, optional estimated savings, prefix hash, and changed prefix components.
- `/cache warmup` calls `warmDeepSeekCache` and prints `formatDeepSeekWarmupResult`.
- `/cache clear` clears local live stats and may remove persisted stats when the path is known.
- `/cache clear` must not claim to clear DeepSeek remote cache.
- Non-DeepSeek providers return an unavailable message.
- Add command tests for inspect, warmup, clear, and unavailable paths.

### P2.3.test - comprehensive hardening

- Split only if P2.3.a-c grow too large.
- Cover DeepSeek cache-field fixtures, live store updates, footer chip text, inspect history, warmup diagnostics, clear reset, unsupported-provider behavior, empty usage, and concurrent updates.

### P2.3.Z - dist refresh

- Rebuild `dist/deepcode-full.mjs` after source changes land.
- Keep the PR dist-only.
- Verify idempotent rebuild SHA-256.
- Run full test suite.

### P2.3.cite - close P2.3 phase

- Update `EXECUTION_LOG.md`.
- Cite scan, a, b, c, optional test, Z, and cite PRs.
- Advance Phase 2 to P2.4 workspace rollback unless roadmap priority changes.
- Keep docs-only.

### Estimate

- Recommended downstream PR count after scan: 4-6.
- Expected sequence: a, b, c, optional test, Z, cite.
- Expected total touched files after scan: 15-25.

## Phase E - Risk Assessment

### Non-DeepSeek session degradation

- P2.3 must not leak DeepSeek cache UI into ollama, vllm, or generic OpenAI-compatible sessions.
- The primary guard is `provider.supports('cache_breakpoint')`.
- Stable prefix details should additionally respect `provider.supports('stable_prefix_cache')`.
- Footer chip should be hidden, not rendered as `N/A`.
- `/cache` should return a concise unavailable message for unsupported providers.
- Existing P2.2.d gates make this low risk if reused consistently.

### Cache hit calculation accuracy

- Current code uses `hit / (hit + miss)`.
- This is the right first-order definition for prompt cache hit rate.
- `hit` is `usage.prompt_cache_hit_tokens`.
- `miss` is `usage.prompt_cache_miss_tokens`.
- Both fields describe prompt/input-side cache behavior.
- They do not describe output tokens.
- They do not describe reasoning tokens.
- A zero denominator should return no display or a zero internal rate.
- The UI should label the metric as prompt cache hit rate.
- The chip format should avoid implying total request cost savings.

### Session dollar-saved estimation

- Dollar-saved estimation needs a DeepSeek pricing table.
- It should use a static pricing snapshot for P2.3.
- The snapshot date should be shown in docs or inspect details.
- Pricing should not be fetched dynamically in the first implementation.
- Dynamic pricing fetch adds network and freshness risks that do not help local self-use enough.
- The estimate should be marked as an estimate.
- A later config override can support custom pricing.
- The calculation should use cached input token discount assumptions only.

### Stable prefix detection

- Layered prompt classification should start from existing component hashes.
- Static layer: system prompt and tool schema hashes.
- Context layer: repository summary and stable history hashes.
- Dynamic layer: recent conversation messages outside the stable prefix.
- Existing `stable-prefix.mjs` already computes the static/context hashes.
- P2.3 should not hash raw prompt text into persisted stats.
- Store hashes and token counts, not prompt contents.
- A basic component-change indicator is enough for P2.3.
- Full byte-level prompt section accounting can be a later refinement.

### `/cache warmup` mechanics

- Local code already uses ordinary chat completion for warmup.
- No dedicated DeepSeek cache warmup endpoint is present in the repo.
- Warmup should keep output short.
- Warmup should avoid tools.
- Warmup should use stable prefix construction.
- Warmup should report prefix hash and cache diagnostics.
- Warmup should not pretend to guarantee a remote cache hit.
- Warmup can prime the current static prefix for later requests.

### Data lifecycle and privacy

- Live session store should stay in memory.
- Persisted telemetry should remain token counts and hashes only.
- Prompt content should not be written to cache stats files.
- `/cache clear` should clear local session data.
- If it deletes persisted stats, it should delete only the local stats file.
- It cannot clear DeepSeek server-side cache.

### UI noise and layout pressure

- Footer space is limited.
- The chip should show only after at least one cache-bearing response.
- It should hide when hit plus miss equals zero.
- It should use compact token units.
- It should not push important task or permission indicators off narrow terminals.
- The P2.1 auto chip placement is the best existing pattern.

### Concurrency and session ownership

- Multiple turns can stream or complete close together.
- Store updates should be append-only and idempotent per turn id.
- Session totals should be derived from stored turn snapshots when practical.
- Disk telemetry is workspace-user scoped; live store should be process-session scoped.
- P2.3 tests should include concurrent update ordering.

## Phase F - Key Decisions

### Q1. Path A/B/C selection

- Recommendation: Path B.
- Reason: P2.3 loses its main value without inspect and warmup.
- Fallback: Path C only if warmup command semantics create unexpected risk.

### Q2. Cache store location

- Recommendation: keep pure helpers in `src/cache/deepseek-cache.mjs`.
- Recommendation: add a new store module if mutable state exceeds a small helper.
- Candidate name: `src/cache/deepseek-cache-store.mjs`.
- Rationale: the existing cache module is clean and pure today.

### Q3. Chip display threshold

- Recommendation: show only when `hit + miss > 0`.
- Do not require a minimum cache hit percentage.
- A visible `0% hit` after a real miss is useful.
- Hide when there is no cache telemetry at all.
- Format tokens compactly as `12.3k / 14.1k`.

### Q4. `/cache warmup` implementation

- Recommendation: use existing ordinary chat-completion warmup.
- Use `warmDeepSeekCache`.
- Keep output short.
- Use stable prefix context.
- Do not add a fake endpoint abstraction.

### Q5. Session dollars saved pricing source

- Recommendation: static pricing table with snapshot date.
- Keep pricing constants local and documented.
- Add config override only if users need it later.
- Do not fetch pricing dynamically in P2.3.

### Q6. Layered prompt classification depth

- Recommendation: basic component-hash classification first.
- Show system prompt, tools, skills, repo summary, and stable history component changes.
- Avoid full prompt text capture.
- Defer deep byte-level prompt segmentation.

## Phase G - Reference Appendix

### DeepSeek schema and fixture

- Required fields: `usage.prompt_cache_hit_tokens` and `usage.prompt_cache_miss_tokens`.
- Companion fields: `prompt_tokens`, `completion_tokens`, `total_tokens`, and `completion_tokens_details.reasoning_tokens`.
- Example fixture: `data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":95,"completion_tokens":31,"total_tokens":126,"completion_tokens_details":{"reasoning_tokens":27},"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":31}}`.
- End marker: `data: [DONE]`.

### Export surfaces to reuse

| Module | Exports |
| --- | --- |
| `cache-telemetry.mjs` | `resolveDeepSeekCacheStatsPath`, `createDeepSeekCacheStats`, `loadDeepSeekCacheStats`, `recordDeepSeekCacheUsage`, `formatDeepSeekCacheStatus` |
| `deepseek-cache.mjs` | `createDeepSeekCacheUserId`, `calculateDeepSeekCacheHitRate`, `createDeepSeekCacheDiagnostics`, `createStableHash`, `createDeepSeekPrefixHash` |
| `deepseek-warmup.mjs` | `createDeepSeekWarmupContext`, `warmDeepSeekCache`, `formatDeepSeekWarmupResult` |

### Footer chip placement notes

- Current auto chip is rendered in the `PromptInputFooterLeftSide.tsx` `parts` array.
- Current auto chip text is `auto -> {model}/{thinking}`.
- Cache chip should use the same low-noise dim footer style, sit adjacent to auto route state, render before PR status, and hide for unsupported providers.

### `/cache inspect` first version content

- Show header, provider status, last turn hit rate, session hit rate, last 10 turns, prefix hash, changed prefix components, estimated savings, pricing snapshot date, and a note that local reset does not clear DeepSeek remote cache.

### Test matrix

| Area | DeepSeek case | Non-DeepSeek case |
| --- | --- | --- |
| Provider parse | Cache hit/miss fields preserved | Adapter returns zero cache fields |
| Store ingest | Turn snapshot appended | No-op |
| Footer chip | `cache: 67% hit (2 / 3)` visible | Hidden |
| Inspect | Last turns and totals visible | Unavailable message |
| Warmup | Uses `warmDeepSeekCache` and reports diagnostics | Unavailable message |
| Clear | Local store resets | No-op or unavailable |
| Prefix diagnostics | Component hashes shown | Hidden |

### Local verification target for scan PR

- `bun test` passes from `packages/deep-code`.
- No source files are modified.
- No test files are modified.
- No dist files are modified.
- `git diff --name-only` shows only `P2_3_DESIGN.md`.
