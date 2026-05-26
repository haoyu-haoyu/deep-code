# P2 Roadmap — DeepSeek-TUI Feature Adoption
Status: scan and entry recommendation
Date: 2026-05-26
Base: v0.2.0-pure / P1.12 Phase 1 sign-off
## Purpose
Phase 1 removed Anthropic runtime surfaces and established a DeepSeek-native
baseline. Phase 2 is different: it is feature adoption work, not excision work.
This roadmap turns the Phase 2 section of `PURE_DEEPSEEK_PLAN.md` into a
starter sequence and recommends the first implementation target.
Primary source:
- `PURE_DEEPSEEK_PLAN.md` L810-L1190
Source gap:
- `PURE_DEEPSEEK_PLAN.md` references `docs/COMPETITIVE_ANALYSIS.md`.
- That file is absent in this checkout.
- This scan records the gap but does not block Phase 2 entry on it.
Recommendation:
- Start with P2.1 Auto mode router.
- Keep P2.1 DeepSeek-only.
- Defer multi-provider generalization to P2.2.
## Phase A — Phase 2 Feature Inventory
### A0. Inventory Summary
The plan lists nine Phase 2 features in ROI order:
1. Auto mode router (P2.1) — half day, high UX win
2. Multi-provider support (P2.2) — 2-3 days
3. Cache visualization (P2.3) — 3-5 days, DeepSeek killer feature
4. Workspace rollback (P2.4) — 1 week
5. Post-edit LSP diagnostics (P2.5) — 1-2 weeks
6. HTTP/SSE serve mode (P2.6) — 1 week
7. Session fork (P2.7) — 1 day
8. Doctor command (P2.8) — half day
9. Workspace-local slash commands (P2.9) — 1 day
### A1. P2.1 Auto Mode Router
Plan goal:
- Add `--model auto`.
- Add `/model auto`.
- Run a small router call before the real model turn.
- Choose model plus thinking level.
- Show the chosen route in the TUI footer.
Plan files:
- New: `src/services/autoMode/router.ts`
- Modify: `src/services/providers/deepseek.mjs`
- Modify: `src/main.tsx`
- Modify: `src/commands/model.tsx`
Current tree correction:
- `packages/deep-code/src/services/providers/deepseek.mjs` exists.
- `packages/deep-code/src/services/runtime/messageSend.ts` owns DeepSeek
  provider streaming.
- `packages/deep-code/src/commands/model/model.tsx` is the actual model command
  file.
- `packages/deep-code/src/utils/model/model.ts` already defines
  `deepseek-v4-flash` as the small fast model.
- `packages/deep-code/src/main.tsx` already accepts `--model <model>`.
Risk:
- The router call adds latency and can make bad choices.
Mitigation:
- Add a timeout.
- Use deterministic heuristic fallback.
- Surface the route decision compactly.
### A2. P2.2 Multi-Provider Support
Plan goal:
- Add `--provider {deepseek,ollama,vllm,openai-compatible}`.
- Add provider-specific stream adapters.
- Save provider-specific auth/config.
- Add model listing.
Current tree correction:
- `packages/deep-code/src/services/providers/registry.mjs` exists.
- `packages/deep-code/src/services/providers/types.mjs` exists.
- `packages/deep-code/src/services/providers/deepseek-config-store.mjs` exists.
- `packages/deep-code/src/utils/model/providers.js` is also still used.
Risk:
- Provider code already exists in more than one layer.
Mitigation:
- Start P2.2 with a provider-boundary audit.
- Do not create a third provider abstraction.
### A3. P2.3 Cache Visualization
Plan goal:
- Parse DeepSeek cache hit/miss usage fields.
- Show a cache hit-rate status chip.
- Add `/cache inspect`, `/cache warmup`, and `/cache clear`.
Current tree correction:
- `packages/deep-code/src/cache/deepseek-cache.mjs` exists.
- `packages/deep-code/src/cache/deepseek-warmup.mjs` exists.
- `packages/deep-code/src/deepcode/cache-telemetry.mjs` exists.
- `packages/deep-code/src/commands/break-cache/index.js` exists.
- `test/tui-deepseek.test.mjs` already includes sample cache usage fields.
Risk:
- Cache numbers can be misleading if provider-specific usage fields differ.
Mitigation:
- Keep the first visualization DeepSeek-specific.
- Add provider capability gates later.
### A4. P2.4 Workspace Rollback
Plan goal:
- Snapshot the workspace into a side git directory.
- Add `/restore`.
- Add a `revert_turn` tool.
- Enforce a disk cap.
Current tree correction:
- No `packages/deep-code/src/services/snapshot/` directory exists.
- This feature is a new subsystem.
Risk:
- Snapshot operations can race with tool writes and user edits.
Mitigation:
- Use side git only.
- Add lock files.
- Never touch the user's `.git`.
- Start with a design/audit PR before implementation.
### A5. P2.5 Post-Edit LSP Diagnostics
Plan goal:
- Query LSP diagnostics after edit/write operations.
- Inject diagnostics into the next model turn.
- Degrade silently when the LSP is missing or slow.
Current tree correction:
- `packages/deep-code/src/services/lsp/` already exists.
- Present files include `LSPClient.ts`, `LSPServerManager.ts`, `manager.ts`,
  `config.ts`, `passiveFeedback.ts`, and `LSPDiagnosticRegistry.ts`.
