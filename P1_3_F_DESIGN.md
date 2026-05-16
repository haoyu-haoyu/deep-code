# P1.3.F Design - Anthropic SDK runtime to DeepSeek native migration

## Phase A - Architecture Findings

### A1. DeepSeek native path

The DeepSeek native implementation already exists, but it is currently an adapter beside the legacy Anthropic-shaped runtime rather than the only runtime surface.

Primary files:

- `packages/deep-code/src/services/providers/deepseek.mjs`
- `packages/deep-code/src/query/deepseek-call-model.mjs`
- `packages/deep-code/src/deepcode/deepseek-native.mjs`
- `packages/deep-code/src/services/providers/registry.mjs`

Path sanity check for this proposal: `packages/deep-code/src/query/deepseek-call-model.mjs` and `packages/deep-code/src/cache/deepseek-warmup.mjs` both exist in the current tree.

`deepseek.mjs` exports these public APIs:

- Message and schema mapping: `mapMessagesToDeepSeek`, `sanitizeSchemaForDeepSeekStrict`, `toolToDeepSeekFunctionSchema`
- Cache helpers: `calculateDeepSeekCacheHitRate`, `createDeepSeekCacheDiagnostics`, `createDeepSeekCacheUserId`, `createDeepSeekPrefixHash`, `createStableHash`, `stableJsonStringify`
- Provider constants: `DEFAULT_DEEPSEEK_BASE_URL`, `DEFAULT_DEEPSEEK_MODEL`, `DEFAULT_DEEPSEEK_SMALL_MODEL`, `DEEPSEEK_PROVIDER_CAPABILITIES`
- Request/provider APIs: `resolveDeepSeekConfig`, `buildDeepSeekRequest`, `runDeepSeekAgent`, `createDeepSeekProvider`, `streamDeepSeekQuery`
- Stream APIs: `streamDeepSeekResponseBody`, `collectDeepSeekStreamEvents`, `mergeDeepSeekToolCallDelta`, `parseDeepSeekStreamChunk`, `parseDeepSeekSSELines`
- Usage/recovery APIs: `mapDeepSeekUsage`, `calculateDeepSeekRetryDelayMs`, `DEEPSEEK_FINISH_ACTIONS`, `mapDeepSeekFinishReason`, `mapDeepSeekHttpError`

Current wiring:

- `query/deps.ts` is the main runtime bridge. `productionDeps()` defaults `DEEPCODE_PROVIDER` / `DEEP_CODE_PROVIDER` to `deepseek`, and maps `callModel` to `createDeepSeekCallModel()` when provider is `deepseek`.
- `query/deepseek-call-model.mjs` adapts DeepSeek streaming events into the legacy `queryModelWithStreaming` generator shape used by `query.ts`.
- `services/providers/registry.mjs` exposes a provider registry with DeepSeek as the default and Anthropic as unsupported in native mode.
- `deepcode/deepseek-native.mjs` re-exports DeepSeek provider, cache warmup, compact, and stable-prefix helpers.
- Native code paths also exist in `deepcode/compact.mjs`, `deepcode/doctor.mjs`, `cache/deepseek-warmup.mjs`, `query/deepseek-call-model.mjs`, and tests under `packages/deep-code/test/deepcode-native.test.mjs`.

Capability matrix:

| Capability | DeepSeek native status | Legacy `claude.ts` status | Migration note |
|------------|------------------------|---------------------------|----------------|
| Streaming chat | Present via `streamDeepSeekQuery()` and `createDeepSeekCallModel()` | Present via `queryModelWithStreaming()` | Main query loop can already run through DeepSeek, but typing and fallback still import `claude.ts`. |
| Tool calls | Present via OpenAI-style `tool_calls`, strict schema support, and stream deltas | Present via Anthropic `tool_use` blocks | DeepSeek adapter maps tool calls back to Anthropic-shaped stream events for existing `query.ts`. |
| Reasoning/thinking | Present via `reasoning_content` mapped to `thinking` stream blocks | Present via Anthropic thinking blocks | DeepSeek adapter covers the main stream shape. Protected-thinking signature logic is Anthropic-specific and should not be preserved. |
| Prompt cache | Partial: stable prefix, cache user id, hit/miss usage diagnostics | Anthropic `cache_control`, 1h TTL, cache editing, prompt-cache break detection | Needs semantic replacement. DeepSeek cannot preserve Anthropic block-level `cache_control`; use stable prefix plus diagnostics only. |
| Usage mapping | Present via `mapDeepSeekUsage()` and `mapUsageForClaudeCode()` | Present via `updateUsage()` / `accumulateUsage()` plus logging | Usage primitives should move to a provider-neutral module so `QueryEngine` and forked agents stop importing `claude.ts/logging.ts`. |
| Retry | Present but simpler: HTTP 429/503 retry via `streamDeepSeekQuery()` | Rich `withRetry()` handles Anthropic/Bedrock/Vertex auth, 529, fallback, retry UI events | Need a DeepSeek runtime retry facade for query loop semantics, or intentionally drop Anthropic-specific cases. |
| Non-streaming helper | Partial: `buildDeepSeekRequest({ stream: false })` exists, but no `AssistantMessage` helper equivalent | `queryModelWithoutStreaming()`, `queryHaiku()`, `queryWithModel()` | Side utilities and web tools need small-model/non-streaming DeepSeek helpers before `claude.ts` can go. |
| Token counting | Missing as an API-equivalent surface | `services/tokenEstimation.ts` uses `getAnthropicClient()` | Requires a DeepSeek tokenizer strategy, heuristic, or budget-policy rewrite. |
| API error formatting | Partial: DeepSeek HTTP errors are mapped in `deepseek-recovery.mjs` | `errors.ts` and `errorUtils.ts` provide UI strings and classifiers | Extract provider-neutral UI error helpers and add DeepSeek error classification. |
| Request dump/debug | Missing except generic request objects | `dumpPrompts.ts` wraps fetch and writes Anthropic request JSONL | Most of this is ant-only debug surface; likely delete or replace with provider-neutral debug dump. |
| Session ingress/teleport | Not covered | `sessionIngress.ts` includes local session log helpers and OAuth session retrieval | Split local session log helpers from OAuth/teleport retrieval. Teleport deletion remains P1.3.G. |

DeepSeek coverage is above the early-stop threshold for the hot main loop: streaming, tool calls, thinking, usage mapping, and cache diagnostics exist. It is not complete enough to delete the 10 wrapper files directly because non-streaming side calls, token estimation, error helpers, logging, retry primitives, dump/debug state, and session-ingress helpers are still imported across runtime code.

### A2. Runtime consumers of `claude.ts`

Core query path:

- `query/deps.ts`
  - Imports `queryModelWithStreaming` from `services/api/claude.ts` for the production fallback and for the `QueryDeps.callModel` type.
  - Imports `createDeepSeekCallModel()` and casts it to the legacy Anthropic call-model type.
  - This is the highest-leverage migration point: the main loop already depends on an injected `callModel`.
- `query.ts`
  - Does not import `queryModelWithStreaming` directly, but imports `FallbackTriggeredError` from `withRetry.ts`, `PROMPT_TOO_LONG_ERROR_MESSAGE` / `isPromptTooLongMessage` from `errors.ts`, and `createDumpPromptsFetch` from `dumpPrompts.ts`.
  - It calls `deps.callModel(...)` in the API loop, so runtime send can migrate without rewriting the whole query loop.
  - It still assumes Anthropic-shaped stream events, assistant messages, prompt-too-long errors, fallback errors, and optional dump-prompts fetch wrapping.
- `QueryEngine.ts`
  - Imports `updateUsage` and `accumulateUsage` from `claude.ts`.
  - Imports `EMPTY_USAGE` and `NonNullableUsage` from `logging.ts`.
  - Imports `categorizeRetryableAPIError` from `errors.ts`.
  - It does not send messages directly; it consumes stream events emitted by `query.ts`.

AgentTool cluster:

- `tools/AgentTool/runAgent.ts`
  - Imports `getDumpPromptsPath` for ant-only subagent API-call log display.
  - Imports `cleanupAgentTracking` from `promptCacheBreakDetection.ts`.
- `tools/AgentTool/AgentTool.tsx`
  - Imports `clearDumpState` for sync/background agent cleanup.
