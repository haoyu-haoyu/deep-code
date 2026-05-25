# P1.8 design: `@anthropic-ai/sdk` type imports scan + stubbing path

Status: Proposed
Scan date: 2026-05-25
Base: post-P1.7 cite branch
Scope: docs-only design inventory, no source mutation

## Executive summary

P1.8 prepares the codebase for removing direct `@anthropic-ai/sdk` imports from
`packages/deep-code/src` by replacing SDK-provided message, tool, usage, and
error shapes with local compatibility stubs.

The raw text scan finds 99 source files containing `@anthropic-ai/sdk`. A
TypeScript AST scan narrows that to 97 files with actual import declarations and
105 SDK import declarations. The remaining two raw matches are non-import
references in comments or skill trigger text and do not block type migration.

Most imports are type-only. They cluster around `ToolResultBlockParam`,
`ContentBlockParam`, `TextBlockParam`, `ImageBlockParam`, `Base64ImageSource`,
`ToolUseBlockParam`, `ToolUseBlock`, `BetaContentBlock`, and `BetaUsage`.

Seven files import SDK runtime classes from `@anthropic-ai/sdk`. These are the
main blockers for a clean dependency drop:

- `APIUserAbortError` in five files.
- `APIError` in two files.
- `NotFoundError`, `APIConnectionError`, and `AuthenticationError` in one file.

Recommended path: Path C, a hybrid plan. Create a central type shim for all SDK
message/tool/usage types and a small local runtime error shim for the classes
used by `instanceof` checks and mock rate-limit construction. This keeps type
migration mechanical while making runtime semantics explicit before P1.9 drops
the package dependency.

## Phase A — SDK import inventory

### Scan method

- Raw text command: `rg -l "@anthropic-ai/sdk" packages/deep-code/src`.
- Raw text result: 99 files.
- AST scan: TypeScript `ImportDeclaration` nodes where `moduleSpecifier` starts
  with `@anthropic-ai/sdk`.
- AST import result: 97 files.
- AST import declarations: 105 declarations.
- Non-import raw matches: 2 files.

The two non-import raw matches are still listed in the appendix because the
pre-scan universe counted them, but they do not require import migration.

### SDK subpath imports

| SDK source | Import declarations | Notes |
| --- | ---: | --- |
| `@anthropic-ai/sdk` | 12 | Runtime error classes plus type-only default `Anthropic` and type-only `APIError`. |
| `@anthropic-ai/sdk/resources` | 3 | Type-only `ContentBlockParam` / `TextBlockParam`. |
| `@anthropic-ai/sdk/resources/index.mjs` | 50 | Main type source for content, tool, thinking, and image block params. |
| `@anthropic-ai/sdk/resources/messages.js` | 2 | Type-only `ContentBlockParam`. |
| `@anthropic-ai/sdk/resources/messages.mjs` | 16 | Type-only content and image source shapes. |
| `@anthropic-ai/sdk/resources/messages/messages.mjs` | 3 | Type-only tool result/use block shapes. |
| `@anthropic-ai/sdk/resources/beta/messages.js` | 2 | Type-only beta content/tool union shapes. |
| `@anthropic-ai/sdk/resources/beta/messages/messages.mjs` | 17 | Beta message, usage, tool, stream param, and thinking shapes. |

### Runtime imports

| File | Runtime symbols | Why it matters |
| --- | --- | --- |
| `components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx` | `APIUserAbortError` | Abort detection via `instanceof`. |
| `hooks/useCanUseTool.tsx` | `APIUserAbortError` | Permission flow abort detection. |
| `services/rateLimitMocking.ts` | `APIError` | Constructs mock 429 errors with headers. |
| `tools/BashTool/bashPermissions.ts` | `APIUserAbortError` | Permission cancellation handling. |
| `utils/errors.ts` | `APIUserAbortError` | Central `isAbortError` helper uses `instanceof`. |
| `utils/model/validateModel.ts` | `NotFoundError`, `APIError`, `APIConnectionError`, `AuthenticationError` | Model validation maps SDK error subclasses to user-facing messages. |
| `utils/permissions/permissions.ts` | `APIUserAbortError` | Permission abort handling. |

### Type-only import clusters

| Symbol | Files | Migration priority |
| --- | ---: | --- |
| `ToolResultBlockParam` | 29 | High: repeated across tool UI and tool execution code. |
| `ContentBlockParam` | 28 | High: broad message pipeline dependency. |
| `TextBlockParam` | 15 | Medium: mostly rendering components. |
| `ImageBlockParam` | 9 | Medium: attachments and image permission UI. |
| `Base64ImageSource` | 8 | Medium: image read/paste paths. |
| `BetaContentBlock` | 7 | Medium: internal message mapper and VCR paths. |
| `ToolUseBlockParam` | 7 | Medium: assistant/tool render paths. |
| `ToolUseBlock` | 6 | Medium: orchestration and grouping code. |
| `Anthropic` | 4 | High: default SDK namespace type used for tool schemas. |
| `BetaUsage as Usage` | 4 | Low: simple usage accounting shape. |
| `BetaToolUseBlock` | 3 | Medium: beta/internal grouping paths. |
| `ContentBlock` | 3 | Medium: non-param content block shape. |
| `ThinkingBlockParam` | 3 | Low: assistant thinking render paths. |
| `BetaMessageStreamParams` | 2 | Medium: stream params in bootstrap/log. |
| `BetaTool` | 2 | Medium: tool schema construction. |
| `BetaToolUnion` | 2 | Medium: tool schema construction and classifier. |
| `ThinkingBlock` | 2 | Low: render-only shape. |
| `APIError` | 1 | Type-only reference in `utils/messages.ts`; runtime handled separately. |
| `BetaMessage` | 1 | Low: message conversion shape. |
| `BetaRedactedThinkingBlock` | 1 | Low: message conversion shape. |
| `BetaThinkingBlock` | 1 | Low: message conversion shape. |
| `BetaUsage` | 1 | Low: advisor usage shape. |
| `BetaWebSearchTool20250305` | 1 | Low: web search tool schema. |
| `MessageParam` | 1 | Low: MCP client content adapter. |
| `RedactedThinkingBlock` | 1 | Low: assistant thinking shape. |
| `RedactedThinkingBlockParam` | 1 | Low: assistant thinking param shape. |