- Plugin LSP helpers exist under `packages/deep-code/src/utils/plugins/`.
Risk:
- The plan treats LSP as new, but code already exists.
Mitigation:
- Audit the existing LSP subsystem before adding new client code.
### A6. P2.6 HTTP/SSE Serve Mode
Plan goal:
- Add `deepcode serve --http`.
- Expose session and turn endpoints.
- Stream turn events over SSE.
- Authenticate with a local bearer token.
Current tree correction:
- `packages/deep-code/src/server/` exists for direct-connect style support.
- No `packages/deep-code/src/cli/serve/` directory exists.
Risk:
- Long-running server lifecycle and cancellation semantics need precision.
Mitigation:
- Bind to localhost by default.
- Require explicit bearer token.
- Reuse internal event shapes only after checking they are stable.
### A7. P2.7 Session Fork
Plan goal:
- Add `deepcode fork <session-id> [--at-turn N]`.
- Copy a session JSONL prefix into a new session.
- Preserve the original session unchanged.
Current tree correction:
- `packages/deep-code/src/utils/conversationRecovery.ts` exists.
- Session storage and resume behavior already exist.
Risk:
- Turn boundary definitions are easy to get wrong with tool-use messages.
Mitigation:
- Define a canonical turn boundary before implementation.
- Test mixed text/tool/result sessions.
### A8. P2.8 Doctor Command
Plan goal:
- Expand `deepcode doctor`.
- Add `--json`.
- Check key, network, models, LSP, snapshot directory, and disk usage.
Current tree correction:
- `packages/deep-code/src/deepcode/doctor.mjs` exists.
- `packages/deep-code/src/commands/doctor/index.ts` exists.
- `packages/deep-code/src/commands/doctor/doctor.tsx` exists.
- Package tests already cover `/doctor` registration and basic output.
Risk:
- Doctor checks can become expensive or surprising.
Mitigation:
- Keep default checks cheap.
- Gate network checks behind explicit intent or short timeout.
### A9. P2.9 Workspace-Local Slash Commands
Plan goal:
- Load `<workspace>/.deepcode/commands/*.md`.
- Support `.cursor/commands/*.md` compatibility.
- Support `.claude/commands/*.md` as named legacy compatibility.
- Add slash autocomplete.
Current tree correction:
- Phase 1 already made `.deepcode/` primary and kept named legacy fallbacks.
- Command registration exists and can be extended.
Risk:
- Workspace commands can shadow global commands.
Mitigation:
- Define precedence explicitly.
- Show provenance for workspace-local commands.
## Phase B — ROI Prioritization Rationale
### B1. Does The Plan Order Still Hold?
Mostly yes.
The order still makes sense for user value:
1. P2.1 Auto mode is small and immediately useful.
2. P2.2 Multi-provider unlocks self-hosted use.
3. P2.3 Cache visualization makes DeepSeek-specific value visible.
4. P2.4 Workspace rollback reduces risk from agentic editing.
5. P2.5 LSP diagnostics improves edit correctness.
6. P2.6 HTTP/SSE serve mode enables automation.
7. P2.7 Session fork improves exploration.
8. P2.8 Doctor improves supportability.
9. P2.9 Workspace commands improves project ergonomics.
One practical adjustment:
- Doctor already exists and can be expanded opportunistically.
- It should not displace P2.1 because it is polish, not a core workflow
  multiplier.