- `tools/AgentTool/agentToolUtils.ts`
  - Imports `clearDumpState` for async agent cleanup.
- `tools/AgentTool/UI.tsx`
  - Imports `getDumpPromptsPath` for ant-only display.

Web tools:

- `tools/WebSearchTool/WebSearchTool.ts`
  - Imports `queryModelWithStreaming` directly for an internal web-search prompt with a forced tool schema.
  - Needs a provider-neutral `queryRuntimeWithStreaming()` or a web-search-specific DeepSeek helper.
- `tools/WebFetchTool/utils.ts`
  - Imports `queryHaiku` for markdown extraction/application.
  - Needs a provider-neutral small-model helper.

Other important consumers:

- `services/compact/compact.ts` imports `queryModelWithStreaming`, `getMaxOutputTokensForModel`, `startsWithApiErrorPrefix`, `notifyCompaction`, and `getRetryDelay`.
- `services/compact/autoCompact.ts` imports `getMaxOutputTokensForModel` and `notifyCompaction`.
- `services/tokenEstimation.ts` imports `getAnthropicClient`, `getAPIMetadata`, and `getExtraBodyParams`.
- `services/toolUseSummary/toolUseSummaryGenerator.ts`, `services/awaySummary.ts`, `commands/rename/generateSessionName.ts`, `commands/insights.ts`, `utils/sessionTitle.ts`, `utils/mcp/dateTimeParser.ts`, `utils/shell/prefix.ts`, `utils/hooks/*`, `components/agents/generateAgent.ts`, and `utils/teleport.tsx` import `queryHaiku`, `queryWithModel`, or `queryModelWithoutStreaming`.
- `utils/forkedAgent.ts` imports usage primitives from `claude.ts/logging.ts`.
- `utils/sideQuery.ts` imports `getAnthropicClient` and `getAPIMetadata`.
- `utils/model/modelCapabilities.ts` imports `getAnthropicClient`.
- `utils/permissions/yoloClassifier.ts` imports `getCacheControl`, `parsePromptTooLongTokenCounts`, and `getDefaultMaxRetries`.

### A3. `claude.ts` exports usage matrix

