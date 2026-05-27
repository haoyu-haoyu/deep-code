# P2.5 Design - Post-Edit LSP Diagnostics Scan + Path Recommendation

## Executive summary

- P2.5 is the post-edit diagnostics correctness multiplier.
- The plan goal is to surface LSP diagnostics after file edits.
- The surfaced diagnostics should be injected into the next model turn.
- The feature should degrade silently when an LSP server is missing, slow, or crashed.
- P2.4 is now merged, so workspace rollback exists before broad diagnostics injection changes.
- The important scan result is that LSP is not greenfield in this tree.
- `packages/deep-code/src/services/lsp/` already exists.
- `packages/deep-code/src/tools/LSPTool/` already exists.
- `packages/deep-code/src/services/diagnosticTracking.ts` already exists.
- `packages/deep-code/src/components/DiagnosticsDisplay.tsx` already exists.
- `packages/deep-code/src/utils/plugins/lspPluginIntegration.ts` already exists.
- FileEditTool and FileWriteTool already notify LSP servers after writes.
- Existing LSP diagnostics already flow through an attachment path.
- The current system is plugin-LSP-first and optional.
- The PURE_DEEPSEEK_PLAN.md text treats LSP as mostly new.
- P2_ROADMAP.md correctly warns to audit the existing LSP subsystem first.
- The recommended path is Path C: phased delivery.
- Path C should be reuse-first rather than duplicate-client-first.
- The first implementation PR should harden the existing LSP service core and add tests.
- The second implementation PR should add a built-in TypeScript server registry path.
- The third implementation PR should make post-edit diagnostics deterministic and configurable.
- Settings and multi-language expansion should follow after the TS path is proven.
- Expected follow-up work is 6-8 sub-PRs and 25-40 files across source, tests, dist, and citation docs.

## Plan anchors

- `PURE_DEEPSEEK_PLAN.md` lines 988-1033 define P2.5.
- The P2.5 goal is diagnostics after successful `edit_file`, `write_file`, and `apply_patch`.
- The plan names `src/services/lsp/{client,registry,index}.ts`.
- The plan names EditFileTool and WriteFileTool as hook targets.
- The plan operation list requires Content-Length JSON-RPC framing.
- The plan operation list requires `didOpen`, `didChange`, and `publishDiagnostics`.
- The plan operation list includes a seven-language registry.
- The plan operation list includes lazy spawn per language.
- The plan operation list uses `poll_after_edit_ms` default 500ms.
- The plan operation list formats diagnostics as `LSP diagnostics for <file>: <list>`.
- The plan operation list injects diagnostics before the next user message.
- The plan operation list requires a settings `[lsp]` section.
- The plan operation list requires missing-binary and crash silent degrade.
- The plan acceptance test starts with a TypeScript deliberate type error.
- `P2_ROADMAP.md` labels P2.5 medium-high risk.
- `P2_ROADMAP.md` says the current tree already has LSP code.
- `P2_ROADMAP.md` names `LSPClient.ts`, `LSPServerManager.ts`, `manager.ts`, `config.ts`, `passiveFeedback.ts`, and `LSPDiagnosticRegistry.ts`.
- `P2_ROADMAP.md` says to audit existing LSP before adding new client code.
- P2.4 and P2.5 both touch edit/write lifecycle.
- P2.4 was correctly sequenced first.

## Phase A - Existing LSP infrastructure inventory

### A1. Existing LSP code paths

