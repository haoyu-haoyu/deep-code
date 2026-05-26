# P1.11 Design - Residual Cleanup and Model Alias Swap

Status: scan and path recommendation
Date: 2026-05-26
Base: `fff8b99ebf4f917a0f60407c35241165da047a27`
Branch: `phase1/p1-11-scan`
Recommendation: Path C - model alias hard cutover plus selective runtime residue cleanup

## Summary

- P1.10 is closed: GrowthBook runtime code is deleted, feature flag calls route through `utils/featureFlags.ts`, OTel strings use `deepcode.*` / `ai.deepcode.*`, and the dist bundle was refreshed.
- P1.11 is the final implementation phase before P1.12 sign-off.
- `docs/model-alias-deprecation.md` is Decided as of 2026-05-10.
- The model-alias decision requires a hard cutover away from `sonnet`, `opus`, and `haiku`.
- `packages/deep-code/sdk-tools.d.ts:274` is the SDK surface that still exposes the legacy union.
- Current SDK union: `model?: "sonnet" | "opus" | "haiku";`
- Target SDK union: `model?: "deepseek-chat" | "deepseek-coder" | "deepseek-reasoner";`
- Bare alias literal scan found 30 source files and 123 occurrences.
- Broader model-family token scan found 97 source files and 725 occurrences.
- The pre-flight estimate said 24 source files; the current tree is larger.
- The 24-file set is still the core alias-cutover scope, but P1.11.A should account for the 6 additional bare-alias files found by grep.
- Residual scan found 610 source files and 5233 occurrences for broad `claude` / `anthropic` / `CLAUDE.md` / `.claude/` / `CLAUDE_CODE_*` / `claude_code.` terms.
- The pre-flight estimate said 262 files; current-tree grep is materially larger because it includes runtime compatibility strings, generated proto paths, comments, user-facing text, and many env compatibility keys.
- Narrow `CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*` scan matches the expected 11 files and 27 occurrences.
- Full `CLAUDE_CODE_*` scan is much broader: 211 files, 680 occurrences, and 198 unique keys.
- `claude_code.` namespace residue after P1.10.A is 0 occurrences in `packages/deep-code/src`.
- P1.12 sign-off should not require deleting every historical or comment-only product reference.
- P1.12 sign-off should require the model alias hard cutover, no P1.10 regression residue, no runtime `claude_code.` OTel namespace strings, and documented acceptability for remaining legacy paths.

## Phase A — Inventory (3 sub-systems)

### A1. Model alias swap inventory

#### A1.1 Decision source

- Decision file: `docs/model-alias-deprecation.md`
- Status: Decided
- Decision date: 2026-05-10
- Policy: hard cutover, no compatibility shim.
- Removed aliases: `"sonnet"`, `"opus"`, `"haiku"`.
- Removed suffix aliases: `"sonnet[1m]"`, `"opus[1m]"` where they are part of alias mechanics.
- Target model names: `"deepseek-chat"`, `"deepseek-coder"`, `"deepseek-reasoner"`.
- Explicit no-go: no auto-map from `opus` to `deepseek-reasoner`.
- Explicit no-go: no accept-with-warning phase.
- Audit fixture note: `audit/anthropic-product-refs.md` is a KEEP fixture per the decision doc and is out of scope for source cleanup.

#### A1.2 SDK type surface

- File: `packages/deep-code/sdk-tools.d.ts`
- Current line: 274
- Current state:

```ts
model?: "sonnet" | "opus" | "haiku";
```

- Target state:

```ts
model?: "deepseek-chat" | "deepseek-coder" | "deepseek-reasoner";
```

- This is the public SDK type surface for spawned-agent model overrides.
- Since DeepCode is self-use only, the hard cutover is acceptable.
- The scan PR does not modify this file.
- P1.11.A should modify it atomically with runtime/schema call sites.

#### A1.3 Bare alias literal scan

- Command shape: `rg --pcre2 "(['\"])(sonnet|opus|haiku)(\\[1m\\])?\\1" packages/deep-code/src`
- Current result: 30 files.
- Current occurrence count: 123.
- The scan includes code, examples, comments, schema descriptions, migrations, UI defaults, and option values.
- The pre-flight 24-file estimate is stale relative to current main.
- Recommendation: P1.11.A should either absorb all 30 files or split the 6 extra adjacent files into a small P1.11.A2 follow-up.
- Avoid changing full model IDs in the same pass unless the file is part of the explicit model-alias behavior.

#### A1.4 Bare alias files by group

##### Migration files

| File | Occurrences | Notes |
|---|---:|---|
| `src/migrations/migrateFennecToOpus.ts` | 3 | Legacy fennec-to-opus settings migration; likely dead after alias hard cutover. |
| `src/migrations/migrateLegacyOpusToCurrent.ts` | 3 | Explicitly promotes older Opus IDs to `opus`; delete candidate. |
| `src/migrations/migrateOpusToOpus1m.ts` | 5 | Promotes `opus` to `opus[1m]`; delete candidate. |
| `src/migrations/migrateSonnet1mToSonnet45.ts` | 6 | Pins `sonnet[1m]`; delete candidate. |

##### Model utility files

| File | Occurrences | Notes |
|---|---:|---|
| `src/utils/model/agent.ts` | 15 | Alias inheritance and subagent options. |
| `src/utils/model/aliases.ts` | 9 | Central family alias list; mandatory cutover. |
| `src/utils/model/contextWindowUpgradeCheck.ts` | 4 | `opus` / `sonnet` upgrade checks. |
| `src/utils/model/model.ts` | 6 | Main parser and permission-mode checks. |
| `src/utils/model/modelAllowlist.ts` | 11 | Admin allowlist semantics for family aliases. |
| `src/utils/model/modelOptions.ts` | 24 | UI option values and 1M variants. |
| `src/utils/betas.ts` | 1 | Haiku-family capability check. |
| `src/utils/effort.ts` | 3 | Legacy family exclusion checks. |
| `src/utils/fastMode.ts` | 1 | `opus` default for fast mode. |
| `src/utils/thinking.ts` | 3 | Family capability checks. |
| `src/utils/toolSearch.ts` | 1 | Unsupported-model pattern default. |

##### Tool and command files