| Export | Category | Consumers | DeepSeek equivalent? |
|--------|----------|-----------|----------------------|
| `queryModelWithStreaming` | Hot path | `query/deps.ts`, `services/compact/compact.ts`, `tools/WebSearchTool/WebSearchTool.ts` | Partial. `createDeepSeekCallModel()` covers the main loop, but compact and web-search imports still target `claude.ts`. |
| `queryModelWithoutStreaming` | Hot path / side-call helper | `services/awaySummary.ts`, `utils/hooks/execPromptHook.ts`, `utils/hooks/apiQueryHookHelper.ts`, `utils/hooks/skillImprovement.ts`, `components/agents/generateAgent.ts` | Missing as a named helper. Can be built from `buildDeepSeekRequest()` plus `collectDeepSeekStreamEvents()` and `deepSeekResponseToAssistantMessage()`. |
| `queryHaiku` | Small-model helper | `services/toolUseSummary/toolUseSummaryGenerator.ts`, `tools/WebFetchTool/utils.ts`, `commands/rename/generateSessionName.ts`, `utils/teleport.tsx`, `utils/shell/prefix.ts`, `utils/mcp/dateTimeParser.ts`, `utils/sessionTitle.ts`; stale comment in `cli/print.ts` | Missing as a named helper. Should map to `DEFAULT_DEEPSEEK_SMALL_MODEL` or configured `smallModel`. |
| `queryWithModel` | Side-call helper | `commands/insights.ts` | Missing as a named helper. Should become provider-neutral explicit-model helper. |
| `executeNonStreamingRequest` | Retry/fallback implementation | Internal to `claude.ts` | No direct need if callers move to DeepSeek helpers. |
| `getExtraBodyParams` | Adapter helper | `services/tokenEstimation.ts`, `promptCacheBreakDetection.ts`, internal `claude.ts` | No. Anthropic/Bedrock beta-body behavior should be deleted or replaced by DeepSeek request options. |
| `getPromptCachingEnabled` | Adapter helper | Internal `claude.ts` only | No. Replace with DeepSeek stable-prefix policy. |
| `getCacheControl` | Adapter helper | `utils/permissions/yoloClassifier.ts`, internal `claude.ts` | No direct equivalent. DeepSeek uses request-level prefix/cache user id, not Anthropic content-block `cache_control`. |
| `configureTaskBudgetParams` | Adapter helper | Internal `claude.ts`; referenced in `query.ts` comment only | No direct equivalent currently. Need decide whether task-budget survives as DeepSeek runtime metadata or is removed. |
| `getAPIMetadata` | Adapter helper | `services/tokenEstimation.ts`, `utils/sideQuery.ts`, internal `claude.ts` | No. Provider-neutral metadata should be much smaller, or omitted. |
| `verifyApiKey` | One-off | Internal `claude.ts` only | Not needed after OAuth/API-key cleanup. |
| `userMessageToMessageParam` | Adapter helper | Internal `claude.ts` only | DeepSeek equivalent is `mapMessagesToDeepSeek()`. |
| `assistantMessageToMessageParam` | Adapter helper | Internal `claude.ts` only | DeepSeek equivalent is `mapMessagesToDeepSeek()`. |
| `stripExcessMediaItems` | Adapter helper | Internal `claude.ts` only | Not yet represented in DeepSeek mapper. Media/document handling needs a separate decision. |
| `cleanupStream` | Stream utility | Internal `claude.ts` only | DeepSeek stream generator cleans up through `finally`/abort forwarding; no exported equivalent needed. |
| `updateUsage` | Usage utility | `QueryEngine.ts`, `utils/forkedAgent.ts`, internal `claude.ts`, `logging.ts` comment | Yes semantically. Move to provider-neutral `services/runtime/usage.ts`. |
| `accumulateUsage` | Usage utility | `QueryEngine.ts`, `utils/forkedAgent.ts`, internal `claude.ts` | Yes semantically. Move with `updateUsage`. |
| `addCacheBreakpoints` | Cache utility | Internal `claude.ts` only | No. Anthropic cache breakpoint insertion should be dropped. |
| `buildSystemPromptBlocks` | Adapter helper | Internal `claude.ts`, comment in `constants/prompts.ts` | DeepSeek uses string/system messages through `systemPromptToMessages()` and stable prefix. No exported equivalent needed. |
| `MAX_NON_STREAMING_TOKENS` | Constant | Internal `claude.ts` only | Replace with DeepSeek request max token policy if needed. |
| `adjustParamsForNonStreaming` | Adapter helper | Internal `claude.ts` only | No direct need after helper migration. |
| `getMaxOutputTokensForModel` | Model policy | `services/compact/compact.ts`, `services/compact/autoCompact.ts`, comment in `utils/context.ts` | Needs DeepSeek-native model policy. `resolveDeepCodeRequestMaxTokens()` exists in `deepcode/context-policy.mjs` and should be evaluated as replacement. |

### A4. Other SDK wrapper exports

`client.ts`:

- `getAnthropicClient` is imported by `claude.ts`, `services/tokenEstimation.ts`, `utils/sideQuery.ts`, and `utils/model/modelCapabilities.ts`. All are blockers for deleting `client.ts`.
- `CLIENT_REQUEST_ID_HEADER` is only used by `claude.ts`/`client.ts`; it can disappear with `claude.ts`.

`errors.ts`:

- UI/message constants are imported by `components/messages/AssistantTextMessage.tsx`, `query.ts`, `services/compact/compact.ts`, `utils/messages.ts`, and `utils/shell/prefix.ts`.
- `isPromptTooLongMessage` is used by `query.ts` reactive/context-collapse recovery.
- `parsePromptTooLongTokenCounts` is used by `utils/permissions/yoloClassifier.ts`.
- `categorizeRetryableAPIError` is used by `QueryEngine.ts`.
- `getAssistantMessageFromError`, `classifyAPIError`, and `getErrorMessageIfRefusal` are still used inside `claude.ts/logging.ts`.
- Recommendation: split provider-neutral error UI helpers into a non-API module before deleting `errors.ts`.

`withRetry.ts`:

- `FallbackTriggeredError` is used by `query.ts`.
- `getRetryDelay` is used outside the runtime by `services/{policyLimits,remoteManagedSettings,settingsSync,teamMemorySync}/index.ts` and `services/compact/compact.ts`.
- `getDefaultMaxRetries` is used by `utils/permissions/yoloClassifier.ts`.
- The full `withRetry()` generator is used by `claude.ts` only.
- Recommendation: extract generic retry delay/max-retry helpers to `utils/retry.ts`; do not preserve Anthropic auth/Bedrock/Vertex retry logic.

`dumpPrompts.ts`:

- `createDumpPromptsFetch` is used by `query.ts`.
- `getDumpPromptsPath` is used by AgentTool UI/runAgent, slash-command output, and `LogoV2`.
- `clearDumpState` / `clearAllDumpState` are used by AgentTool and clear-caches command.
- Most behavior is ant-only request debugging. Either delete the visible ant-only hooks or replace with provider-neutral debug dump under a new module.

`errorUtils.ts`:

- `formatAPIError` is used by `utils/sideQuestion.ts` and `components/messages/SystemAPIErrorMessage.tsx`, plus `errors.ts`.
- `getSSLErrorHint` is used by `utils/preflightChecks.tsx`.
- `extractConnectionErrorDetails` feeds `logging.ts`, `withRetry.ts`, and `errors.ts`.
- Recommendation: retain provider-neutral connection formatting under `services/runtime/errorFormatting.ts` or `utils/errors`.

`logging.ts` and `emptyUsage.ts`:

- `EMPTY_USAGE` and `NonNullableUsage` are imported by `QueryEngine.ts`, `cli/print.ts`, and `utils/forkedAgent.ts`.
- `logAPIQuery`, `logAPIError`, and `logAPISuccessAndDuration` are used only by `claude.ts`.
- Recommendation: move `EMPTY_USAGE` to a neutral SDK/runtime usage module; delete Anthropic-specific API query logging with `claude.ts`, or reimplement minimal DeepSeek runtime events.

`sessionIngress.ts`:

- `appendSessionLog` and `getSessionLogs` are used by `utils/sessionStorage.ts`; these are local persistence helpers, not inherently Anthropic.
- `getSessionLogsViaOAuth` and `getTeleportEvents` are used by `utils/teleport.tsx`; these remain P1.3.G-adjacent.
- `clearAllSessions` is used by `commands/clear/caches.ts`.
- Recommendation: split local session storage helpers out first; leave teleport remote retrieval as a no-op or defer to P1.3.G.

`promptCacheBreakDetection.ts`:

- `notifyCacheDeletion` / `notifyCompaction` are used by compact/microcompact/autoCompact and `/compact`.
- `cleanupAgentTracking` is used by AgentTool.
- `resetPromptCacheBreakDetection` is used by clear-caches.
- DeepSeek has cache diagnostics but not Anthropic prompt-cache break semantics. Recommendation: replace with a smaller DeepSeek cache diagnostics module or no-op notifications, then delete this file.

## Phase B - Design proposal

### B1. Recommended adapter pattern

**Option**: 3 - create a middle abstraction layer.

Recommended shape:

- Add `packages/deep-code/src/services/runtime/messageSend.ts` for provider-neutral send APIs:
  - `queryRuntimeWithStreaming(...)`
  - `queryRuntimeWithoutStreaming(...)`
  - `queryRuntimeSmall(...)`
  - `queryRuntimeWithModel(...)`
- Add small supporting modules:
  - `services/runtime/usage.ts` for `EMPTY_USAGE`, `updateUsage`, `accumulateUsage`
  - `services/runtime/errors.ts` for provider-neutral user-facing API/runtime error helpers
  - `services/runtime/retry.ts` for `getRetryDelay`, `getDefaultMaxRetries`, and DeepSeek retry policy
  - optional `services/runtime/debugDump.ts` if request dumping remains useful
- Internally implement these against the existing DeepSeek primitives: `createDeepSeekCallModel()`, `buildDeepSeekRequest()`, `collectDeepSeekStreamEvents()`, `deepSeekResponseToAssistantMessage()`, `mapDeepSeekHttpError()`, and `resolveDeepCodeRequestMaxTokens()`.

Reason:

- Option 1, a `deepseek-wrapper.ts` with `claude.ts`-compatible exports, would make the first import switch easy but would preserve Anthropic-shaped names and semantics. It would likely become a second `claude.ts`.
- Option 2, expanding `deepseek.mjs` directly to satisfy all TypeScript consumers, would overload the provider with application-runtime concerns: UI error messages, cache diagnostics, query loop semantics, session logging, and AgentTool debug state.
- Option 3 lets P1.3.F migrate consumers away from `services/api/*` while keeping `deepseek.mjs` focused on provider mechanics. It also lets DeepSeek-native behavior intentionally differ from Anthropic behavior where the old semantics are not portable.

The abstraction should not dispatch to Anthropic in normal builds. A short transition can keep the old imports alive only while consumers migrate, but the target state is DeepSeek-only runtime APIs plus deletion of the 10 wrappers.

### B2. Sub-PR breakdown

- F.0: Runtime adapter scaffold
  - Scope: add `services/runtime/messageSend.ts`, `usage.ts`, `errors.ts`, and unit tests; no consumer migration.
  - Estimated files: 4-8.
  - Risk: high. Must define exact TypeScript shapes without dragging `services/api/claude.ts` types into the new layer.
  - Type signatures of `services/runtime/messageSend.ts` exports drive every subsequent F.a* migration. Unit tests plus signature review required before merge.

- F.a1: Main query send loop import cleanup
  - Scope: migrate `query/deps.ts` and `query.ts` from `services/api/{claude,withRetry,errors,dumpPrompts}` to runtime modules.
  - Estimated files: 3-6.
  - Risk: high. This is the main hot path and must preserve streaming event shape, fallback behavior decisions, and prompt-too-long recovery.

- F.a2: SDK `QueryEngine` and forked-agent usage primitives
  - Scope: migrate `QueryEngine.ts`, `utils/forkedAgent.ts`, `cli/print.ts`, and SDK usage type imports to runtime usage primitives.
  - Estimated files: 4-7.
  - Risk: medium. Mostly mechanical, but result usage and `modelUsage` must remain stable.

- F.a3.1: Non-streaming and small-model helper migration for utils
  - Scope: migrate `utils/sessionTitle.ts`, `utils/mcp/dateTimeParser.ts`, `utils/shell/prefix.ts`, and `utils/hooks/{execPromptHook,apiQueryHookHelper,skillImprovement}.ts`.
  - Estimated files: 6-8.
  - Risk: high. These utility paths have different expectations about aborts, error text, model choice, and returned assistant message shape.

- F.a3.2: Non-streaming and small-model helper migration for commands/components/services
  - Scope: migrate `commands/rename/generateSessionName.ts`, `commands/insights.ts`, `services/awaySummary.ts`, `services/toolUseSummary/toolUseSummaryGenerator.ts`, `components/agents/generateAgent.ts`, and the `queryHaiku` usage in `utils/teleport.tsx` without expanding teleport itself.
  - Estimated files: 6-8.
  - Risk: high. Commands and UI helpers need behavior-preserving output text and error handling while teleport remains a P1.3.G boundary.

- F.a4: WebSearchTool and WebFetchTool native migration
  - Scope: migrate `tools/WebSearchTool/WebSearchTool.ts` from direct `queryModelWithStreaming`, and `tools/WebFetchTool/utils.ts` from `queryHaiku`.
  - Estimated files: 3-5.
  - Risk: high. WebSearch currently forces an Anthropic-style tool schema and parses streamed `tool_use` blocks; DeepSeek tool-call deltas need careful compatibility tests.

- F.a5.1: Compaction token policy migration
  - Scope: migrate `services/compact/{compact,autoCompact,microCompact}.ts` and `utils/context.ts` comments/policy references.
  - Estimated files: about 4.
  - Risk: high. Prompt-too-long handling and max-output-token policy are behavior-sensitive and must be validated before deleting token-estimation code.

- F.a5.2: Token-estimation delete and consumer cleanup
  - Scope: delete `services/tokenEstimation.ts` and replace consumers with `null` / `undefined` displayed counts per the Q2 proposed default.
  - Estimated files: 3-5.
  - Risk: medium-high. This is narrower than exact token-count migration, but callers must tolerate absent counts cleanly.