- Current LSP service directory: `packages/deep-code/src/services/lsp/`.
- Current LSP service files are seven TypeScript files and about 2460 LOC.
- Current LSP tool directory: `packages/deep-code/src/tools/LSPTool/`.
- Current LSP tool files are about 1778 LOC.
- Existing IDE diagnostics tracker: `packages/deep-code/src/services/diagnosticTracking.ts`.
- Existing diagnostics UI: `packages/deep-code/src/components/DiagnosticsDisplay.tsx`.
- Existing plugin LSP loader: `packages/deep-code/src/utils/plugins/lspPluginIntegration.ts`.
- Total observed LSP-plus-diagnostics surface is roughly 5116 LOC.
- `LSPClient.ts` imports `createMessageConnection` from `vscode-jsonrpc/node.js`.
- The existing client already delegates Content-Length JSON-RPC framing.
- The existing client spawns stdio servers through `child_process.spawn`.
- The existing client uses `subprocessEnv()` for child-process environment hygiene.
- The existing client waits for the `spawn` event to avoid ENOENT races.
- The existing client supports initialize, initialized, requests, notifications, request handlers, notification handlers, and stop.
- `LSPServerInstance.ts` wraps one configured LSP server.
- It has a stopped/starting/running/stopping/error state machine.
- It declares textDocument synchronization, publishDiagnostics, hover, definition, references, documentSymbol, and callHierarchy capabilities.
- It retries transient content-modified errors and caps restart attempts.
- It currently rejects config fields `restartOnCrash` and `shutdownTimeout`.
- `LSPServerManager.ts` owns multiple server instances.
- It builds an extension-to-server map and routes requests by file extension.
- It exposes ensure/start/request plus didOpen/didChange/didSave/didClose helpers.
- It handles `workspace/configuration` requests with null config responses.
- `manager.ts` owns the global singleton, async initialization, bare-mode skip, reinitialization, shutdown, test reset, wait, and connected checks.
- `main.tsx` initializes the LSP manager after workspace trust is established.
- The trust sequencing prevents plugin LSP server execution in untrusted directories.
- `entrypoints/init.ts` registers `shutdownLspServerManager` for cleanup.
- `utils/plugins/refresh.ts` reinitializes the LSP manager after plugin refresh.
- `hooks/useManagePlugins.ts` also reinitializes on plugin state changes.
- `tools.ts` imports `LSPTool`.
- `tools.ts` registers `LSPTool` only when `ENABLE_LSP_TOOL` is truthy.
- LSPTool is read-only and concurrency-safe.
- LSPTool is disabled when no LSP server is connected.
- LSPTool supports definitions, references, hover, symbols, implementation, and call hierarchy operations.
- The tool surface is broader than P2.5 diagnostics.
- P2.5 should not conflate model-facing code intelligence with post-edit diagnostics.
- The existing service is plugin-driven.
- `services/lsp/config.ts` says LSP servers are only supported through plugins.
- `services/lsp/config.ts` does not load user or project settings LSP sections.
- `utils/plugins/schemas.ts` defines `LspServerConfigSchema`.
- Plugin LSP configs require `command` and `extensionToLanguage`.
- Plugin LSP configs support `args`, `transport`, `env`, `initializationOptions`, `settings`, `workspaceFolder`, `startupTimeout`, `shutdownTimeout`, `restartOnCrash`, and `maxRestarts`.
- `LSPServerInstance.ts` currently throws if `shutdownTimeout` is present.
- `LSPServerInstance.ts` currently throws if `restartOnCrash` is present.
- That mismatch is a hardening target.
- The current package manifests do not declare `vscode-jsonrpc`.
- The current package manifests do not declare `vscode-languageserver-protocol`.
- The current package manifests do not declare `vscode-languageserver-types`.
- Local `packages/deep-code/node_modules/vscode-jsonrpc` exists but appears incomplete for package resolution.
- `node -e require.resolve('vscode-jsonrpc/node')` from `packages/deep-code` reports missing.
- `node -e require.resolve('vscode-languageserver-types')` reports missing.
- `node -e require.resolve('vscode-languageserver-protocol')` reports missing.
- Existing tests do not cover the LSP service directly.
- `rg` found no dedicated LSP tests under `packages/deep-code/test`.
- That dependency and coverage gap should be treated as P2.5.a scope.
- P2.5 should avoid creating a parallel `client.ts` until this existing client is evaluated.
- The likely implementation path is to rename or wrap existing PascalCase files only if needed.
- A compatibility facade can be added without moving existing files.
- A mock transport layer is still useful for tests.
- The mock transport can wrap `createMessageConnection` or abstract the existing client boundary.
- The scan conclusion: reuse and harden the existing LSP stack.

### A2. Tool post-edit hook points