### Import universe by file

The following list preserves the 99-file raw scan universe. Rows marked
`non-import` contain the SDK string but no import declaration.

1. `packages/deep-code/src/QueryEngine.ts` — type: `ContentBlockParam` from `resources/messages.mjs`.
2. `packages/deep-code/src/Tool.ts` — type: `ToolResultBlockParam`, `ToolUseBlockParam` from `resources/index.mjs`.
3. `packages/deep-code/src/bootstrap/state.ts` — type: `BetaMessageStreamParams` from `resources/beta/messages/messages.mjs`.
4. `packages/deep-code/src/cli/print.ts` — type: `ContentBlockParam` from `resources/messages.mjs`.
5. `packages/deep-code/src/commands/createMovedToPluginCommand.ts` — type: `ContentBlockParam` from `resources/messages.js`.
6. `packages/deep-code/src/commands/review.ts` — type: `ContentBlockParam` from `resources/messages.js`.
7. `packages/deep-code/src/commands/statusline.tsx` — type: `ContentBlockParam` from `resources/index.mjs`.
8. `packages/deep-code/src/components/FallbackToolUseErrorMessage.tsx` — type: `ToolResultBlockParam` from `resources/messages/messages.mjs`.
9. `packages/deep-code/src/components/Message.tsx` — type: `BetaContentBlock`, `ImageBlockParam`, `TextBlockParam`, `ThinkingBlockParam`, `ToolResultBlockParam`, `ToolUseBlockParam`.
10. `packages/deep-code/src/components/MessageSelector.tsx` — type: `ContentBlockParam`, `TextBlockParam`.
11. `packages/deep-code/src/components/agents/generateAgent.ts` — type: `ContentBlock`.
12. `packages/deep-code/src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx` — runtime: `APIUserAbortError`.
13. `packages/deep-code/src/components/messages/AssistantTextMessage.tsx` — type: `TextBlockParam`.
14. `packages/deep-code/src/components/messages/AssistantThinkingMessage.tsx` — type: `ThinkingBlock`, `ThinkingBlockParam`.
15. `packages/deep-code/src/components/messages/AssistantToolUseMessage.tsx` — type: `ToolUseBlockParam`.
16. `packages/deep-code/src/components/messages/GroupedToolUseContent.tsx` — type: `ToolResultBlockParam`, `ToolUseBlockParam`.
17. `packages/deep-code/src/components/messages/UserAgentNotificationMessage.tsx` — type: `TextBlockParam`.
18. `packages/deep-code/src/components/messages/UserBashInputMessage.tsx` — type: `TextBlockParam`.
19. `packages/deep-code/src/components/messages/UserChannelMessage.tsx` — type: `TextBlockParam`.
20. `packages/deep-code/src/components/messages/UserCommandMessage.tsx` — type: `TextBlockParam`.
21. `packages/deep-code/src/components/messages/UserPromptMessage.tsx` — type: `TextBlockParam`.
22. `packages/deep-code/src/components/messages/UserResourceUpdateMessage.tsx` — type: `TextBlockParam`.
23. `packages/deep-code/src/components/messages/UserTeammateMessage.tsx` — type: `TextBlockParam`.
24. `packages/deep-code/src/components/messages/UserTextMessage.tsx` — type: `TextBlockParam`.
25. `packages/deep-code/src/components/messages/UserToolResultMessage/UserToolErrorMessage.tsx` — type: `ToolResultBlockParam`.
26. `packages/deep-code/src/components/messages/UserToolResultMessage/UserToolResultMessage.tsx` — type: `ToolResultBlockParam`.
27. `packages/deep-code/src/components/messages/UserToolResultMessage/utils.tsx` — type: `ToolUseBlockParam`.
28. `packages/deep-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx` — type: `Base64ImageSource`, `ImageBlockParam`.
29. `packages/deep-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx` — type: `Base64ImageSource`, `ImageBlockParam`.
30. `packages/deep-code/src/components/permissions/PermissionRequest.tsx` — type: `ContentBlockParam`.
31. `packages/deep-code/src/cost-tracker.ts` — type: `BetaUsage as Usage`.
32. `packages/deep-code/src/entrypoints/sdk/coreSchemas.ts` — non-import: placeholder comments mention `@anthropic-ai/sdk`.
33. `packages/deep-code/src/hooks/toolPermission/PermissionContext.ts` — type: `ContentBlockParam`.
34. `packages/deep-code/src/hooks/toolPermission/handlers/interactiveHandler.ts` — type: `ContentBlockParam`.
35. `packages/deep-code/src/hooks/toolPermission/handlers/swarmWorkerHandler.ts` — type: `ContentBlockParam`.
36. `packages/deep-code/src/hooks/useCanUseTool.tsx` — runtime: `APIUserAbortError`.
37. `packages/deep-code/src/query.ts` — type: `ToolResultBlockParam`, `ToolUseBlock`.
38. `packages/deep-code/src/screens/REPL.tsx` — type: `ContentBlockParam`, `ImageBlockParam`.
39. `packages/deep-code/src/services/compact/microCompact.ts` — type: `ToolResultBlockParam`.
40. `packages/deep-code/src/services/mcp/client.ts` — type: `Base64ImageSource`, `ContentBlockParam`, `MessageParam`.
41. `packages/deep-code/src/services/rateLimitMocking.ts` — runtime: `APIError`.
42. `packages/deep-code/src/services/tools/StreamingToolExecutor.ts` — type: `ToolUseBlock`.
43. `packages/deep-code/src/services/tools/toolExecution.ts` — type: `ContentBlockParam`, `ToolResultBlockParam`, `ToolUseBlock`.
44. `packages/deep-code/src/services/tools/toolOrchestration.ts` — type: `ToolUseBlock`.
45. `packages/deep-code/src/services/vcr.ts` — type: `BetaContentBlock`.
46. `packages/deep-code/src/skills/bundled/claudeApi.ts` — non-import: skill trigger text mentions `@anthropic-ai/sdk`.
47. `packages/deep-code/src/skills/bundledSkills.ts` — type: `ContentBlockParam`.
48. `packages/deep-code/src/tools/AgentTool/UI.tsx` — type: `ToolResultBlockParam`, `ToolUseBlockParam`.
49. `packages/deep-code/src/tools/AgentTool/forkSubagent.ts` — type: `BetaToolUseBlock`.
50. `packages/deep-code/src/tools/BashTool/BashTool.tsx` — type: `ToolResultBlockParam`.
51. `packages/deep-code/src/tools/BashTool/UI.tsx` — type: `ToolResultBlockParam`.
52. `packages/deep-code/src/tools/BashTool/bashPermissions.ts` — runtime: `APIUserAbortError`.
53. `packages/deep-code/src/tools/BashTool/utils.ts` — type: `Base64ImageSource`, `ContentBlockParam`, `ToolResultBlockParam`.
54. `packages/deep-code/src/tools/FileEditTool/UI.tsx` — type: `ToolResultBlockParam`.
55. `packages/deep-code/src/tools/FileReadTool/FileReadTool.ts` — type: `Base64ImageSource`.
56. `packages/deep-code/src/tools/FileReadTool/UI.tsx` — type: `ToolResultBlockParam`.
57. `packages/deep-code/src/tools/FileWriteTool/UI.tsx` — type: `ToolResultBlockParam`.
58. `packages/deep-code/src/tools/GlobTool/UI.tsx` — type: `ToolResultBlockParam`.
59. `packages/deep-code/src/tools/GrepTool/UI.tsx` — type: `ToolResultBlockParam`.
60. `packages/deep-code/src/tools/LSPTool/UI.tsx` — type: `ToolResultBlockParam`.
61. `packages/deep-code/src/tools/NotebookEditTool/UI.tsx` — type: `ToolResultBlockParam`.
62. `packages/deep-code/src/tools/PowerShellTool/PowerShellTool.tsx` — type: `ToolResultBlockParam`.
63. `packages/deep-code/src/tools/PowerShellTool/UI.tsx` — type: `ToolResultBlockParam`.
64. `packages/deep-code/src/tools/SkillTool/SkillTool.ts` — type: `ToolResultBlockParam`.
65. `packages/deep-code/src/tools/SkillTool/UI.tsx` — type: `ToolResultBlockParam`.
66. `packages/deep-code/src/tools/ToolSearchTool/ToolSearchTool.ts` — type: `ToolResultBlockParam`.
67. `packages/deep-code/src/tools/WebSearchTool/WebSearchTool.ts` — type: `BetaContentBlock`, `BetaWebSearchTool20250305`.
68. `packages/deep-code/src/types/command.ts` — type: `ContentBlockParam`.
69. `packages/deep-code/src/types/permissions.ts` — type: `ContentBlockParam`.
70. `packages/deep-code/src/types/textInputTypes.ts` — type: `ContentBlockParam`.
71. `packages/deep-code/src/utils/advisor.ts` — type: `BetaUsage`.
72. `packages/deep-code/src/utils/analyzeContext.ts` — type: `Anthropic`.
73. `packages/deep-code/src/utils/api.ts` — type: `Anthropic`, `BetaTool`, `BetaToolUnion`.
74. `packages/deep-code/src/utils/attachments.ts` — type: `ContentBlockParam`, `ImageBlockParam`, `Base64ImageSource`.
75. `packages/deep-code/src/utils/charEstimation.ts` — type: `Anthropic`.
76. `packages/deep-code/src/utils/contextAnalysis.ts` — type: `BetaContentBlock`, `ContentBlock`, `ContentBlockParam`.
77. `packages/deep-code/src/utils/errors.ts` — runtime: `APIUserAbortError`.
78. `packages/deep-code/src/utils/groupToolUses.ts` — type: `BetaToolUseBlock`, `ToolResultBlockParam`.
79. `packages/deep-code/src/utils/imageResizer.ts` — type: `Base64ImageSource`, `ImageBlockParam`.
80. `packages/deep-code/src/utils/log.ts` — type: `BetaMessageStreamParams`.
81. `packages/deep-code/src/utils/mcpValidation.ts` — type: `ContentBlockParam`, `ImageBlockParam`, `TextBlockParam`.
82. `packages/deep-code/src/utils/messageQueueManager.ts` — type: `ContentBlockParam`.
83. `packages/deep-code/src/utils/messages.ts` — type: `BetaUsage as Usage`, `ContentBlock`, `ContentBlockParam`, `RedactedThinkingBlock`, `RedactedThinkingBlockParam`, `TextBlockParam`, `ThinkingBlock`, `ThinkingBlockParam`, `ToolResultBlockParam`, `ToolUseBlock`, `ToolUseBlockParam`, `APIError`, `BetaContentBlock`, `BetaMessage`, `BetaRedactedThinkingBlock`, `BetaThinkingBlock`, `BetaToolUseBlock`.
84. `packages/deep-code/src/utils/messages/mappers.ts` — type: `BetaContentBlock`.
85. `packages/deep-code/src/utils/model/validateModel.ts` — runtime: `NotFoundError`, `APIError`, `APIConnectionError`, `AuthenticationError`.
86. `packages/deep-code/src/utils/modelCost.ts` — type: `BetaUsage as Usage`.
87. `packages/deep-code/src/utils/notebook.ts` — type: `ImageBlockParam`, `TextBlockParam`, `ToolResultBlockParam`.
88. `packages/deep-code/src/utils/permissions/classifierShared.ts` — type: `BetaContentBlock`.
89. `packages/deep-code/src/utils/permissions/permissions.ts` — runtime: `APIUserAbortError`.
90. `packages/deep-code/src/utils/permissions/yoloClassifier.ts` — type: `Anthropic`, `BetaToolUnion`.
91. `packages/deep-code/src/utils/processUserInput/processBashCommand.tsx` — type: `ContentBlockParam`.
92. `packages/deep-code/src/utils/processUserInput/processSlashCommand.tsx` — type: `ContentBlockParam`, `TextBlockParam`.
93. `packages/deep-code/src/utils/processUserInput/processTextPrompt.ts` — type: `ContentBlockParam`.
94. `packages/deep-code/src/utils/processUserInput/processUserInput.ts` — type: `Base64ImageSource`, `ContentBlockParam`, `ImageBlockParam`.
95. `packages/deep-code/src/utils/queryHelpers.ts` — type: `ToolUseBlock`.
96. `packages/deep-code/src/utils/swarm/inProcessRunner.ts` — type: `ContentBlockParam`.
97. `packages/deep-code/src/utils/tokens.ts` — type: `BetaUsage as Usage`.
98. `packages/deep-code/src/utils/toolResultStorage.ts` — type: `ToolResultBlockParam`.
99. `packages/deep-code/src/utils/toolSchemaCache.ts` — type: `BetaTool`.