| File | Occurrences | Notes |
|---|---:|---|
| `src/tools/AgentTool/AgentTool.tsx` | 3 | Zod enum for agent model override. |
| `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` | 1 | Built-in agent default model. |
| `src/tools/AgentTool/built-in/exploreAgent.ts` | 1 | External-user fast model. |
| `src/tools/ConfigTool/prompt.ts` | 1 | Prompt example for model setting. |
| `src/tools/ConfigTool/supportedSettings.ts` | 3 | Supported model values returned to config tool. |
| `src/commands/model/model.tsx` | 2 | 1M alias access checks. |

##### Schemas, docs-in-code, and UI

| File | Occurrences | Notes |
|---|---:|---|
| `src/entrypoints/sdk/coreSchemas.ts` | 3 | SDK schema description text. |
| `src/skills/bundled/updateConfig.ts` | 3 | Skill example. |
| `src/components/agents/ModelSelector.tsx` | 1 | Default model value. |
| `src/utils/frontmatterParser.ts` | 3 | Frontmatter comment. |
| `src/utils/plugins/loadPluginCommands.ts` | 3 | Plugin command alias resolver comment. |
| `src/utils/settings/types.ts` | 1 | Settings schema description. |
| `src/utils/words.ts` | 1 | Word list entry. |

##### Additional bare-alias files outside the pre-flight list

| File | Occurrences | Notes |
|---|---:|---|
| `src/services/MagicDocs/magicDocs.ts` | 1 | Runtime default `model: 'sonnet'`. |
| `src/services/rateLimitMocking.ts` | 1 | `currentModel.includes('opus')`; likely dead/rate-limit polish. |
| `src/migrations/migrateFennecToOpus.ts` | 3 | Not listed in pre-flight but still alias migration. |
| `src/migrations/migrateOpusToOpus1m.ts` | 5 | Not listed in pre-flight but still alias migration. |
| `src/tools/ConfigTool/*` | 4 | Config tool examples and values not listed in pre-flight. |
| `src/components/agents/ModelSelector.tsx` | 1 | UI default not listed in pre-flight. |

#### A1.5 Broad alias-token scan

- Command shape: `rg "\\b(sonnet|opus|haiku)\\b" packages/deep-code/src`
- Current result: 97 files.
- Current occurrence count: 725.
- This broader scan includes full Claude model IDs such as `claude-opus-4-6`.
- It also includes comments, deprecation messages, fixture-like strings, and legacy rate-limit code.
- This is too broad for a single hard-cutover PR.
- Use it as a risk map, not the mandatory P1.11.A edit list.
- Files with high broad-token counts include `utils/model/model.ts`, `utils/model/modelOptions.ts`, `utils/model/configs.ts`, `services/mockRateLimits.ts`, and migration files.

#### A1.6 Suggested alias replacement policy

| Current pattern | Suggested P1.11 handling |
|---|---|
| SDK union `"sonnet" | "opus" | "haiku"` | Replace with DeepSeek union exactly. |
| Zod enum `['sonnet', 'opus', 'haiku']` | Replace with DeepSeek enum. |
| Default `model: 'sonnet'` | Prefer `deepseek-chat` unless reasoning/tooling needs `deepseek-reasoner`. |
| Default `model: 'haiku'` | Prefer `deepseek-chat` for small/fast paths unless a local small-model alias is added separately. |
| Default `model: 'opus'` | Prefer `deepseek-reasoner` only when the call path explicitly needs reasoning; otherwise `deepseek-chat`. |
| `sonnet[1m]` / `opus[1m]` migrations | Delete if migration is dead after hard cutover. |
| Full Claude model IDs | Do not blindly replace in P1.11.A; many require semantic model-system cleanup. |
| Comments and examples | Update only when adjacent to runtime schema/edit. |

#### A1.7 Mandatory P1.11.A source considerations

- `sdk-tools.d.ts` must change in the same PR as schema enforcement.
- `entrypoints/sdk/coreSchemas.ts` must not advertise old aliases after the SDK union changes.
- `tools/AgentTool/AgentTool.tsx` Zod schema must match the SDK type.
- `tools/ConfigTool/supportedSettings.ts` should stop returning old aliases.
- Built-in agents using `haiku` should get an explicit DeepSeek target.
- Model UI option files must not leave selectable `sonnet`, `opus`, or `haiku` values.
- Migration files that only map old Claude aliases should be deleted or made unreachable.
- Tests should include a type/schema check that `sonnet` is rejected and `deepseek-reasoner` is valid.

### A2. Residual cleanup audit (262-file estimate expanded)

#### A2.1 Counting methodology

- Broad scan regex: `claude|anthropic|CLAUDE.md|.claude/|CLAUDE_CODE_*|claude_code.`
- Scope: `packages/deep-code/src`.
- The broad scan is intentionally inclusive.
- It catches runtime strings, comments, generated paths, env compatibility names, config paths, docs-in-code, and model IDs.
- It does not include `audit/`, `docs/`, `dist/`, or tests outside `src`.
- Current-tree result is larger than pre-flight.
- The scan doc records the current tree rather than forcing the old estimate.

#### A2.2 Residual summary table

| Residue bucket | Files | Occurrences | Sign-off stance |
|---|---:|---:|---|
| Broad all-residue scan | 610 | 5233 | Planning map only; too broad for mandatory cleanup. |
| `claude.ai` / `claude-code` / `claude code` | 170 | 401 | Selectively clean user-facing/runtime names; keep historical/action IDs if needed. |
| `anthropic` / `Anthropic` | 163 | 726 | Runtime provider/base-url residue needs review; comments and upstream issue refs may remain. |
| `CLAUDE.md` | 51 | 97 | Runtime legacy fallback may remain if explicitly accepted; user-facing docs should prefer `DEEPCODE.md`. |
| `.claude/` | 97 | 261 | Runtime legacy path fallback may remain; new writes should prefer `.deepcode/`. |
| Full `CLAUDE_CODE_*` | 211 | 680 | Too broad; many are compatibility envs. Track separate key policy. |
| Narrow `CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*` | 11 | 27 | High-priority P1.11.B cleanup bucket. |
| `claude_code.` namespace | 0 | 0 | P1.10.A success condition remains satisfied. |

#### A2.3 Comment-only vs runtime/string estimate

- Heuristic comment-only files: 148.
- Runtime-or-string files: 462.
- This is a heuristic, not a compiler-level classification.
- It treats string literals, object keys, import paths, env reads, and generated type paths as runtime/string.
- It treats line comments and block-comment lines as comment-only.
- Many runtime/string files are acceptable compatibility surfaces, not mandatory blockers.
- P1.12 should require a documented allowlist rather than total zero.

#### A2.4 `claude.ai` / `claude-code` samples