- `FileEditTool.ts` already has pre-edit diagnostics baseline capture.
- `FileEditTool.ts` calls `diagnosticTracker.beforeFileEdited(absoluteFilePath)`.
- This happens before the atomic read-modify-write section.
- `FileEditTool.ts` writes through `writeTextContent`.
- `FileEditTool.ts` then gets the global LSP manager.
- If a manager exists, it clears delivered diagnostics for the file URI.
- It calls `lspManager.changeFile(absoluteFilePath, updatedFile)`.
- It calls `lspManager.saveFile(absoluteFilePath)`.
- Both calls are fire-and-forget.
- Both calls catch and log errors.
- The edit operation does not wait for diagnostics.
- The edit operation does not poll for 500ms.
- The edit operation does not attach diagnostics immediately.
- The actual delivery path is next-turn attachment polling.
- This matches the non-blocking degrade goal.
- It does not yet match deterministic post-edit polling from PURE_DEEPSEEK_PLAN.md.
- `FileWriteTool.ts` mirrors the same pattern.
- `FileWriteTool.ts` calls `diagnosticTracker.beforeFileEdited(fullFilePath)`.
- `FileWriteTool.ts` writes through `writeTextContent`.
- `FileWriteTool.ts` calls `lspManager.changeFile(fullFilePath, content)`.
- `FileWriteTool.ts` calls `lspManager.saveFile(fullFilePath)`.
- `FileWriteTool.ts` clears delivered diagnostics for the file URI.
- `NotebookEditTool.ts` writes through `writeTextContent`.
- `NotebookEditTool.ts` does not call `diagnosticTracker.beforeFileEdited`.
- `NotebookEditTool.ts` does not notify LSP manager after save.
- Notebook diagnostics should remain out of first scope unless a JSON/notebook LSP target is planned.
- `BashTool.tsx` includes a sed edit parser path.
- `BashTool.tsx` can write through `writeTextContent` for sed-style edits.
- `BashTool.tsx` notifies VSCode file update but does not notify LSP.
- Bash and PowerShell arbitrary writes should stay out of initial P2.5 scope.
- Detecting shell edits reliably requires command parsing and filesystem watching.
- Shell-edit diagnostics could create false positives and latency.
- Initial hook scope should stay explicit edit tools: FileEditTool and FileWriteTool.
- Optional follow-up can include NotebookEditTool if notebook diagnostics are needed.
- Optional follow-up can include Bash sed only after a robust edit detector exists.
- Existing file-history hooks from P2.4 also sit around edit/write tools.
- P2.5 should not reorder the atomic write critical sections.
- P2.5 should keep all LSP awaits outside critical synchronous write sections.
- P2.5 should not let diagnostics failure fail the edit tool.
- P2.5 should make the current fire-and-forget behavior testable.

### A3. Diagnostics injection mechanism

- There are two diagnostics systems today.
- The first is IDE diagnostics through `services/diagnosticTracking.ts`.
- The second is passive LSP diagnostics through `services/lsp/LSPDiagnosticRegistry.ts`.
- IDE diagnostics are fetched through MCP `callIdeRpc('getDiagnostics')`.
- IDE diagnostics are initialized per query in `REPL.tsx`.
- `REPL.tsx` calls `diagnosticTracker.handleQueryStart(freshClients)` when a query begins.
- `diagnosticTracking.ts` captures baselines before FileEditTool and FileWriteTool edits.
- `diagnosticTracking.ts` compares new IDE diagnostics against the baseline.
- `utils/attachments.ts` calls `diagnosticTracker.getNewDiagnostics()`.
- IDE diagnostics become an attachment with type `diagnostics`.
- Passive LSP diagnostics are received through `textDocument/publishDiagnostics`.
- `passiveFeedback.ts` converts LSP diagnostics into the same `DiagnosticFile` shape.
- `passiveFeedback.ts` calls `registerPendingLSPDiagnostic`.
- `LSPDiagnosticRegistry.ts` deduplicates pending diagnostics.
- `LSPDiagnosticRegistry.ts` prioritizes by severity.
- `LSPDiagnosticRegistry.ts` caps diagnostics to 10 per file.
- `LSPDiagnosticRegistry.ts` caps total diagnostics to 30.
- `LSPDiagnosticRegistry.ts` tracks delivered diagnostics in an LRU.
- `utils/attachments.ts` calls `getLSPDiagnosticAttachments`.
- `getLSPDiagnosticAttachments` calls `checkForLSPDiagnostics`.
- Passive diagnostics also become attachment type `diagnostics`.
- `components/DiagnosticsDisplay.tsx` renders diagnostics in the TUI.
- Normal view shows a compact count.
- Verbose view shows per-file line and diagnostic text.
- The model sees attachments through `getAttachmentMessages`.
- `getAttachmentMessages` yields `createAttachmentMessage(attachment)`.
- The current injection is attachment-based, not a synthetic system message string.
- This is likely better than a raw system string because it reuses existing UI and message plumbing.
- The required P2.5 text "LSP diagnostics for <file>: <list>" can be represented inside attachment formatting.
- `DiagnosticTrackingService.formatDiagnosticsSummary` already formats a human-readable summary.
- The attachment path is main-thread only.
- Diagnostics require the agent to have the Bash tool.
- The Bash-tool gate is intentional because diagnostics are actionable only if the model can inspect and fix files.
- P2.5 should document whether to keep this gate.
- For DeepCode provider neutrality, diagnostics should not depend on DeepSeek-specific provider capabilities.
- Unlike cache features, LSP diagnostics are provider-neutral.
- The injection point should remain in attachments unless tests prove a synthetic system message is required.
- If a synthetic system message is added, it must be bounded and deduplicated.
- The existing attachment path already handles bounds and deduplication.