### `entrypoints/agentSdkTypes.ts` public surface

`packages/deep-code/src/entrypoints/agentSdkTypes.ts` does not import
`@anthropic-ai/sdk`. It is still important because it is the central public
SDK-facing re-export module. It re-exports:

- `./sdk/controlTypes.js` for control protocol request/response types.
- `./sdk/coreTypes.js` for serializable message and config types.
- `./sdk/runtimeTypes.js` for callback and runtime interfaces.
- `./sdk/settingsTypes.generated.js` for settings.
- `./sdk/toolTypes.js` for tool-facing SDK types.

P1.8 should avoid expanding this public surface with internal Anthropic
compatibility types unless the project explicitly wants those types to become
SDK API. The safer default is to create an internal shim under `src/types/` and
only re-export from `agentSdkTypes.ts` if an external compatibility need is
confirmed.

## Phase B — Stubbing strategy options

### Option table

| Path | Description | File touch estimate | Pros | Cons |
| --- | --- | ---: | --- | --- |
| A — Centralized local type stubs | Create `packages/deep-code/src/types/sdk-shim.ts` and migrate all SDK type-only imports to it. | 100-110 | Simple audit target; one grep proves migration; easy P1.9 dependency removal prep. | Does not solve runtime class imports alone; central file may become broad. |
| B — Per-symbol local stubs | Move each type to natural homes such as message, tool, usage, and image type modules. | 105-120 | Types live closer to domain ownership; less monolithic. | Harder completeness audit; more import destinations; more chances for inconsistent shapes. |
| C — Hybrid type shim + runtime error shim | Centralize types in `types/sdk-shim.ts`; add local runtime error classes in a small runtime module. | 110-125 | Cleanly separates type-only migration from `instanceof` semantics; addresses true blockers. | Two shims to maintain; requires deliberate error constructor compatibility. |
| D — Package-level module declaration | Add local `declare module '@anthropic-ai/sdk'` / subpath declarations and leave imports in place. | 1-5 | Smallest immediate diff. | Fails P1.9 goal because source still imports the package; hides direct dependency instead of removing it. |