| File and line | Sample | Category |
|---|---|---|
| `services/analytics/metadata.ts:95` | `claude.ai-proxied connectors` | Comment/runtime classification text. |
| `services/analytics/metadata.ts:628` | `claude-code-action/` | GitHub Action path compatibility. |
| `services/analytics/firstPartyEventLogger.ts:275` | service name `claude-code` | Runtime telemetry name; needs decision. |
| `services/analytics/firstPartyEventLoggingExporter.ts:534` | header `x-service-name: claude-code` | Runtime telemetry/export header; needs decision. |
| `services/analytics/datadog.ts:250` | service `claude-code` | Runtime telemetry; likely must clean if still shipped. |
| `services/settingsSync/index.ts:4` | comment mentioning Claude Code environments | Comment polish. |
| `services/mcp/auth.ts:1419` | OAuth client name `Claude Code (...)` | Runtime user-facing auth name; likely must clean. |
| `services/mcp/SdkControlTransport.ts:5` | CLI process comment | Comment polish. |

#### A2.5 `Anthropic` samples

| File and line | Sample | Category |
|---|---|---|
| `services/analytics/firstPartyEventLoggingExporter.ts:105` | `ANTHROPIC_BASE_URL` staging comment | Runtime env compatibility. |
| `services/analytics/firstPartyEventLoggingExporter.ts:109` | `https://api-staging.anthropic.com` | Runtime endpoint, must review separately. |
| `services/teamMemorySync/index.ts:8` | `anthropic/anthropic#250711` | Historical internal issue reference. |
| `services/teamMemorySync/index.ts:145` | `isFirstPartyAnthropicBaseUrl()` | Runtime provider helper, likely P1.11/C or P2. |
| `utils/settings/types.ts:395` | provider-specific Anthropic model mapping example | Schema description/user-facing docs. |
| `utils/model/bedrock.ts:178` | Bedrock foundation model example | Provider-specific compatibility. |

#### A2.6 `CLAUDE.md` samples

| File and line | Sample | Category |
|---|---|---|
| `services/MagicDocs/prompts.ts:54` | `Information already in CLAUDE.md` | Prompt/user-facing text. |
| `services/settingsSync/types.ts:63` | `~/.claude/CLAUDE.md` | Runtime legacy path. |
| `deepcode/instruction-paths.mjs:6` | `LEGACY_CLAUDE_INSTRUCTION_FILE = 'CLAUDE.md'` | Intentional legacy fallback. |
| `Tool.ts:217` | `DEEPCODE.md/legacy CLAUDE.md` | Comment documenting compatibility. |
| `main.tsx:905` | `DEEPCODE.md/legacy CLAUDE.md` | Comment documenting compatibility. |
| `utils/claudemd.ts:9` | legacy path fallback comment | Runtime compatibility module. |
| `utils/permissions/yoloClassifier.ts:471` | prompt string says user's `CLAUDE.md` configuration | Runtime prompt; candidate for P1.11.C. |

#### A2.7 `.claude/` path samples

| File and line | Sample | Category |
|---|---|---|
| `services/settingsSync/types.ts:62` | `~/.claude/settings.json` | Runtime legacy settings path. |
| `services/settingsSync/types.ts:65` | `projects/.../.claude/settings.local.json` | Runtime legacy settings path. |
| `services/plugins/pluginOperations.ts:490` | `.claude/settings.json` user-facing warning | Runtime/user-facing path. |
| `main.tsx:1585` | `.claude/settings.json PATH/GIT_DIR...` | Comment/runtime behavior note. |
| `utils/claudemd.ts:886` | `.deepcode/rules` fallback to `.claude/rules` | Intentional legacy fallback. |
| `utils/permissions/filesystem.ts:1252` | `.claude/**` safety bypass handling | Security-sensitive compatibility. |
| `components/TrustDialog/utils.ts:34` | `.claude/settings.json` source label | User-facing runtime source label. |

#### A2.8 `CLAUDE_CODE_*` full env bucket

- Full scan files: 211.
- Full scan occurrences: 680.
- Unique keys: 198.
- This is much larger than the 11-file pre-flight bucket.
- Many keys are deliberate compatibility names or managed-host variables.
- P1.11.B should not rename all 198 keys blindly.
- P1.11.B should focus on narrow debug/max/print/big keys and keys that have already gained a `DEEPCODE_*` dual-name.
- P1.11.B should define whether legacy keys are removed, dual-read, or documented as accepted compatibility.

#### A2.9 Narrow `CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*` bucket

| File | Notes |
|---|---|
| `src/query.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` guard. |
| `src/services/tools/toolOrchestration.ts` | `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`. |
| `src/services/runtime/tokenPolicy.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` primary runtime read. |
| `src/services/runtime/__tests__/messageSend.test.ts` | Tests for max output tokens and retries. |
| `src/services/runtime/errors.ts` | `CLAUDE_CODE_MAX_RETRIES`. |
| `src/ink/reconciler.ts` | `CLAUDE_CODE_DEBUG_REPAINTS`. |
| `src/ink/dom.ts` | `CLAUDE_CODE_DEBUG_REPAINTS` comments. |
| `src/utils/context.ts` | `CLAUDE_CODE_MAX_CONTEXT_TOKENS`. |
| `src/utils/debug.ts` | `CLAUDE_CODE_DEBUG_LOG_LEVEL`, `CLAUDE_CODE_DEBUG_LOGS_DIR`. |
| `src/utils/managedEnvConstants.ts` | managed allowlist includes max output tokens. |
| `src/screens/Doctor.tsx` | diagnostics entry for max output tokens. |

#### A2.10 `CLAUDE_CODE_*` top keys