### A4. Settings infrastructure

- Settings are defined in `packages/deep-code/src/utils/settings/types.ts`.
- The settings schema uses zod v4.
- The root settings schema is `.passthrough()`.
- New optional fields are backward-compatible.
- Existing settings docs warn not to make new fields required.
- `utils/settings/validation.ts` validates settings content through `SettingsSchema().strict()`.
- `utils/settings/schemaOutput.ts` generates JSON schema from the zod schema.
- ConfigTool supports a curated subset of settings.
- ConfigTool supported keys live in `tools/ConfigTool/supportedSettings.ts`.
- ConfigTool supports source `global`.
- ConfigTool supports source `settings`.
- ConfigTool supports boolean and string values.
- ConfigTool can set nested settings paths through dotted keys.
- Existing `SUPPORTED_SETTINGS` does not include LSP settings.
- Existing settings schema does not include an `lsp` object.
- Existing plugin LSP configuration is not user settings.
- Existing plugin LSP configuration lives in plugin manifests.
- P2.5 needs a new optional `lsp` section.
- The settings object should include `enabled`.
- The settings object should include `poll_after_edit_ms`.
- The settings object should include `max_diagnostics_per_file`.
- The settings object should include `include_warnings`.
- The settings object should include per-language overrides.
- The schema should use camelCase only if matching existing repo style is required.
- The plan uses snake_case field names.
- This repo already has snake_case in `autoMode.soft_deny`.
- It is acceptable to keep `poll_after_edit_ms` for plan fidelity.
- A TypeScript type alias should be exported from settings types after the schema is added.
- ConfigTool should initially expose only coarse booleans and simple numbers if its type support is extended.
- ConfigTool currently has no number setting type.
- Adding `poll_after_edit_ms` to ConfigTool requires number support or leaving it settings-file-only.
- The conservative first ConfigTool scope is `lsp.enabled`.
- Full ConfigTool support can follow after schema support.

### A5. Server registry and plugin interaction

- PURE_DEEPSEEK_PLAN.md lists built-in mappings for `.rs`, `.go`, `.py`, `.ts`, `.tsx`, `.c`, and `.cpp`.
- The current manager has no built-in language registry.
- The current manager gets servers only through plugin configurations.
- Existing plugin schemas can represent all planned servers.
- A built-in registry can reuse the plugin config shape.
- Built-in server configs should merge with plugin server configs.
- Merge order must be explicit.
- Recommended precedence: settings disabled language beats built-in registry.
- Recommended precedence: plugin server can override built-in for the same extension only if configured.
- Recommended first built-in server: TypeScript only.
- TypeScript config should be `typescript-language-server --stdio`.
- TypeScript extensions should include `.ts`, `.tsx`, `.js`, `.jsx` only after deciding JavaScript scope.
- To minimize first blast radius, P2.5.b should start with `.ts` and `.tsx`.
- Missing binary should not surface as a user-blocking error.
- First missing binary should log debug info.
- Optional notification can be deferred until UX policy is clear.
- Built-in registry should use a `which`-style check before spawn or rely on spawn ENOENT handling.
- Existing `LSPClient.ts` already handles ENOENT from spawn.
- A registry-level availability probe can avoid repeated failed spawn attempts.
- The registry should be injectable for tests.

## Phase B - Path options

### Path A - Minimal: bundle TS LSP only, no per-language config

- Path A ships TypeScript diagnostics only.
- Path A uses `typescript-language-server --stdio`.
- Path A keeps a hardcoded `poll_after_edit_ms` of 500.
- Path A does not add an `[lsp]` settings section.
- Path A does not add per-language overrides.
- Path A does not add Rust, Go, Python, C, or C++.
- Path A can reuse existing FileEditTool and FileWriteTool notifications.
- Path A can be 1-2 PRs.
- Path A gives immediate value for this TypeScript codebase.
- Path A does not satisfy the full plan spec.
- Path A leaves plugin-only configuration behavior ambiguous.
- Path A does not answer diagnostics noise controls.
- Path A is useful only as an emergency shrink path.

### Path B - Full per plan