- F.a6: AgentTool debug and prompt-cache tracking removal
  - Scope: migrate or delete `dumpPrompts.ts` consumers in AgentTool, LogoV2, processSlashCommand, clear-caches; replace prompt-cache-break notifications with DeepSeek cache diagnostics or no-ops.
  - Estimated files: 8-12.
  - Risk: medium. Most paths are debug/ant-only, but cleanup hooks must not leak agent state.

- F.Z: Mid-phase bundle refresh (chore)
  - Scope: rebuild `dist/deepcode-full.mjs` to absorb accumulated drift from F.0 through F.a6.
  - Estimated files: 1 (`dist/deepcode-full.mjs`).
  - Risk: low.
  - Mirrors P1.3.Z.1 precedent: keeps subsequent F.a7/F.a8/F.b dist diffs at source-delta scale instead of accumulating 6+ sub-PRs of drift.

- F.a7: Error and retry utility extraction
  - Scope: migrate `components/messages/*`, `utils/messages.ts`, `utils/preflightChecks.tsx`, `utils/sideQuestion.ts`, `utils/permissions/yoloClassifier.ts`, and non-runtime service users of `getRetryDelay`.
  - Estimated files: 10-16.
  - Risk: medium. Mostly utility extraction, but UI error prefixes and compaction recovery checks are behavior-sensitive.

- F.a8: Session ingress split and teleport boundary
  - Scope: move local session log helpers used by `utils/sessionStorage.ts` and clear-caches into a neutral module; stub or isolate `utils/teleport.tsx` remote session calls for P1.3.G.
  - Estimated files: 4-7.
  - Risk: medium-high. Must respect the anti-corruption rule that Teleport itself is deleted in P1.3.G, not expanded here.

- F.b: Mass delete retained SDK wrappers
  - Scope: delete `services/api/{claude,client,errors,withRetry,dumpPrompts,errorUtils,logging,sessionIngress,promptCacheBreakDetection,emptyUsage}.ts`; run final import audits.
  - Estimated files: 10 deletes plus any final trim.
  - Risk: medium if F.a* import audits are clean; high if any consumer remains.
  - Assumes Q2 default (`tokenEstimation.ts` deleted) and Q5 default (fallback removed) are adopted. If user overrides either, F.b scope adjusts accordingly.

Total planned P1.3.F sub-PRs: 13 (`F.0`, `F.a1`, `F.a2`, `F.a3.1`, `F.a3.2`, `F.a4`, `F.a5.1`, `F.a5.2`, `F.a6`, `F.Z`, `F.a7`, `F.a8`, `F.b`), up from the original 10.

### B3. Risk assessment

Missing or partial DeepSeek features:

- Non-streaming helpers are not first-class yet. The provider can build non-streaming requests, but runtime callers need a stable `AssistantMessage`-returning helper.
- Token estimation still depends on Anthropic client APIs. DeepSeek-native token counting needs either an API-compatible endpoint, a tokenizer dependency, or a documented heuristic.
- Anthropic `cache_control`, 1h TTL, cache editing, and prompt-cache break detection do not map directly to DeepSeek. DeepSeek should use stable-prefix hashing, cache user id, hit/miss usage diagnostics, and no block-level cache controls.
- `withRetry.ts` contains many Anthropic/Bedrock/Vertex auth and 529 behaviors. DeepSeek has only basic HTTP retry logic today. Preserve only generic retry delay and DeepSeek HTTP recovery.
- DeepSeek stream handling has tool-call deltas and reasoning deltas, but WebSearchTool currently depends on a forced Anthropic-style tool schema and should get dedicated tests.
- Error text still contains Anthropic-era concepts in `errors.ts`; migrating it is an opportunity to replace provider-specific wording with DeepCode/DeepSeek runtime wording.
- Session ingress mixes local log persistence with OAuth/teleport retrieval. This file cannot be deleted until those concerns are separated.

Anthropic-specific paths to skip or stub:

- `getCacheControl()` callers should not attempt to emulate Anthropic cache-control blocks. Replace with no-op or DeepSeek cache policy at the runtime request level.
- `dumpPrompts.ts` ant-only request logging can be deleted unless a DeepSeek debug dump is explicitly required.
- `promptCacheBreakDetection.ts` should become no-op notifications or DeepSeek cache diagnostics; do not preserve Anthropic cache-break assumptions.
- Per the Q5 proposed default, `FallbackTriggeredError` and query-loop fallback handling should be removed rather than replaced with a DeepSeek downgrade signal.
- Teleport OAuth session retrieval should not be rebuilt. Keep it as a boundary for P1.3.G.