| Env key | Occurrences | Files | Notes |
|---|---:|---:|---|
| `CLAUDE_CODE_REMOTE` | 29 | 21 | Remote/session compatibility; not a quick rename. |
| `CLAUDE_CODE_SIMPLE` | 20 | 14 | Bare/simple mode compatibility. |
| `CLAUDE_CODE_ENTRYPOINT` | 13 | 11 | Entrypoint compatibility; main and SDK. |
| `CLAUDE_CODE_NO_FLICKER` | 12 | 4 | UI flag; dual-name candidate. |
| `CLAUDE_CODE_REMOTE_MEMORY_DIR` | 12 | 3 | Memory/session compatibility. |
| `CLAUDE_CODE_SHELL_PREFIX` | 12 | 3 | MCP shell prefix compatibility. |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | 11 | 10 | Tool/task behavior. |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 11 | 5 | P1.11.B candidate. |
| `CLAUDE_CODE_COORDINATOR_MODE` | 10 | 6 | Coordinator compatibility. |
| `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` | 10 | 4 | Plugin install compatibility. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | 9 | 4 | Beta API gate. |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR` | 9 | 4 | Plugin cache compatibility. |
| `CLAUDE_CODE_TMUX_PREFIX` | 9 | 2 | Tmux UI. |
| `CLAUDE_CODE_USE_BEDROCK` | 9 | 8 | Provider selection compatibility. |
| `CLAUDE_CODE_AGENT_ID` | 8 | 7 | Teammate/subagent identity. |

#### A2.11 OTel namespace residue

- `rg "claude_code\\." packages/deep-code/src` returns 0.
- `rg "com\\.anthropic\\.claude_code" packages/deep-code/src` should remain 0 from P1.10.A.
- Current DeepCode OTel strings include `ai.deepcode.events`, `ai.deepcode`, `deepcode.interaction`, `deepcode.llm_request`, `deepcode.tool`, `deepcode.hook`, and `deepcode.<eventName>`.
- Remaining generated file path `types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts` is a path/package artifact, not a `claude_code.` namespace string.
- That generated path remains a P1.11/P2 decision, not a P1.10 regression.

#### A2.12 Top 30 residue files by broad count

| Rank | File | Count | Initial classification |
|---:|---|---:|---|
| 1 | `src/utils/permissions/filesystem.ts` | 125 | Security-sensitive `.claude/` compatibility; do not bulk-rewrite. |
| 2 | `src/utils/commitAttribution.ts` | 121 | Product/model wording; likely polish plus generated strings. |
| 3 | `src/main.tsx` | 119 | Mixed runtime env/path/comment residue; split carefully. |
| 4 | `src/skills/bundled/claudeApiContent.ts` | 96 | Likely Anthropic API skill content; candidate for delete or rewrite. |
| 5 | `src/services/mockRateLimits.ts` | 92 | Legacy rate-limit surface; likely delete candidate if dead. |
| 6 | `src/utils/managedEnvConstants.ts` | 90 | Env compatibility allowlists; must be policy-driven. |
| 7 | `src/constants/oauth.ts` | 85 | OAuth Anthropic endpoints/env; high-risk runtime. |
| 8 | `src/utils/plugins/schemas.ts` | 81 | Plugin schema text and `.claude` settings; selective. |
| 9 | `src/utils/model/configs.ts` | 80 | Claude model ID configs; model-system cleanup. |
| 10 | `src/utils/model/model.ts` | 80 | Alias/model parser; P1.11.A critical. |
| 11 | `src/components/mcp/MCPRemoteServerMenu.tsx` | 79 | User-facing `.claude`/Claude wording; polish/runtime. |
| 12 | `src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts` | 72 | Generated proto path/type names; avoid manual churn unless regenerating. |
| 13 | `src/utils/claudemd.ts` | 72 | Legacy fallback module; P1.11.C selective cleanup. |
| 14 | `src/services/mcp/client.ts` | 55 | MCP compatibility; high-risk. |
| 15 | `src/services/mcp/useManageMCPConnections.ts` | 55 | MCP UI/runtime; selective. |
| 16 | `src/commands/insights.ts` | 54 | User-facing report content; polish/backlog. |
| 17 | `src/services/analytics/metadata.ts` | 54 | Telemetry metadata; P1.11.C/P2 decision. |
| 18 | `src/utils/permissions/yoloClassifier.ts` | 54 | Runtime prompt and env fallback; critical review. |
| 19 | `src/screens/REPL.tsx` | 53 | Mixed runtime/user-facing residue. |
| 20 | `src/services/mcp/config.ts` | 48 | MCP config compatibility. |
| 21 | `src/utils/config.ts` | 46 | Legacy config/cache paths; migration support. |
| 22 | `src/utils/betas.ts` | 45 | Model capability residue; P1.11.A adjacent. |
| 23 | `src/utils/nativeInstaller/installer.ts` | 44 | Installer paths and user text. |
| 24 | `src/utils/envUtils.ts` | 42 | Provider/model env mapping; P1/P2 boundary. |
| 25 | `src/utils/doctorDiagnostic.ts` | 41 | Doctor user-facing text; polish. |
| 26 | `src/utils/plugins/marketplaceManager.ts` | 39 | Plugin settings paths; selective. |
| 27 | `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` | 38 | Built-in guide agent naming; P1.11.A/P1.11.C candidate. |
| 28 | `src/utils/settings/types.ts` | 37 | Settings schema descriptions; user-facing. |
| 29 | `src/components/permissions/FilePermissionDialog/permissionOptions.tsx` | 35 | `.claude/` permission UI; runtime/user-facing. |
| 30 | `src/utils/markdownConfigLoader.ts` | 35 | `.claude` command/config discovery; high-risk compatibility. |

#### A2.13 Must-clean vs acceptable buckets

| Bucket | Stance | Reason |
|---|---|---|
| SDK aliases | Must clean | Decided hard cutover. |
| Runtime selectable model aliases | Must clean | Users should not select old model families after P1.11. |
| Zod/schema aliases | Must clean | Runtime validation must match SDK union. |
| Dead alias migrations | Must delete or disable | They write old aliases into settings. |
| Narrow debug/max env keys | Should clean | Direct P1.6 follow-up residue and small scope. |
| `claude_code.` OTel namespace | Must be 0 | P1.10.A invariant; already satisfied. |
| `@anthropic-ai/sdk` imports | Must stay 0 | P1.8 invariant. |
| `@growthbook/growthbook` imports | Must stay 0 | P1.10 invariant. |
| Generated proto path `claude_code/v1` | Accept with decision | Regeneration/package rename risk; not a string namespace regression. |
| Legacy `.claude/` read fallback | Accept if documented | User migration safety; should prefer `.deepcode/` writes. |
| `CLAUDE.md` fallback | Accept if documented | Backward compatibility from P1.5; P1.12 can allow it. |
| Audit fixtures | Keep | Decision doc explicitly excludes `audit/anthropic-product-refs.md`. |
| Historical comments/internal issue refs | Polish backlog | Churn risk and low runtime impact. |

### A3. P1.12 sign-off prerequisites

#### A3.1 Sign-off blockers

- `packages/deep-code/src` has 0 `@anthropic-ai/sdk` imports.
- `packages/deep-code/src` has 0 `@growthbook/growthbook` imports.
- `packages/deep-code/src` has 0 `services/analytics/growthbook` imports.
- `packages/deep-code/src` has 0 `claude_code.` OTel namespace strings.
- `packages/deep-code/src` has 0 `com.anthropic.claude_code` namespace strings.
- `sdk-tools.d.ts` no longer accepts `"sonnet"`, `"opus"`, or `"haiku"`.
- Runtime schemas no longer accept `"sonnet"`, `"opus"`, or `"haiku"` as model override aliases.
- No migration writes `sonnet`, `opus`, `haiku`, `sonnet[1m]`, or `opus[1m]` into settings.
- Dist bundle is refreshed after source cleanup.
- Full suite passes.
- P1.11 cite row updates `EXECUTION_LOG.md` and advances P1.12 to sign-off.

#### A3.2 Acceptable with explicit allowlist

- Legacy `CLAUDE.md` fallback reads if the preferred path is `DEEPCODE.md`.
- Legacy `.claude/` fallback reads if writes prefer `.deepcode/` where feasible.
- `CLAUDE_CODE_*` dual-name env compatibility where removing the old name would break local/dev workflows.
- Generated proto path package artifacts if no regenerated proto source exists.
- Historical `anthropic/anthropic#...` issue references when they explain server contracts.
- Audit fixtures and decision-doc examples.