- Path B implements full LSP diagnostics in one phase.
- Path B includes client hardening.
- Path B includes built-in registry for all seven languages.
- Path B includes settings `[lsp]`.
- Path B includes per-language overrides.
- Path B includes tool post-edit hooks.
- Path B includes deterministic 500ms polling.
- Path B includes diagnostics injection tests.
- Path B includes missing-binary and crash behavior.
- Path B matches PURE_DEEPSEEK_PLAN.md most directly.
- Path B risks duplicating existing LSP code if implemented literally.
- Path B likely touches too many files in one PR.
- Path B is 1-2 weeks of work and medium-high risk.
- Path B should not be selected as a single implementation PR.

### Path C - Phased: client hardening plus TS-only first, add languages incrementally

- Path C is the recommended path.
- C.1 audits and hardens the existing LSP service core.
- C.1 adds unit tests with a mock transport or fake server.
- C.1 avoids creating a second LSP client.
- C.2 adds a built-in TypeScript registry path.
- C.2 keeps plugin LSP support intact.
- C.2 proves one real server path before broad language expansion.
- C.3 makes FileEditTool and FileWriteTool post-edit diagnostics deterministic.
- C.3 tests didChange, didSave, diagnostics polling, and next-turn attachment injection.
- C.4 adds settings `[lsp]`.
- C.4 starts with `enabled`, `poll_after_edit_ms`, `max_diagnostics_per_file`, and `include_warnings`.
- C.4 optionally adds ConfigTool support for `lsp.enabled`.
- C.5 expands registry to Rust, Go, Python, C, and C++.
- C.5 adds per-language overrides after TS behavior is stable.
- Path C reduces blast radius.
- Path C produces useful TS diagnostics early.
- Path C gives tests time to stabilize before multi-language process management.
- Path C respects P2_ROADMAP.md's audit-first mitigation.

## Phase C - Recommended path + rationale

- Recommended path: Path C.
- The codebase already has an LSP service.
- Creating a new `services/lsp/client.ts` from scratch would duplicate existing code.
- Existing code covers JSON-RPC framing through `vscode-jsonrpc`.
- Existing code covers lazy server start.
- Existing code covers didOpen, didChange, and didSave.
- Existing code covers passive publishDiagnostics.
- Existing code covers next-turn attachment delivery.
- Existing code covers deduplication and caps.
- Existing code is not yet clearly production-ready for this P2.5 goal.
- There is no direct LSP test suite.
- There is no built-in TypeScript server registry.
- There is no user settings `[lsp]` section.
- There is no deterministic post-edit poll that waits 500ms.
- There is no documented merge policy between plugin servers and built-in servers.
- There are undeclared or incomplete local LSP package dependencies.
- The first phase should therefore stabilize what exists.
- TypeScript-first gives immediate value because DeepCode itself is TypeScript-heavy.
- Multi-language expansion should follow after TS diagnostics demonstrate stable behavior.
- Settings should be introduced before broad language expansion so users can turn noisy servers off.
- Diagnostics injection should prefer the existing attachment pipeline.
- The system-message wording from the plan can be implemented through attachment text if needed.
- P2.5 should be provider-neutral.
- It should not use DeepSeek-only capability flags.
- It should still respect bare mode, workspace trust, and plugin execution safety.

## Phase D - Sub-PR breakdown for Path C

### P2.5.scan - this PR

- Create `P2_5_DESIGN.md`.
- Inventory existing LSP service, tool hooks, settings, and injection paths.
- Recommend Path C.
- Keep the PR docs-only.
- Changed files must be exactly one.

### P2.5.a - Existing LSP core hardening + tests

- Scope: `packages/deep-code/src/services/lsp/`.
- Scope: direct tests under `packages/deep-code/test/p2-5-lsp.test.mjs`.
- Add a test harness for LSP client/manager behavior.
- Prefer a fake stdio server process or mock transport.
- Verify initialize and initialized handshake.
- Verify didOpen before didChange for a newly edited file.
- Verify didChange after an already-open file.
- Verify didSave notification.
- Verify publishDiagnostics registration.
- Verify missing binary degrades without crashing the caller.
- Verify crashed server marks state error.
- Verify shutdown cleans child process state.
- Resolve dependency declaration gaps for `vscode-jsonrpc` and LSP types if needed.
- Add or generate missing source type definitions if the current type-only imports are broken.
- Do not add built-in language registry yet.
- Do not change FileEditTool or FileWriteTool behavior beyond test seams.
- Expected files: 4-7.

### P2.5.b - Built-in registry + TypeScript server integration