### B2. Self-Use Value
Highest immediate value:
- P2.1 Auto mode router
- P2.3 Cache visualization
- P2.4 Workspace rollback
- P2.5 Post-edit LSP diagnostics
Medium value:
- P2.2 Multi-provider support
- P2.7 Session fork
- P2.8 Doctor command
Lower immediate value:
- P2.6 HTTP/SSE serve mode
- P2.9 Workspace-local slash commands
### B3. Recommended Starting Feature
Start with P2.1.
Why:
- Small blast radius.
- Clear tests.
- Exercises the clean DeepSeek provider baseline.
- Does not require broad provider refactoring.
- Creates status-display patterns reused by cache visualization.
## Phase C — P2.1 Auto Mode Router Starter Design
### C1. User-Facing Behavior
CLI:
```bash
deepcode --model auto "explain this file"
```
TUI:
```text
/model auto
```
Footer:
```text
auto -> flash/off
auto -> pro/max
```
### C2. Model Mapping
Use abstract router labels internally:
- `flash` -> `deepseek-v4-flash`
- `pro` -> current main loop DeepSeek model
- `off` -> no extra thinking effort
- `high` -> existing high effort path
- `max` -> existing max effort path
Do not hard-code long-term exact model IDs in every call site.
### C3. Starter File List
New:
- `packages/deep-code/src/services/autoMode/router.ts`
- `packages/deep-code/test/p2-1-auto-mode.test.mjs`
Modify:
- `packages/deep-code/src/services/providers/deepseek.mjs`
- `packages/deep-code/src/services/runtime/messageSend.ts`
- `packages/deep-code/src/main.tsx`
- `packages/deep-code/src/commands/model/model.tsx`
- model option helpers under `packages/deep-code/src/utils/model/` if needed
### C4. ROUTER_SYSTEM Prompt
Use the plan prompt as the first implementation prompt:
```ts
const ROUTER_SYSTEM = `You are a router. Given the user's latest message
and a short context summary, output JSON: {"model":"flash"|"pro","thinking":"off"|"high"|"max"}.
Use flash+off for short questions, pro+max for ambiguous multi-step coding tasks.
No prose, only JSON.`;
```
Constraints:
- No tools.
- Temperature 0.
- Short context only.
- Reject unknown values.
- Malformed output falls back to heuristic.
### C5. Types
Suggested shape:
```ts
export type AutoRouteModel = 'flash' | 'pro'
export type AutoRouteThinking = 'off' | 'high' | 'max'
export type AutoRouteDecision = {
  model: AutoRouteModel
  thinking: AutoRouteThinking
  source: 'router' | 'heuristic'
  reason?: string
}
```
### C6. routeTurn Signature
```ts
export async function routeTurn(
  messages: readonly unknown[],
  signal: AbortSignal,
): Promise<AutoRouteDecision>
```
Behavior:
1. Extract latest user request.
2. Build a short context summary.
3. Call DeepSeek with `deepseek-v4-flash`.
4. Parse JSON.
5. Validate schema.
6. Resolve labels into model/effort for the real turn.
7. Fall back to heuristic on timeout, abort, parse failure, or invalid values.
### C7. Fallback Heuristic
First pass:
- Short factual request under 300 characters: `flash/off`
- Read-only or simple explanation request: `flash/off`
- Single-file edit: `pro/high`
- Multi-file edit, debugging, refactor, or test repair: `pro/max`
- User asks for speed: `flash/off`
- User asks for depth, architecture, or proof: `pro/max`
The heuristic should be deterministic so tests can assert exact outcomes.
### C8. Turn Loop Integration
Integration requirements:
- Run the router before the real model request.
- Do not mutate the conversation history with router prompt content.
- Store route decision as transient per-turn metadata.
- Let TUI status read the decision without rerunning the router.
- Preserve sub-agent cache-safe parameter behavior.
Sub-agent rule:
- Inherit `auto` unless a sub-agent explicitly receives a model.
### C9. Test Fixture Plan
Create:
- `packages/deep-code/test/p2-1-auto-mode.test.mjs`
Test cases:
1. CLI accepts `--model auto`.
2. `/model auto` appears in model options.
3. Router returns `flash/off`; real provider receives `deepseek-v4-flash`.
4. Router returns `pro/max`; real provider receives main model and max effort.
5. Invalid JSON uses heuristic fallback.
6. Abort does not crash the turn.
7. Footer formatter renders `auto -> flash/off`.
Use existing patterns:
- Bun `mock.module` from runtime tests
- TUI harness conventions from `test/tui-deepseek.test.mjs`
## Phase D — Cross-Feature Dependencies
### D1. P2.1 vs P2.2
P2.1 and P2.2 are independent enough to split.
Recommendation:
- P2.1 stays DeepSeek-only.
- P2.2 later adds provider capability flags.
- Providers without router support can use heuristic-only auto mode or reject
  `auto` with a clear message.