#### A3.3 P1.12 validation checklist

- Run `rg "@anthropic-ai/sdk" packages/deep-code/src` and confirm 0.
- Run `rg "@growthbook/growthbook|services/analytics/growthbook" packages/deep-code/src` and confirm 0.
- Run `rg "claude_code\\.|com\\.anthropic\\.claude_code" packages/deep-code/src` and confirm 0.
- Run model alias hard-cutover grep for quoted bare aliases and confirm only approved comments/fixtures remain.
- Run `rg "model\\?: \\\"sonnet\\\"|\\\"opus\\\"|\\\"haiku\\\"" packages/deep-code/sdk-tools.d.ts` and confirm 0.
- Run `rg "CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)" packages/deep-code/src` and confirm P1.11.B status.
- Run `.claude/` and `CLAUDE.md` inventory and compare against the explicit allowlist.
- Run `bun run build:full-cli`.
- Run `bun test`.
- Confirm `dist/deepcode-full.mjs` was regenerated in the Z PR only.
- Confirm `EXECUTION_LOG.md` records P1.11 closed and P1.12 ready/done.

## Phase B — Path options

### Path A - Aggressive: clean all residue files

| Dimension | Assessment |
|---|---|
| Scope | Clean the full broad residue set: currently 610 source files and 5233 occurrences. |
| Model aliases | Clean all 30 bare-alias files and all broad model-token files. |
| Env keys | Rename or remove all 198 unique `CLAUDE_CODE_*` keys. |
| Paths | Rewrite all `CLAUDE.md` and `.claude/` mentions. |
| Telemetry | Rename all service/header/product strings. |
| PR count | Likely 15-25 PRs after blast-radius splits. |
| Pros | Lowest visible legacy residue at final sign-off. |
| Cons | Very high churn, high fixture risk, high chance of breaking legacy fallback behavior. |
| Verdict | Not recommended for P1.11. |

#### Path A details

- The broad scan includes many files that are intentionally compatibility surfaces.
- Security-sensitive `.claude/` path logic cannot be mechanically renamed.
- OAuth and provider endpoint strings may still be required for first-party service compatibility.
- Generated proto paths may require toolchain regeneration rather than manual edits.
- Removing all env compatibility names in one phase would be a product behavior change, not polish.
- Path A would delay P1.12 and increase regression risk.

### Path B - Critical-only: clean only runtime / non-comment residue

| Dimension | Assessment |
|---|---|
| Scope | SDK aliases, runtime model aliases, narrow env keys, and selected runtime path strings. |
| Model aliases | Full hard cutover. |
| Env keys | Narrow 11-file debug/max bucket. |
| Paths | Only runtime path strings that actively write or promote legacy names. |
| Comments | Mostly untouched. |
| PR count | 4-7 PRs. |
| Pros | Low risk and fast sign-off. |
| Cons | Leaves user-facing comment/text residue and broad scans noisy. |
| Verdict | Viable but underspecified for P1.12 optics. |

#### Path B details

- This path gets the required functional changes done.
- It avoids touching large comment-only files.
- It probably leaves `claude-code` telemetry service names and `.claude/` UI labels unless specifically classified as runtime.
- It needs a strong P1.12 allowlist to avoid arguing about every remaining grep hit.
- It may be perceived as too lax because broad residue counts remain high.

### Path C - Hybrid: alias hard cutover + selective residue cleanup

| Dimension | Assessment |
|---|---|
| Scope | Mandatory model alias hard cutover plus selective runtime-impact residue. |
| Model aliases | Clean all SDK/schema/runtime bare aliases. |
| Env keys | Clean the narrow 11-file debug/max bucket and define policy for broader keys. |
| Paths | Clean critical runtime write paths; keep documented legacy read fallback. |
| Comments | Clean only adjacent or user-facing comments in touched files. |
| Audit/history | Keep as explicit allowlist/backlog. |
| PR count | Estimated 7-10 PRs. |
| Pros | Meets Decided alias policy, keeps P1.12 reachable, avoids broad mechanical churn. |
| Cons | Requires P1.12 to accept documented polish residue. |
| Verdict | Recommended. |

#### Path C details

- P1.11.A should be strict on model aliases.
- P1.11.B should be strict on the narrow env bucket.
- P1.11.C should be selective on runtime `.claude/` / `CLAUDE.md` path behavior.
- P1.11.D should delete dead alias migrations if no longer needed.
- P1.11.E should explicitly decide what residue remains acceptable.
- P1.11.Z refreshes the dist bundle after source cleanup.
- P1.11.cite closes the phase and sets P1.12 sign-off conditions.

## Phase C — Recommended path + rationale

### Recommendation

Choose Path C.

### Rationale

- The model alias hard cutover is already Decided and should not be watered down.
- The current tree has more alias and residue hits than the pre-flight estimate.
- Treating all 610 broad residue files as blockers would turn a final cleanup phase into a large rewrite phase.
- Runtime-impact residue is where P1.12 risk actually lives.
- Comment-only and historical references can be documented as polish backlog without blocking sign-off.
- The narrow env bucket matches the expected 11-file P1.6 follow-up and is small enough to complete safely.
- The generated proto path should not be hand-edited unless a regeneration plan exists.
- Path C mirrors the pragmatic style used in P1.8 and P1.10: hard functional cutover first, then contained cleanup and citation.