### B4. Validation strategy

Every migration sub-PR should keep the existing gauntlet:

- `bun run build:full-cli`
- `bun test`
- `npm run test:deepcode --workspace @deepcode-ai/deep-code` or the equivalent `node --test test/deepcode-native.test.mjs test/deepcode-package.test.mjs`
- dist smoke: `printf 'ping\n' | node packages/deep-code/dist/deepcode-full.mjs -p --output-format text`
- idempotency build check
- targeted grep audit for the migrated import group

Additional P1.3.F-specific checks:

- Add unit tests around `services/runtime/messageSend.ts` using fake DeepSeek SSE events:
  - text-only response
  - reasoning plus text
  - tool-call streaming with JSON argument deltas
  - HTTP 429/503 retry mapping
  - abort before request and abort during stream
- Add a non-streaming helper test that returns the same `AssistantMessage` shape expected by existing `queryHaiku`/`queryModelWithoutStreaming` consumers.
- Add WebSearchTool and WebFetchTool fixture tests after their migration because those paths parse tool calls and side-call text.
- Add a token-policy test before replacing `getMaxOutputTokensForModel()` and token estimation.
- For any live DeepSeek smoke, make it env-limited:
  - If `DEEPSEEK_API_KEY` or `DEEPCODE_API_KEY` is present, run a real `-p` query.
  - If absent, run the fake-provider/fixture path so CI remains deterministic.

Final F.b delete validation:

- `grep -RIn "from .*services/api/\\(claude\\|client\\|errors\\|withRetry\\|dumpPrompts\\|errorUtils\\|logging\\|sessionIngress\\|promptCacheBreakDetection\\|emptyUsage\\)" packages/deep-code/src` must return 0 matches.
- Delete-file check for all 10 wrapper files must show gone.
- Runtime smoke must still return `pong`.

### B5. Open questions for user decision

1. Should P1.3.F remove the legacy `DEEPCODE_PROVIDER=anthropic|claude` fallback completely, or keep an explicit unsupported-provider error until a later cleanup?
2. Token estimation strategy - PROPOSED DEFAULT: delete `services/tokenEstimation.ts` entirely. Rationale: DeepCode users do not need Anthropic-style block-level token UI; DeepSeek does not expose a token-count endpoint. Replace any caller-displayed counts with `null` / `undefined`. If a future feature needs estimates, add a heuristic-based DeepSeek-native helper then, for example a `chars / 4` upper bound. User can override this default before F.a5.2 starts.
3. Do we keep any request-dump/debug equivalent for DeepSeek, or delete `dumpPrompts.ts` behavior entirely as ant-only legacy surface?
4. Should `promptCacheBreakDetection.ts` become DeepSeek cache diagnostics, or should cache-break UI/telemetry be removed outright?
5. `FallbackTriggeredError` behavior - PROPOSED DEFAULT: remove fallback functionality entirely. Rationale: Anthropic's multi-model fallback (`opus` to `sonnet` to `haiku`) is a subscription-tier policy that does not apply to DeepSeek. DeepCode users explicitly configure their model. Auto-downgrade to `deepseek-v4-flash` is not in scope. Strip fallback handling from `query.ts`, remove the `FallbackTriggeredError` reference, and remove the `--fallback-model` CLI option later; verified it is still present in `main.tsx`, `cli/print.ts`, and `QueryEngine.ts` wiring. User can override this default before F.a1 starts.
6. Should P1.3.F touch `utils/teleport.tsx` only enough to remove `sessionIngress.ts` imports, or defer all teleport-related import cleanup to P1.3.G even if that means `sessionIngress.ts` survives longer?
7. What is the desired user-facing wording for provider/runtime errors after `errors.ts` is split: "API Error", "DeepSeek API Error", or "DeepCode runtime error"?
8. Should P1.3.F include a live DeepSeek e2e check in CI when credentials are available, or keep all CI validation fixture-only?