### Path A — Centralized local type stubs

Path A would create a single internal shim:

```ts
// packages/deep-code/src/types/sdk-shim.ts
export type ContentBlockParam = TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam | ThinkingBlockParam | RedactedThinkingBlockParam
export type ContentBlock = ContentBlockParam
export type ToolUseBlockParam = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ToolResultBlockParam = { type: 'tool_result'; tool_use_id: string; content?: string | ContentBlockParam[]; is_error?: boolean }
export type TextBlockParam = { type: 'text'; text: string; cache_control?: CacheControlEphemeral | null }
```

The exact definitions should mirror the upstream SDK shapes used by this
codebase, not every SDK shape. P1.8 should keep the stub minimal, structural,
and extensible.

Path A is strong for the 90 type-only import files, but it leaves the seven
runtime import files for a later runtime pass. That split is easy to manage if
explicitly scheduled, but risky if the phase declares victory after only type
imports are migrated.

### Path B — Per-symbol local stubs

Path B would define:

- Message block types near `src/types/message.ts`.
- Tool block types near `src/Tool.ts` or `src/types/toolResult.ts`.
- Image source types near attachment/image utilities.
- Usage types near runtime usage accounting.
- Beta tool schema types near `utils/api.ts` or `utils/toolSchemaCache.ts`.