### Recommended acceptance criteria

- `sdk-tools.d.ts` exposes only DeepSeek model names.
- Runtime model schemas and UI choices no longer offer `sonnet`, `opus`, or `haiku`.
- Dead model alias migrations are deleted or made unreachable.
- Narrow `CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*` residue is either renamed or explicitly dual-read with `DEEPCODE_*` priority.
- `CLAUDE.md` and `.claude/` runtime reads are classified as legacy fallback, not accidental residue.
- P1.12 sign-off includes an allowlist for remaining legacy strings.

## Phase D — Sub-PR breakdown for recommended path

### D1. P1.11.A - model alias hard cutover

- Scope: `sdk-tools.d.ts` plus source alias consumers.
- Expected files: 1 SDK type file plus 30 bare-alias source files, unless split.
- Required changes:
- Replace SDK union with `deepseek-chat`, `deepseek-coder`, `deepseek-reasoner`.
- Replace Zod enums and runtime schema descriptions.
- Replace UI option values.
- Replace built-in agent defaults.
- Remove or rewrite settings examples.
- Keep call semantics clear for `deepseek-chat` vs `deepseek-reasoner`.
- Do not bulk-rewrite full Claude model IDs in unrelated compatibility files.
- Add/adjust tests for valid and invalid model values if local patterns exist.
- Verification:
- `rg --pcre2 "(['\"])(sonnet|opus|haiku)(\\[1m\\])?\\1" packages/deep-code/src` returns only documented leftovers or 0.
- SDK type check rejects `"sonnet"`.
- SDK type check accepts `"deepseek-reasoner"`.
- `bun test` passes.

### D2. P1.11.B - narrow env residue cleanup

- Scope: 11 files in the `CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*` bucket.
- Target files:
- `src/query.ts`
- `src/services/tools/toolOrchestration.ts`
- `src/services/runtime/tokenPolicy.ts`
- `src/services/runtime/__tests__/messageSend.test.ts`
- `src/services/runtime/errors.ts`
- `src/ink/reconciler.ts`
- `src/ink/dom.ts`
- `src/utils/context.ts`
- `src/utils/debug.ts`
- `src/utils/managedEnvConstants.ts`
- `src/screens/Doctor.tsx`
- Required decision:
- Rename to `DEEPCODE_*` only, or support `DEEPCODE_*` first with `CLAUDE_CODE_*` fallback.
- Recommendation:
- Use `DEEPCODE_*` primary plus legacy fallback for one phase if the key is developer-facing and may exist in local scripts.
- Remove legacy fallback only where P1.6 already established no external dependency.
- Verification:
- Narrow grep falls to 0 or documented dual-name allowlist.
- Tests updated for the new primary key.

### D3. P1.11.C - runtime path string cleanup

- Scope: critical `.claude/` and `CLAUDE.md` runtime path strings.
- Candidate areas:
- `src/deepcode/instruction-paths.mjs`
- `src/utils/claudemd.ts`
- `src/services/settingsSync/types.ts`
- `src/components/TrustDialog/utils.ts`
- `src/utils/permissions/filesystem.ts`
- `src/commands/init.ts`
- `src/components/ClaudeMdExternalIncludesDialog.tsx`
- Recommended rule:
- Prefer `.deepcode/` and `DEEPCODE.md` for new writes and user-facing primary text.
- Keep legacy `.claude/` and `CLAUDE.md` reads as fallback if explicitly named `legacy`.
- Do not weaken security checks around `.claude/` dangerous directories.
- Verification:
- New-path tests still pass.
- Legacy fallback tests still pass or are updated to explicit legacy behavior.

### D4. P1.11.D - model migration cleanup

- Scope: old model migration files and `main.tsx` migration registration.
- Candidate files:
- `src/migrations/migrateFennecToOpus.ts`
- `src/migrations/migrateLegacyOpusToCurrent.ts`
- `src/migrations/migrateOpusToOpus1m.ts`
- `src/migrations/migrateSonnet1mToSonnet45.ts`
- `src/main.tsx`
- Current callers:
- `main.tsx` imports all four files.
- `runMigrations()` calls all four files.
- Risk:
- Deleting migration files changes behavior for old settings.
- The model-alias decision says hard cutover with no auto-mapping, so these migrations are likely contrary to the new policy.
- Verification:
- `rg "migrateFennecToOpus|migrateLegacyOpusToCurrent|migrateOpusToOpus1m|migrateSonnet1mToSonnet45" packages/deep-code/src` returns 0 after deletion.
- Settings migration tests updated or removed.

### D5. P1.11.E - residue allowlist and audit decision

- Scope: documentation-only or small source allowlist if an allowlist module already exists.
- Purpose:
- Decide what remains acceptable for P1.12.
- Classify audit fixtures, generated proto paths, historical issue refs, legacy fallback paths, and dual-name env vars.
- Explicitly keep `audit/anthropic-product-refs.md`.
- Recommendation:
- Do not edit `audit/` in P1.11.
- Add a short P1.12 sign-off checklist entry in the cite PR rather than a new runtime allowlist module unless tests need it.

### D6. P1.11.F - optional user-facing product text polish

- Scope: only if P1.11.A-C leave high-visibility text.
- Candidate files:
- `src/services/mcp/auth.ts`
- `src/components/mcp/MCPRemoteServerMenu.tsx`
- `src/screens/Doctor.tsx`
- `src/utils/doctorDiagnostic.ts`
- `src/commands/init.ts`
- `src/components/AutoUpdater.tsx`
- Recommendation:
- Keep this optional.
- Do not block P1.12 if functional invariants are clean.

### D7. P1.11.Z - dist refresh

- Scope: `packages/deep-code/dist/deepcode-full.mjs` only.
- Run after source cleanup.
- Mirror P1.8.Z and P1.10.Z.
- Expected effect:
- Remove old alias/schema strings from the shipped bundle.
- Possibly reduce bundle size if migration files or legacy modules are deleted.
- Verification:
- `bun run build:full-cli` passes.
- Second build is byte-identical.
- `bun test` passes.
- Diff is exactly one dist file.

### D8. P1.11.cite - close phase