- Scope: registry layer around existing `services/lsp/config.ts`.
- Add built-in server config for TypeScript.
- Proposed config: command `typescript-language-server`.
- Proposed args: `['--stdio']`.
- Proposed extension mapping: `.ts` and `.tsx`.
- Decide whether `.js` and `.jsx` are included in a later PR.
- Merge plugin LSP servers and built-in LSP servers with explicit precedence.
- Preserve plugin-provided LSP servers.
- Handle missing `typescript-language-server` by silent degrade.
- Add tests for registry resolution.
- Add tests for plugin override behavior.
- Add tests for missing binary behavior.
- Expected files: 4-8.

### P2.5.c - Tool post-edit diagnostics hooks

- Scope: FileEditTool and FileWriteTool post-edit paths.
- Keep NotebookEditTool out of first scope unless a test fixture proves value.
- Keep BashTool sed edits out of scope.
- Convert existing fire-and-forget notification flow into a small service facade.
- Proposed facade: `services/lsp/postEditDiagnostics.ts`.
- Facade inputs: file path, content, operation, poll delay, diagnostic caps.
- Facade behavior: clear delivered diagnostics, didChange, didSave, wait, collect pending diagnostics.
- Facade must catch errors and return an empty result on failure.
- Preserve current edit success if diagnostics fail.
- Ensure diagnostics are available to the next turn through attachments.
- Test FileEditTool success path emits LSP notifications.
- Test FileWriteTool success path emits LSP notifications.
- Test diagnostics failure does not fail edit/write.
- Test multiple edits to the same file deduplicate.
- Expected files: 5-9.

### P2.5.d - Settings `[lsp]` section + ConfigTool integration

- Scope: `utils/settings/types.ts`.
- Scope: settings validation tests.
- Add optional `lsp` object.
- Add `enabled?: boolean`.
- Add `poll_after_edit_ms?: number`.
- Add `max_diagnostics_per_file?: number`.
- Add `include_warnings?: boolean`.
- Add `languages?: Record<string, ...>` or explicit per-language object after choosing shape.
- Defaults should live in a service module, not scattered call sites.
- Recommended defaults: enabled true, poll 500ms, max 10 per file, include warnings true.
- If warnings prove noisy, switch default to errors-only in this PR with tests.
- ConfigTool should support `lsp.enabled` first.
- ConfigTool number support can be added only if needed for `poll_after_edit_ms`.
- Add schema-output validation.
- Add backward compatibility tests for unknown fields.
- Expected files: 5-8.

### P2.5.e - Multi-language registry expansion

- Add Rust: `.rs` -> `rust-analyzer`.
- Add Go: `.go` -> `gopls serve`.
- Add Python: `.py` -> `pyright-langserver --stdio`.
- Add C: `.c` -> `clangd`.
- Add C++: `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h` only after header behavior decision.
- Add per-language enable/disable settings.
- Add per-language command override.
- Add per-language args override.
- Add per-language startup timeout override.
- Add tests for each extension mapping.
- Add tests for disabled language.
- Add tests for command override.
- Keep real server E2E optional and skipped unless binaries are installed.
- Expected files: 4-8.

### P2.5.test - comprehensive end-to-end hardening, optional split

- Add E2E fake server flow if P2.5.a-c tests are too narrow.
- Test edit TypeScript fixture with deliberate diagnostic from fake server.
- Test next-turn attachment injection.
- Test no diagnostics when LSP is disabled.
- Test missing binary.
- Test server crash.
- Test diagnostics caps.
- Test warnings excluded when configured.
- Test multi-file edit batching or dedup.
- This split is optional if P2.5.a-e already carry sufficient tests.

### P2.5.Z - dist refresh

- Rebuild `packages/deep-code/dist/deepcode-full.mjs`.
- Include LSP registry, settings, and hook changes in the bundle.
- Verify idempotent build SHA.
- Changed files must be dist-only.

### P2.5.cite - close phase

- Update `EXECUTION_LOG.md`.
- Cite scan, a, b, c, d, e, optional test, and Z.
- Advance Phase 2 to P2.6 HTTP/SSE serve mode.
- Keep changed files exactly one.

### Estimated PR count and touch set

- Expected implementation PRs after scan: 6-8.
- Expected files across source and tests before Z/cite: 25-40.
- Dist refresh adds one generated bundle file.
- Cite adds one execution log file.

## Phase E - Risk assessment

### LSP server availability

- TypeScript server may not be installed.
- Rust, Go, Python, and clangd servers are commonly absent.
- Missing binary must not crash the user turn.
- Existing `LSPClient.ts` handles spawn ENOENT asynchronously.
- Registry-level availability caching can reduce repeated ENOENT attempts.
- First user-facing behavior should be silent degrade.
- Optional debug logging should identify missing binaries.
- Optional future doctor check can report installed/missing servers.