This is more organic but less measurable. Because P1.8 is a cleanup phase whose
success criterion is "zero `@anthropic-ai/sdk` imports in `src`", a single shim
is easier to verify than several domain-specific locations.

### Path C — Hybrid type shim + runtime error shim

Path C uses two internal modules:

- `packages/deep-code/src/types/sdk-shim.ts` for all SDK-derived structural
  types.
- `packages/deep-code/src/services/runtime/sdkErrors.ts` or
  `packages/deep-code/src/utils/sdkErrors.ts` for local runtime error classes.

The runtime shim should include:

- `APIError`, with `status`, `headers`, `error`, and `message` properties used
  by current callers.
- `APIUserAbortError`, extending `APIError` or a local base error so existing
  `instanceof APIUserAbortError` checks continue to work.
- `APIConnectionError`, `AuthenticationError`, and `NotFoundError`, extending
  `APIError` for `validateModel`.

This path directly addresses the only value imports from `@anthropic-ai/sdk`.
It also lets P1.9 remove the package dependency without refactoring all
try/catch paths at the same time.

### Path D — Module declaration shim

Path D is intentionally not recommended. It makes TypeScript happy while
leaving imports pointed at `@anthropic-ai/sdk`. That obscures progress and
keeps the codebase coupled to the package name. It is useful only as a temporary
emergency bridge, not as a P1.8 deliverable.

## Phase C — Recommended path + rationale

Recommend Path C.

The scan shows that the cleanup is not purely type-only. Ninety-seven files
have real SDK imports, and seven of those import runtime classes that affect
control flow through `instanceof` checks or construct `APIError` instances for
mock 429 handling. A pure central type stub (Path A) is almost enough, but it
does not remove the runtime dependency. A hybrid plan keeps the bulk migration
mechanical while making the runtime semantics explicit and testable.

Use `types/sdk-shim.ts` for structural SDK types and a separate runtime error
module for classes. Avoid extending `entrypoints/agentSdkTypes.ts` unless a
public SDK compatibility check proves external consumers need these aliases.
This preserves the existing agent SDK public surface while still giving source
files one internal import target.

## Phase D — Sub-PR breakdown

Recommended sequence: 9 sub-PRs plus a dist refresh and cite closeout.

### P1.8.0 — Create local shim modules

- Add `packages/deep-code/src/types/sdk-shim.ts`.
- Add local runtime error shim, likely `packages/deep-code/src/utils/sdkErrors.ts`.
- Include all symbols currently imported from SDK subpaths.
- Include focused type-level compile coverage if the repo has an established
  type assertion pattern; otherwise rely on build.
- Touch estimate: 2-4 files.

### P1.8.a — Migrate `tools/` subtree

- Replace imports in 20 true import files under `src/tools/`.
- Main symbols: `ToolResultBlockParam`, `ToolUseBlockParam`, `Base64ImageSource`,
  `ContentBlockParam`, `BetaToolUseBlock`, `BetaWebSearchTool20250305`.
- Keep runtime behavior unchanged.
- Touch estimate: 20-22 files.

### P1.8.b — Migrate `utils/` message and type-heavy consumers

- Replace imports in the large `src/utils/` cluster.
- Prioritize `utils/messages.ts`, `utils/contextAnalysis.ts`,
  `utils/attachments.ts`, `utils/mcpValidation.ts`, `utils/notebook.ts`, and
  process user input helpers.
- Main symbols: `ContentBlockParam`, `TextBlockParam`, `ImageBlockParam`,
  `ToolResultBlockParam`, `ToolUseBlock`, `BetaContentBlock`, `BetaUsage`.
- Touch estimate: 25-30 files.

### P1.8.c — Migrate `components/` render consumers

- Replace imports in 24 component files.
- Main symbols: render-only block param types and image source types.
- Keep UI rendering untouched.
- Touch estimate: 24-26 files.

### P1.8.d — Migrate services, hooks, query, and CLI type-only consumers

- Replace imports in service orchestration, hooks, `QueryEngine.ts`, `query.ts`,
  `bootstrap/state.ts`, `cli/print.ts`, and `cost-tracker.ts`.
- Leave runtime error import files for the runtime PR if they are not purely
  type-only.
- Touch estimate: 15-20 files.

### P1.8.e — Migrate command, type, skill, and remaining type-only consumers

- Replace imports in `commands/`, `types/`, `skills/bundledSkills.ts`, and any
  missed type-only files.
- Confirm raw non-import references are intentionally untouched or separately
  documented.
- Touch estimate: 10-15 files.

### P1.8.runtime — Replace SDK runtime classes

- Migrate seven runtime import files to the local runtime error shim.
- Update tests around abort detection, model validation, and mock rate limits.
- Confirm `instanceof APIUserAbortError` and `instanceof APIError` behavior.
- Touch estimate: 8-12 files.