### D2. P2.2 vs P2.3
Cache visualization can start before full multi-provider support if it is
DeepSeek-specific.
Recommendation:
- If P2.3 lands before P2.2, name telemetry DeepSeek-specific.
- If P2.2 lands first, expose cache telemetry as provider capability.
### D3. P2.4 vs P2.5
Rollback and LSP diagnostics share edit/write hooks.
Recommendation:
- Build rollback before broad LSP diagnostics if both touch the same lifecycle.
- Do an LSP audit first because LSP code already exists.
### D4. P2.6 Dependencies
HTTP/SSE serve mode benefits from:
- provider abstraction from P2.2
- snapshot safety from P2.4
- diagnostics status from P2.5
It should not block P2.1-P2.5.
### D5. P2.7 Dependencies
Session fork can move earlier than P2.6 if it remains local to JSONL session
copying.
### D6. P2.8 Dependencies
Doctor can expand incrementally after each feature:
- after P2.1: auto route smoke check
- after P2.2: provider checks
- after P2.3: cache telemetry checks
- after P2.4: snapshot storage checks
- after P2.5: LSP checks
### D7. P2.9 Dependencies
Workspace-local slash commands depend mainly on Phase 1 path policy and command
registration. They are otherwise independent.
## Phase E — Recommended Phase 2 Entry Sequence
### E1. Sequence
1. P2.scan — this roadmap.
2. P2.1.a — auto router module + DeepSeek helper + tests.
3. P2.1.b — CLI/model command plumbing + runtime integration.
4. P2.1.c — footer/status display + fallback hardening.
5. P2.1.Z — dist refresh if source changes affect the bundle.
6. P2.2.scan — provider-boundary audit.
7. P2.2 implementation or P2.3 cache visualization, depending on P2.1 findings.
### E2. P2.1 PR Breakdown
Recommended split:
- P2.1.a: router scaffold and unit tests
- P2.1.b: runtime integration and model selection surfaces
- P2.1.c: TUI footer and edge-case hardening
- P2.1.Z: dist-only refresh if needed
If P2.1 stays small, combine P2.1.a and P2.1.b.
### E3. When To Start P2.2
Start P2.2 after P2.1 answers:
- Where route decisions are stored
- How model choice is normalized
- How effort/thinking is passed to runtime
- Whether provider helpers need capability flags
- How status UI consumes model metadata
### E4. Risk Snapshot
| Feature | Risk | Main mitigation |
|---|---|---|
| P2.1 Auto mode | low-medium | timeout + heuristic fallback |
| P2.2 Multi-provider | medium | provider-boundary scan first |
| P2.3 Cache visualization | medium | DeepSeek-only telemetry first |
| P2.4 Workspace rollback | medium-high | side git + lock file + disk cap tests |
| P2.5 LSP diagnostics | medium-high | audit existing LSP system first |
| P2.6 HTTP/SSE serve | medium | localhost bind + bearer token + integration tests |
| P2.7 Session fork | low-medium | canonical JSONL turn-boundary tests |
| P2.8 Doctor | low | cheap default checks |
| P2.9 Workspace commands | low-medium | explicit precedence + provenance |
## Phase F — Phase 1 Completion Verification
### F1. Baseline
Phase 2 starts from:
- Tag: `v0.2.0-pure`
- Commit: `7906c5f85ca05417097dc552e9a502d6fd02eba1`
- P1.12 PR: #184
### F2. Phase 1 Final State
Recorded Phase 1 final metrics:
- src/ `@anthropic-ai/sdk` imports: 0
- src/ `services/analytics/growthbook` imports: 0
- voice mode runtime: 0
- Anthropic model alias literals: 0
- teleport infrastructure: 0
- dist/deepcode-full.mjs: 415365 lines
- bun test: 69/69
### F3. P2 Scan Verification
This PR must remain docs-only:
- changedFiles = 1
- file: `P2_ROADMAP.md`
- no source/test/dist changes
- no `EXECUTION_LOG.md`, `TODO.md`, or `audit/` changes
- `bun test` remains 69/69
### F4. Open Documentation Gap
Missing file:
- `docs/COMPETITIVE_ANALYSIS.md`
Recommendation:
- Do not block P2.1.
- Treat this roadmap plus `PURE_DEEPSEEK_PLAN.md` as enough for Phase 2 entry.
- Recreate competitive-analysis details only if a later P2.x scan needs them.
## Recommended First Implementation PR
Title:
- `feat: P2.1 auto mode router scaffold`
Expected changed files:
- `packages/deep-code/src/services/autoMode/router.ts`
- `packages/deep-code/src/services/providers/deepseek.mjs`
- `packages/deep-code/src/services/runtime/messageSend.ts`
- `packages/deep-code/src/utils/model/modelOptions.ts`
- `packages/deep-code/src/commands/model/model.tsx`
- `packages/deep-code/src/main.tsx`
- `packages/deep-code/test/p2-1-auto-mode.test.mjs`
Hard cap recommendation:
- 10 files for the first implementation PR
Validation:
- `bun run build:full-cli`
- `bun test`
- targeted P2.1 fixture
Exit criteria:
- `deepcode --model auto "hi"` reaches the real provider path in mocked tests.
- `/model auto` is selectable.
- heuristic fallback covers router failure.
- route decision is visible in compact status.