### Diagnostics noise

- Warnings can flood model context.
- Hints and info can be noisy.
- Existing `LSPDiagnosticRegistry.ts` caps 10 diagnostics per file and 30 total.
- These caps are hardcoded today.
- P2.5 settings should make caps configurable.
- Recommended first default: max 10 per file.
- Recommended first default for total: keep 30 or expose later.
- `include_warnings` should be a real setting.
- If false, keep only Error severity diagnostics.
- Diagnostics should be sorted by severity before truncation.

### Tool hook timing

- Some LSP servers publish diagnostics after a delay.
- Too short a poll delay misses diagnostics.
- Too long a delay slows edits and turns.
- PURE_DEEPSEEK_PLAN.md recommends 500ms.
- Existing flow is fire-and-forget and next-turn attachment based.
- Path C should test whether the existing async registry already satisfies the next-turn timing.
- If not, add a post-edit polling facade.
- Polling should be bounded by timeout.
- Polling should be cancel-safe.

### Process management

- LSP servers persist between turns.
- Persistent servers improve latency after cold start.
- Persistent servers increase memory footprint.
- Existing shutdown registration handles process cleanup on exit.
- Existing reinitialize path handles plugin refresh.
- Existing crash recovery has max restart behavior.
- P2.5 should test cleanup and crash recovery.
- P2.5 should avoid starting servers before workspace trust.
- P2.5 should preserve bare mode skip behavior.

### Multi-file edits

- A single turn may edit multiple files.
- Current registry receives diagnostics asynchronously by file.
- Multiple diagnostics for the same file can duplicate across notifications.
- Existing registry deduplicates by URI, range, message, severity, source, and code.
- Existing registry uses LRU tracking for delivered diagnostics.
- File edits clear delivered diagnostics for that file.
- P2.5 should test multi-file and repeated same-file edits.
- A future batching layer can wait once per turn instead of once per edit.
- First scope can remain per edit if latency stays bounded.

### Cross-platform LSP binary detection

- Windows may require `.cmd` shims for npm-installed language servers.
- Existing `child_process.spawn` is less forgiving than execa for Windows command resolution.
- Existing `execFileNoThrow` uses execa and handles Windows shell compatibility.
- LSP servers need long-lived stdio, so execa is not a direct replacement.
- Registry should allow command overrides.
- Registry should support absolute command paths.
- Registry should document expected executable names per platform.
- Tests should cover command resolution logic without spawning real platform binaries.

### LSP server crash

- Server crash should not break a user edit.
- Existing client sets crash state through `onCrash`.
- Existing instance caps crash recovery attempts.
- Existing notification failures are logged and swallowed.
- P2.5 should test crash during diagnostics.
- P2.5 should test restart on next use after crash.
- P2.5 should avoid infinite respawn loops.

### Existing dependency and type gaps

- LSP source imports packages not declared in package manifests.
- Local node_modules contains an incomplete `vscode-jsonrpc` directory.
- `vscode-languageserver-types` is not resolvable locally.
- `vscode-languageserver-protocol` is not resolvable locally.
- Bun build may currently tree-shake or type-erase enough to pass non-LSP flows.
- P2.5 makes LSP central, so dependencies must be explicit.
- This should be fixed before enabling built-in TypeScript LSP.

### Plugin execution safety

- LSP servers are executable code.
- Existing initialization is after trust dialog acceptance.
- Built-in registry must keep that invariant.
- Plugin LSP servers should remain gated by plugin trust and marketplace policy.
- Built-in servers still execute local binaries from PATH.
- Built-in server execution should be documented as local tool execution.
- Missing or untrusted workspaces should not start LSP servers.

### Restore/snapshot interaction

- P2.4 snapshots can restore bad edits.
- P2.5 diagnostics injection should not mutate files.
- Diagnostics should not trigger snapshots by itself.
- Restore may change files outside FileEditTool/FileWriteTool.
- After restore, delivered diagnostics for restored files may be stale.
- A future integration can clear LSP diagnostics after `/restore`.
- This is not required for TS-first P2.5.

## Phase F - Key decisions