### P1.8.verify — Final grep and package dependency readiness check

- Verify `rg "@anthropic-ai/sdk" packages/deep-code/src` returns only allowed
  non-import text or zero, depending on scope decision.
- Verify `rg "from '@anthropic-ai/sdk" packages/deep-code/src` returns zero.
- Verify package dependency cannot yet be removed until P1.9 if dist or runtime
  packaging still includes SDK code.
- Touch estimate: 1-3 docs/test files, if any.

### P1.8.Z — Dist refresh

- Regenerate `packages/deep-code/dist/deepcode-full.mjs`.
- Verify byte-identical second build.
- Dist-only PR.
- Touch estimate: 1 file.

### P1.8.cite — Close phase in `EXECUTION_LOG.md`

- Cite scan and sub-PRs.
- Mark P1.8 done.
- Advance A track to P1.9 package dependency removal if ready.
- Touch estimate: 1 file.

### Estimated total P1.8 touch count

The implementation path is expected to touch about 110-125 files across source,
tests, docs, and dist. The exact number depends on whether type aliases are
introduced in one shim module or split across type and runtime shim modules, and
whether runtime error tests need updates.

## Phase E — Risk assessment

### Type fidelity

Local stubs must match the structural contract used by callers, not just compile
with `unknown`. Particular care is needed for:

- `ToolResultBlockParam.content`, which may be text or content block arrays.
- `ToolResultBlockParam.tool_use_id`, used to pair results with tool calls.
- `ToolResultBlockParam.is_error`, used in rendering and error handling.
- `ToolUseBlockParam.id`, `name`, and `input`, used by renderers and grouping.
- `ContentBlockParam` unions, because message mappers and token estimation code
  inspect `type` discriminants.

### Beta type drift

The code imports both beta and non-beta content/tool shapes. Do not assume all
`BetaContentBlock` cases are identical to `ContentBlockParam`. At minimum, the
shim should keep beta-prefixed aliases until all consumers are inspected.

### Runtime error classes

`APIUserAbortError` is intentionally checked with `instanceof`; comments in
`utils/errors.ts` say string matching was not sufficient in minified builds.
The local runtime shim must preserve class identity inside the bundle. Do not
replace these checks with `error.name === 'AbortError'` without a separate
behavioral review.

### `APIError` construction

`services/rateLimitMocking.ts` constructs `new APIError(status, error, message,
headers)`. The local class constructor must accept the same argument shape or
that file needs a scoped refactor. Callers read at least `status`, `error`,
`headers`, and `message`.

### Model validation subclassing

`utils/model/validateModel.ts` branches on `NotFoundError`,
`AuthenticationError`, `APIConnectionError`, and `APIError`. Local classes must
preserve the inheritance relationship:

- `NotFoundError extends APIError`
- `AuthenticationError extends APIError`
- `APIConnectionError extends APIError`
- `APIUserAbortError extends APIError` or a compatible abort-specific class

### Default `Anthropic` namespace type

Four files import default `Anthropic` as a type. The most important use is
`Anthropic.Tool.InputSchema` in `utils/api.ts`. The shim should provide a
namespace-compatible type surface, for example:

```ts
export namespace Anthropic {
  export namespace Tool {
    export type InputSchema = {
      type?: 'object'
      properties?: Record<string, unknown>
      required?: string[]
      [key: string]: unknown
    }
  }
}
```

If TypeScript namespace export ergonomics are awkward, replace the default SDK
namespace usage with explicit local types such as `ToolInputSchema`.

### Public SDK surface

`entrypoints/agentSdkTypes.ts` is a public-looking re-export point. P1.8 should
not leak internal Anthropic compatibility aliases through it unless required by
external API consumers. A public-surface grep should check whether any tests or
docs expect SDK block types from that entrypoint.

### Tests and fixtures

The type migration is mostly compile-time, so build coverage matters more than
runtime unit count. Runtime shim migration needs focused tests for:

- `isAbortError(new APIUserAbortError(...))`.
- Mock 429 `APIError` construction and header access.
- Model validation error classification.

### Dependency timing

P1.8 should remove source imports, not necessarily the package dependency. P1.9
should own package removal after source, tests, and dist are free of the SDK
runtime.

## Phase F — Key decision points

### Q1: Path A vs Path C

Decision recommended: Path C.

Rationale: runtime class imports exist and are semantically meaningful. A type
only migration is useful but incomplete.

### Q2: Central stub location

Decision recommended: `packages/deep-code/src/types/sdk-shim.ts` for structural
types, plus a separate runtime error module.

Do not extend `entrypoints/agentSdkTypes.ts` by default because that file is
closer to public SDK surface than internal compatibility plumbing.

### Q3: Runtime error stubbing strategy

Decision recommended: local classes first, not broad try/catch refactors.

Rationale: the current code depends on `instanceof` checks. Local classes keep
behavior stable and keep the PRs mechanical.

### Q4: Beta types

Decision recommended: keep beta-prefixed local aliases initially.

Rationale: it avoids silently unifying subtly different SDK contracts. Later PRs
can collapse aliases only after consumers prove the shapes are equivalent.

### Q5: Default `Anthropic` class / namespace type

Decision recommended: eliminate default type imports by replacing them with
explicit local structural types.

Rationale: no current source file constructs the default `Anthropic` client in
the AST scan. The remaining default imports are type-only, so a runtime default
class stub is unnecessary unless a hidden consumer appears.

### Q6: P1.9 timing