- Scope: `EXECUTION_LOG.md` only.
- Cite all P1.11 PRs.
- Mark P1.11 done.
- Advance A track to P1.12 sign-off.
- Include final counts:
- model alias files cleaned.
- env narrow bucket status.
- `.claude/` / `CLAUDE.md` allowlist status.
- dist refresh SHA and line delta.
- Verification:
- `bun test` passes.
- Diff is exactly `EXECUTION_LOG.md`.

### D9. Estimated total

- Recommended PR count: 7-10.
- Expected source file touches: approximately 45-75, depending on whether P1.11.A absorbs all 30 bare-alias files and whether P1.11.C is split.
- Expected docs/dist/cite files: 2-3.
- Expected total file touches across Path C: approximately 50-85.
- If Path C expands into user-facing polish, total file touches could exceed 100.

## Phase E — Risk assessment

### E1. Model alias hard cutover

- Risk: existing settings or sessions with `model: "sonnet"` fail.
- Risk: old model aliases in agent frontmatter fail validation.
- Risk: built-in agent defaults change behavior if `haiku` is mapped too aggressively.
- Decision doc accepts this risk because DeepCode is self-use only.
- Mitigation: choose explicit DeepSeek defaults based on behavior.
- Mitigation: delete old migrations so the app does not write removed aliases back into settings.
- Mitigation: add validation tests for accepted and rejected values.

### E2. Broader model-family cleanup

- Risk: full Claude model IDs are still used in model config, provider compatibility, Bedrock/Vertex mappings, and historical code.
- Risk: replacing all `opus` / `sonnet` / `haiku` tokens blindly can break canonical-name logic.
- Mitigation: hard cutover only bare alias values first.
- Mitigation: defer full model ID cleanup to a model-system follow-up if needed.

### E3. `CLAUDE_CODE_*` env key cleanup

- Risk: local scripts, CI, or developer workflows may still set legacy keys.
- Risk: broad scan has 198 unique env keys, too many to safely rename at once.
- Risk: managed-host keys may be externally supplied even in self-use contexts.
- Mitigation: handle narrow debug/max bucket first.
- Mitigation: prefer `DEEPCODE_*` primary with legacy fallback when uncertain.
- Mitigation: document any remaining dual-name keys in P1.12 sign-off.

### E4. `.claude/` and `CLAUDE.md` path cleanup

- Risk: `.claude/` path logic is security-sensitive in permissions and sandbox code.
- Risk: changing safety checks could create unintended allow/deny behavior.
- Risk: removing legacy reads could lose user instructions/settings.
- Mitigation: prefer new writes and user-facing primary names while keeping legacy reads.
- Mitigation: do not touch permission safety code unless tests cover it.
- Mitigation: classify legacy fallback as acceptable if explicit.

### E5. Generated proto path

- Risk: `src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts` contains generated type names and path/package residue.
- Risk: manual edits can diverge from generated source.
- Risk: renaming the path may require imports across analytics/telemetry and a proto regeneration toolchain.
- Mitigation: keep generated path accepted for P1.12 unless a proto regeneration PR is scoped.
- Mitigation: P1.10.A already fixed actual OTel namespace strings.

### E6. Audit/history files

- Risk: cleaning audit history destroys evidence from earlier phases.
- Risk: audit fixtures intentionally contain product references for regression checks.
- Mitigation: keep `audit/anthropic-product-refs.md`.
- Mitigation: cite audit residue as explicitly allowed in P1.12.

### E7. Dist refresh

- Risk: source cleanup without dist refresh leaves old strings in the shipped bundle.
- Mitigation: include P1.11.Z after source PRs.
- Mitigation: verify idempotency with two builds.
- Mitigation: keep Z PR dist-only.

## Phase F — Key decision questions

### Q1. Path A/B/C choice

- Recommendation: Path C.
- Reason: alias hard cutover is mandatory, but all-residue cleanup is too broad for P1.11.

### Q2. Should comments containing "Anthropic" / "Claude" be changed?

- Recommendation: only in files already touched for runtime cleanup or high-visibility user text.
- Do not spend P1.11 on comment-only churn.

### Q3. How should `audit/` be handled?

- Recommendation: keep.
- Reason: `docs/model-alias-deprecation.md` explicitly excludes audit fixtures.
- P1.12 should say audit residue is acceptable history.

### Q4. Should dead model migrations be deleted?

- Recommendation: yes, if P1.11.A removes alias support.
- Reason: migrations that write `opus`, `opus[1m]`, or `sonnet[1m]` conflict with hard cutover.
- Implementation: delete files and remove imports/calls from `main.tsx` in a dedicated PR.

### Q5. How much polish residue can P1.12 accept?

- Recommendation: accept comment-only, audit/history, generated proto path, and explicit legacy fallback residue.
- Blockers should be limited to SDK/runtime aliases, P1.10 regressions, source imports, and undocumented runtime old-name writes.

### Q6. Should `CLAUDE_CODE_*` runtime keys be renamed to `DEEPCODE_*` or dual-read?

- Recommendation: `DEEPCODE_*` primary plus legacy fallback for uncertain developer-facing keys; direct rename only where tests and local usage prove safety.
- P1.11.B should decide per key and document the policy for P1.12.

## Phase G — Reference appendix

### G1. Bare model alias file list

| Count | File |
|---:|---|
| 2 | `packages/deep-code/src/commands/model/model.tsx` |
| 1 | `packages/deep-code/src/components/agents/ModelSelector.tsx` |
| 3 | `packages/deep-code/src/entrypoints/sdk/coreSchemas.ts` |
| 3 | `packages/deep-code/src/migrations/migrateFennecToOpus.ts` |
| 3 | `packages/deep-code/src/migrations/migrateLegacyOpusToCurrent.ts` |
| 5 | `packages/deep-code/src/migrations/migrateOpusToOpus1m.ts` |
| 6 | `packages/deep-code/src/migrations/migrateSonnet1mToSonnet45.ts` |
| 1 | `packages/deep-code/src/services/MagicDocs/magicDocs.ts` |
| 1 | `packages/deep-code/src/services/rateLimitMocking.ts` |
| 3 | `packages/deep-code/src/skills/bundled/updateConfig.ts` |
| 3 | `packages/deep-code/src/tools/AgentTool/AgentTool.tsx` |
| 1 | `packages/deep-code/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` |
| 1 | `packages/deep-code/src/tools/AgentTool/built-in/exploreAgent.ts` |
| 1 | `packages/deep-code/src/tools/ConfigTool/prompt.ts` |
| 3 | `packages/deep-code/src/tools/ConfigTool/supportedSettings.ts` |
| 1 | `packages/deep-code/src/utils/betas.ts` |
| 3 | `packages/deep-code/src/utils/effort.ts` |
| 1 | `packages/deep-code/src/utils/fastMode.ts` |
| 3 | `packages/deep-code/src/utils/frontmatterParser.ts` |
| 15 | `packages/deep-code/src/utils/model/agent.ts` |
| 9 | `packages/deep-code/src/utils/model/aliases.ts` |
| 4 | `packages/deep-code/src/utils/model/contextWindowUpgradeCheck.ts` |
| 6 | `packages/deep-code/src/utils/model/model.ts` |
| 11 | `packages/deep-code/src/utils/model/modelAllowlist.ts` |
| 24 | `packages/deep-code/src/utils/model/modelOptions.ts` |
| 3 | `packages/deep-code/src/utils/plugins/loadPluginCommands.ts` |
| 1 | `packages/deep-code/src/utils/settings/types.ts` |
| 3 | `packages/deep-code/src/utils/thinking.ts` |
| 1 | `packages/deep-code/src/utils/toolSearch.ts` |
| 1 | `packages/deep-code/src/utils/words.ts` |