- Q1. Path A/B/C selection?
- Recommendation: Path C.
- Q2. Should P2.5 create new client files or reuse existing PascalCase files?
- Recommendation: reuse existing files and add facades/tests.
- Q3. Built-in server list: full seven languages or TS-only first?
- Recommendation: TS-only first.
- Q4. Dependency policy for LSP packages?
- Recommendation: declare needed LSP packages explicitly before enabling built-in LSP.
- Q5. `poll_after_edit_ms` default?
- Recommendation: 500ms per plan.
- Q6. `max_diagnostics_per_file` default?
- Recommendation: 10, matching existing hardcoded cap.
- Q7. Include warnings by default?
- Recommendation: include warnings initially because existing registry includes all severities, but expose `include_warnings`.
- Q8. Tool scope?
- Recommendation: FileEditTool and FileWriteTool only for first integration.
- Q9. NotebookEditTool scope?
- Recommendation: defer until notebook diagnostics are intentionally designed.
- Q10. Bash sed and shell edits scope?
- Recommendation: defer.
- Q11. Server lifecycle?
- Recommendation: per-session lazy spawn with cleanup on shutdown.
- Q12. Idle timeout?
- Recommendation: no idle timeout in first implementation.
- Q13. Diagnostics format?
- Recommendation: reuse diagnostics attachments; add synthetic summary only if model context tests require it.
- Q14. Plugin vs built-in registry precedence?
- Recommendation: built-in defaults first, plugin overrides explicit by extension/server name, settings can disable either.
- Q15. Missing binary user feedback?
- Recommendation: silent degrade plus debug log in P2.5; doctor check later.
- Q16. Provider coupling?
- Recommendation: provider-neutral; no DeepSeek capability gate.

## Phase G - Reference appendix

### Existing LSP files

- Service files: `LSPClient.ts`, `LSPServerInstance.ts`, `LSPServerManager.ts`, `manager.ts`, `config.ts`, `passiveFeedback.ts`, and `LSPDiagnosticRegistry.ts`.
- Tool files: `LSPTool.ts`, `schemas.ts`, `formatters.ts`, `UI.tsx`, `prompt.ts`, and `symbolContext.ts`.

### Existing JSON-RPC and process precedents

- LSP JSON-RPC uses `vscode-jsonrpc` stream reader/writer.
- MCP stdio uses `@modelcontextprotocol/sdk/client/stdio.js`.
- MCP client has robust stderr capture and connection timeout patterns.
- `utils/subprocessEnv.ts` scrubs sensitive subprocess env vars.
- `services/voice.ts` demonstrates child process probing and fallback.
- `utils/execFileNoThrow.ts` demonstrates cross-platform process wrapper style.

### Existing tool hook references

- Edit/write hooks: `FileEditTool.ts`, `FileWriteTool.ts`, `NotebookEditTool.ts`, `BashTool.tsx`, and `sedEditParser.ts`.

### Existing diagnostics injection references

- Injection path: `diagnosticTracking.ts`, `passiveFeedback.ts`, `LSPDiagnosticRegistry.ts`, `attachments.ts`, `DiagnosticsDisplay.tsx`, and `REPL.tsx`.

### Existing settings references

- Settings path: `utils/settings/types.ts`, `validation.ts`, `schemaOutput.ts`, `tools/ConfigTool/ConfigTool.ts`, and `supportedSettings.ts`.

### TypeScript language server cheat sheet

- Command: `typescript-language-server`.
- Args: `--stdio`.
- Extensions first scope: `.ts`, `.tsx`.
- LSP language ids: `typescript`, `typescriptreact`.
- Required sync sequence: initialize, initialized, didOpen or didChange, didSave.
- Diagnostics arrive as `textDocument/publishDiagnostics`.
- Cold start can take multiple seconds in large projects.
- P2.5 should not block edit success on cold start.

### Settings schema example

```json
{
  "lsp": {
    "enabled": true,
    "poll_after_edit_ms": 500,
    "max_diagnostics_per_file": 10,
    "include_warnings": true,
    "languages": {
      "typescript": {
        "enabled": true,
        "command": "typescript-language-server",
        "args": ["--stdio"]
      }
    }
  }
}
```

## Local verification plan

- Run `bun test` from `packages/deep-code`.
- Expected: 69/69 pass.
- Confirm `git diff --name-only` shows only `P2_5_DESIGN.md`.
- Confirm no source, test, or dist files changed.

## PR checklist

- Branch: `phase2/p2-5-scan`; base SHA `283cb8922739b43c4062fd7f628853d624a0a0fd`.
- Title: `docs: P2.5 post-edit LSP diagnostics scan + path recommendation`.
- Hard cap: one docs file, `P2_5_DESIGN.md`.
- Recommended path: Path C; estimated 6-8 sub-PRs and 25-40 file touches.
- Key risks: existing LSP hardening, missing binaries, diagnostics noise, timing, process lifecycle, multi-file edits, cross-platform command detection, server crash, dependency gaps.