Decision recommended: P1.9 may drop `@anthropic-ai/sdk` only after:

- `rg "from '@anthropic-ai/sdk" packages/deep-code/src` is zero.
- Runtime dist no longer bundles SDK code except intentionally retained docs.
- Package/build/test fixtures are updated.
- P1.8.Z confirms the bundle rebuild is stable.

## Phase G — Reference appendix

### Symbol to consumer table

| Symbol | Consumer files |
| --- | --- |
| `ToolResultBlockParam` | `Tool.ts`; `query.ts`; `components/FallbackToolUseErrorMessage.tsx`; `components/Message.tsx`; `components/messages/GroupedToolUseContent.tsx`; `components/messages/UserToolResultMessage/UserToolErrorMessage.tsx`; `components/messages/UserToolResultMessage/UserToolResultMessage.tsx`; `services/compact/microCompact.ts`; `services/tools/toolExecution.ts`; `tools/AgentTool/UI.tsx`; `tools/BashTool/BashTool.tsx`; `tools/BashTool/UI.tsx`; `tools/BashTool/utils.ts`; `tools/FileEditTool/UI.tsx`; `tools/FileReadTool/UI.tsx`; `tools/FileWriteTool/UI.tsx`; `tools/GlobTool/UI.tsx`; `tools/GrepTool/UI.tsx`; `tools/LSPTool/UI.tsx`; `tools/NotebookEditTool/UI.tsx`; `tools/PowerShellTool/PowerShellTool.tsx`; `tools/PowerShellTool/UI.tsx`; `tools/SkillTool/SkillTool.ts`; `tools/SkillTool/UI.tsx`; `tools/ToolSearchTool/ToolSearchTool.ts`; `utils/groupToolUses.ts`; `utils/messages.ts`; `utils/notebook.ts`; `utils/toolResultStorage.ts`. |
| `ContentBlockParam` | `QueryEngine.ts`; `cli/print.ts`; `commands/createMovedToPluginCommand.ts`; `commands/review.ts`; `commands/statusline.tsx`; `components/MessageSelector.tsx`; `components/permissions/PermissionRequest.tsx`; `hooks/toolPermission/PermissionContext.ts`; `hooks/toolPermission/handlers/interactiveHandler.ts`; `hooks/toolPermission/handlers/swarmWorkerHandler.ts`; `screens/REPL.tsx`; `services/mcp/client.ts`; `services/tools/toolExecution.ts`; `skills/bundledSkills.ts`; `tools/BashTool/utils.ts`; `types/command.ts`; `types/permissions.ts`; `types/textInputTypes.ts`; `utils/attachments.ts`; `utils/contextAnalysis.ts`; `utils/mcpValidation.ts`; `utils/messageQueueManager.ts`; `utils/messages.ts`; `utils/processUserInput/processBashCommand.tsx`; `utils/processUserInput/processSlashCommand.tsx`; `utils/processUserInput/processTextPrompt.ts`; `utils/processUserInput/processUserInput.ts`; `utils/swarm/inProcessRunner.ts`. |
| `TextBlockParam` | `components/Message.tsx`; `components/MessageSelector.tsx`; `components/messages/AssistantTextMessage.tsx`; `components/messages/UserAgentNotificationMessage.tsx`; `components/messages/UserBashInputMessage.tsx`; `components/messages/UserChannelMessage.tsx`; `components/messages/UserCommandMessage.tsx`; `components/messages/UserPromptMessage.tsx`; `components/messages/UserResourceUpdateMessage.tsx`; `components/messages/UserTeammateMessage.tsx`; `components/messages/UserTextMessage.tsx`; `utils/mcpValidation.ts`; `utils/messages.ts`; `utils/notebook.ts`; `utils/processUserInput/processSlashCommand.tsx`. |
| `ImageBlockParam` | `components/Message.tsx`; `components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`; `components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`; `screens/REPL.tsx`; `utils/attachments.ts`; `utils/imageResizer.ts`; `utils/mcpValidation.ts`; `utils/notebook.ts`; `utils/processUserInput/processUserInput.ts`. |
| `Base64ImageSource` | `components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`; `components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`; `services/mcp/client.ts`; `tools/BashTool/utils.ts`; `tools/FileReadTool/FileReadTool.ts`; `utils/attachments.ts`; `utils/imageResizer.ts`; `utils/processUserInput/processUserInput.ts`. |
| `BetaContentBlock` | `components/Message.tsx`; `services/vcr.ts`; `tools/WebSearchTool/WebSearchTool.ts`; `utils/contextAnalysis.ts`; `utils/messages.ts`; `utils/messages/mappers.ts`; `utils/permissions/classifierShared.ts`. |
| `ToolUseBlockParam` | `Tool.ts`; `components/Message.tsx`; `components/messages/AssistantToolUseMessage.tsx`; `components/messages/GroupedToolUseContent.tsx`; `components/messages/UserToolResultMessage/utils.tsx`; `tools/AgentTool/UI.tsx`; `utils/messages.ts`. |
| `ToolUseBlock` | `query.ts`; `services/tools/StreamingToolExecutor.ts`; `services/tools/toolExecution.ts`; `services/tools/toolOrchestration.ts`; `utils/messages.ts`; `utils/queryHelpers.ts`. |
| `Anthropic` | `utils/analyzeContext.ts`; `utils/api.ts`; `utils/charEstimation.ts`; `utils/permissions/yoloClassifier.ts`. |
| `BetaUsage as Usage` | `cost-tracker.ts`; `utils/messages.ts`; `utils/modelCost.ts`; `utils/tokens.ts`. |
| `BetaToolUseBlock` | `tools/AgentTool/forkSubagent.ts`; `utils/groupToolUses.ts`; `utils/messages.ts`. |
| `ContentBlock` | `components/agents/generateAgent.ts`; `utils/contextAnalysis.ts`; `utils/messages.ts`. |
| `ThinkingBlockParam` | `components/Message.tsx`; `components/messages/AssistantThinkingMessage.tsx`; `utils/messages.ts`. |
| `BetaMessageStreamParams` | `bootstrap/state.ts`; `utils/log.ts`. |
| `BetaTool` | `utils/api.ts`; `utils/toolSchemaCache.ts`. |
| `BetaToolUnion` | `utils/api.ts`; `utils/permissions/yoloClassifier.ts`. |
| `ThinkingBlock` | `components/messages/AssistantThinkingMessage.tsx`; `utils/messages.ts`. |
| `APIError` | Runtime: `services/rateLimitMocking.ts`, `utils/model/validateModel.ts`; type-only: `utils/messages.ts`. |
| `APIUserAbortError` | `components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`; `hooks/useCanUseTool.tsx`; `tools/BashTool/bashPermissions.ts`; `utils/errors.ts`; `utils/permissions/permissions.ts`. |
| `APIConnectionError` | `utils/model/validateModel.ts`. |
| `AuthenticationError` | `utils/model/validateModel.ts`. |
| `NotFoundError` | `utils/model/validateModel.ts`. |
| `BetaMessage` | `utils/messages.ts`. |
| `BetaRedactedThinkingBlock` | `utils/messages.ts`. |
| `BetaThinkingBlock` | `utils/messages.ts`. |
| `BetaUsage` | `utils/advisor.ts`. |
| `BetaWebSearchTool20250305` | `tools/WebSearchTool/WebSearchTool.ts`. |
| `MessageParam` | `services/mcp/client.ts`. |
| `RedactedThinkingBlock` | `utils/messages.ts`. |
| `RedactedThinkingBlockParam` | `utils/messages.ts`. |