### G2. Broad alias-token high-count files

| File | Count | Notes |
|---|---:|---|
| `src/utils/model/model.ts` | 119 | Model parser/canonicalization; P1.11.A plus follow-up. |
| `src/utils/model/modelOptions.ts` | 94 | UI model options; P1.11.A critical. |
| `src/utils/model/configs.ts` | 46 | Full Claude model IDs; model-system follow-up. |
| `src/services/mockRateLimits.ts` | 20 | Legacy rate-limit mocks; deletion candidate. |
| `src/utils/commitAttribution.ts` | 23 | Product/model text; polish. |
| `src/utils/betas.ts` | 26 | Model capability matching; P1.11.A adjacent. |
| `src/migrations/migrateSonnet1mToSonnet45.ts` | 15 | Delete candidate. |
| `src/migrations/migrateFennecToOpus.ts` | 10 | Delete candidate. |
| `src/migrations/migrateOpusToOpus1m.ts` | 10 | Delete candidate. |
| `src/migrations/migrateLegacyOpusToCurrent.ts` | 9 | Delete candidate. |

### G3. Narrow env 11-file list

| File | Main keys |
|---|---|
| `src/query.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| `src/services/tools/toolOrchestration.ts` | `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` |
| `src/services/runtime/tokenPolicy.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| `src/services/runtime/__tests__/messageSend.test.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_RETRIES` |
| `src/services/runtime/errors.ts` | `CLAUDE_CODE_MAX_RETRIES` |
| `src/ink/reconciler.ts` | `CLAUDE_CODE_DEBUG_REPAINTS` |
| `src/ink/dom.ts` | `CLAUDE_CODE_DEBUG_REPAINTS` |
| `src/utils/context.ts` | `CLAUDE_CODE_MAX_CONTEXT_TOKENS` |
| `src/utils/debug.ts` | `CLAUDE_CODE_DEBUG_LOG_LEVEL`, `CLAUDE_CODE_DEBUG_LOGS_DIR` |
| `src/utils/managedEnvConstants.ts` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| `src/screens/Doctor.tsx` | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |

### G4. Migration files dead-file evaluation

| File | Current caller | Proposed status |
|---|---|---|
| `src/migrations/migrateFennecToOpus.ts` | `main.tsx runMigrations()` | Delete if aliases removed. |
| `src/migrations/migrateLegacyOpusToCurrent.ts` | `main.tsx runMigrations()` | Delete if aliases removed. |
| `src/migrations/migrateOpusToOpus1m.ts` | `main.tsx runMigrations()` | Delete if aliases removed. |
| `src/migrations/migrateSonnet1mToSonnet45.ts` | `main.tsx runMigrations()` | Delete if aliases removed. |
| `src/main.tsx` | Imports/calls all four | Remove imports and calls with deletion PR. |

### G5. Current P1.10 regression checks

| Check | Current result | Meaning |
|---|---:|---|
| `rg "claude_code\\." packages/deep-code/src` | 0 | OTel namespace string rename holds. |
| `rg "com\\.anthropic\\.claude_code" packages/deep-code/src` | 0 expected | OTel instrumentation scope rename holds. |
| `rg "@growthbook/growthbook" packages/deep-code/src` | 0 expected | GrowthBook runtime stays removed. |
| `rg "services/analytics/growthbook" packages/deep-code/src` | 0 expected | GrowthBook import migration stays complete. |

### G6. P1.12 sign-off critical milestones

- Milestone 1: P1.11.A merged with SDK/schema/runtime model aliases removed.
- Milestone 2: P1.11.B merged with narrow env residue handled.
- Milestone 3: P1.11.C/D merged or explicitly scoped out with allowlist.
- Milestone 4: Dist refreshed in P1.11.Z.
- Milestone 5: `EXECUTION_LOG.md` cites all P1.11 PRs.
- Milestone 6: P1.12 sign-off checklist runs clean except approved allowlist.

### G7. Commands used for this scan

```sh
nl -ba packages/deep-code/sdk-tools.d.ts | sed -n '260,285p'
rg --pcre2 "(['\"])(sonnet|opus|haiku)(\\[1m\\])?\\1" packages/deep-code/src
rg "\\b(sonnet|opus|haiku)\\b" packages/deep-code/src
rg -i "claude|anthropic|CLAUDE\\.md|\\.claude/|CLAUDE_CODE_|claude_code\\." packages/deep-code/src
rg "CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)[A-Z0-9_]*" packages/deep-code/src
rg "claude_code\\." packages/deep-code/src
rg "migrateFennecToOpus|migrateOpusToOpus1m|migrateLegacyOpusToCurrent|migrateSonnet1mToSonnet45" packages/deep-code/src
```

## Final recommendation

- Choose Path C.
- Execute the model alias hard cutover as mandatory P1.11.A.
- Treat the 30-file bare-alias current-tree result as the true implementation inventory.
- Treat the 610-file broad residue scan as a risk map, not as a sign-off zero target.
- Clean the 11-file narrow env bucket in P1.11.B.
- Clean or explicitly allowlist critical `.claude/` and `CLAUDE.md` runtime fallback in P1.11.C.
- Delete dead alias migrations in P1.11.D if the hard cutover removes alias support.
- Keep audit/history fixtures.
- Refresh dist in P1.11.Z.
- Close with a cite PR that defines the P1.12 sign-off allowlist.