### Suggested local type definitions

These are draft shapes for planning. Implementation PRs should tighten them
against actual call sites.

```ts
export type CacheControlEphemeral = {
  type: 'ephemeral'
  scope?: 'global' | 'org'
  ttl?: '5m' | '1h'
}

export type TextBlockParam = {
  type: 'text'
  text: string
  cache_control?: CacheControlEphemeral | null
}

export type ImageBlockParam = {
  type: 'image'
  source: Base64ImageSource
}

export type Base64ImageSource = {
  type: 'base64'
  media_type: string
  data: string
}

export type ToolUseBlockParam = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ToolResultBlockParam = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | ContentBlockParam[]
  is_error?: boolean
  cache_control?: CacheControlEphemeral | null
}

export type ThinkingBlockParam = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type RedactedThinkingBlockParam = {
  type: 'redacted_thinking'
  data: string
}

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam

export type ContentBlock = ContentBlockParam
export type ToolUseBlock = ToolUseBlockParam
export type ThinkingBlock = ThinkingBlockParam
export type RedactedThinkingBlock = RedactedThinkingBlockParam
```

```ts
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: unknown
  service_tier?: string | null
}

export type BetaUsage = Usage
export type BetaMessage = {
  id?: string
  type?: 'message'
  role: 'assistant'
  content: BetaContentBlock[]
  model?: string
  stop_reason?: string | null
  stop_sequence?: string | null
  usage?: BetaUsage
}

export type BetaContentBlock = ContentBlockParam
export type BetaToolUseBlock = ToolUseBlockParam
export type BetaThinkingBlock = ThinkingBlockParam
export type BetaRedactedThinkingBlock = RedactedThinkingBlockParam
```

```ts
export type ToolInputSchema = {
  type?: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean | Record<string, unknown>
  [key: string]: unknown
}

export type BetaTool = {
  name: string
  description?: string
  input_schema: ToolInputSchema
  cache_control?: CacheControlEphemeral | null
}

export type BetaWebSearchTool20250305 = BetaTool & {
  type?: 'web_search_20250305'
}

export type BetaToolUnion = BetaTool | BetaWebSearchTool20250305
export type MessageParam = {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}
```

### Suggested local runtime error definitions

```ts
export class APIError extends Error {
  readonly status: number | undefined
  readonly error: unknown
  readonly headers: Headers | undefined

  constructor(
    status?: number,
    error?: unknown,
    message?: string,
    headers?: Headers,
  ) {
    super(message ?? 'API error')
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
  }
}

export class APIUserAbortError extends APIError {
  constructor(message = 'Request was aborted.') {
    super(undefined, undefined, message)
    this.name = 'APIUserAbortError'
  }
}

export class APIConnectionError extends APIError {}
export class AuthenticationError extends APIError {}
export class NotFoundError extends APIError {}
```

### Verification checklist for implementation PRs

- `rg "from '@anthropic-ai/sdk" packages/deep-code/src` decreases in each PR.
- `rg "from \"@anthropic-ai/sdk" packages/deep-code/src` is also checked.
- `rg "@anthropic-ai/sdk" packages/deep-code/src` is interpreted with the
  known non-import references in mind.
- `bun run build:full-cli` passes after each source migration PR.
- `bun test` passes after each source migration PR.
- Runtime migration PR adds or updates tests for local error classes.
- Final P1.8 PR confirms zero source import declarations from the SDK package.
