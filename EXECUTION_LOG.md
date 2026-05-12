# DeepCode pure-DeepSeek migration — execution log

Last updated: 2026-05-12 (P1.1.C.2.b.1)
Source plans: PURE_DEEPSEEK_PLAN.md, SANDBOX_FORTRESS_PLAN.md

## Quick status

| Track | Phase | Last completed | Next ready | Blocked? |
|---|---|---|---|---|
| A: Pure-DeepSeek | 1 | P1.1.C.2.b.1 replace BridgePermissionCallbacks type | P1.1.C.2.b.2 strip bridge imports in CLI / footer / cli entrypoint / main | no |
| B: Sandbox Fortress | F1 | F1.2 per-tool profiles | F1.3 adapter test coverage hardening | no |

## How to use this file

- Codex updates this file as part of EVERY task PR. Same commit, never a
  separate one.
- Before starting a task: add a row in "Currently in flight" with task ID,
  branch name, start timestamp.
- On task completion: move the task row from `ready` to `done` in its track
  section, fill PR plus short SHA, remove from "Currently in flight",
  update Quick status.
- If blocked mid-task: mark `blocked` with reason, add to "Blocked items".
- Status markers: `done` · `in-flight` · `ready` · `blocked`.

## Track A — PURE_DEEPSEEK_PLAN.md

### Phase 0: audit

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| P0.1 SDK imports inventory | done | #5 | `9b0b34f` | 227 entries; .json plus .md |
| P0.2 Anthropic-only features | done | (squashed) | `75b5b19` | 21 scopes |
| P0.2-fix file-level breakdown | done | (squashed) | `156d1d7` | 71 file rows |
| P0.3 config and env migration | done | (squashed) | `1b6afcf` | 1607 rows |
| P0.4 product references | done | #12 | `37a6cf7` | 3328 entries |
| P0.5 risk register | done | #13 | `059c6b7` | 28 risks |
| P0.6 sign-off | done | #16 | `bcc1feb` | 34/34 spot-checks |
| Phase 1 decision docs | done | #20 | `479534b` | 6 decision docs plus audit/README plus EXECUTION_LOG |
| Phase 1 decision docs markdown fix | done | (this PR) | (this commit) | restore stripped headings/backticks/code fences |

### Phase 1: excise Anthropic surfaces

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| P1.1.A force-disable bridge gate | done | #22 | `c4fa7d3` | bridgeEnabled.ts gate functions hard-coded to false/null |
| P1.1.B.1 remove dead `isBridgeEnabled()` branches | done | #25 | `d057278` | PromptInputFooter, Settings/Config, main.tsx --rc and ccrMirror checks |
| P1.1.B.2 strip Remote Control UI hookups from REPL and PromptInput | done | #26 | `2ccab93` | REPL.tsx and PromptInput.tsx no longer reference useReplBridge, RemoteCallout, BridgeDialog, showBridgeDialog, sendBridgeResultRef, or showRemoteCallout |
| P1.1.B.3 strip bridge URI scheme + BRIDGE_MODE upload guard + deregister bridge commands and prompt.ts | done | #27 | `a3446c6` | SendMessageTool bridge scheme out (impl + model prompt); BriefTool attachments guard out; commands.ts deregisters btw and bridge-kick |
| P1.1.B.4 delete cli/remoteIO and strip CCR v2 from print.ts | done | #28 | `ca8210a` | cli/remoteIO.ts gone; print.ts no longer references RemoteIO, hydrateFromCCRv2InternalEvents, or CLAUDE_CODE_USE_CCR_V2; ccrClient.ts deletion deferred to P1.1.C; --sdk-url option declaration removed from main.tsx (downstream readers left dead for P1.11) |
| P1.1.B.5 strip /btw UI affordances | done | #29 | `e3bd1b9` | PromptInputHelpMenu /btw menu entry, Spinner /btw tip, PromptInput btw highlighting all removed; Remote Control state-read dead branches deferred to P1.11; bridgeStatusUtil shimmer utility extraction deferred to P1.1.C |
| P1.1.C.1 extract bridge-borrowed utilities | done | #30 | `319d3d5` | shimmer animation + BoundedUUIDSet moved to src/utils; Spinner and useRemoteSession import paths updated |
| P1.1.C.2.a stub residual bridge imports in command files | done | #31 | `28c2999` | login + logout: local trustedDevice no-op stubs; rename: bridge rename block removed; ultraplan: REMOTE_CONTROL_DISCONNECTED_MSG inlined |
| P1.1.C.2.b.1 replace BridgePermissionCallbacks type + simplify sessionIdCompat | done | #32 | `54b1f73` | AppStateStore + interactiveHandler use local BridgePermissionCallbacks type; constants/product getRemoteSessionUrl no longer requires bridge/sessionIdCompat |
| P1.1.C.2.b.2 strip bridge imports in CLI / footer / cli entrypoint / main | ready | — | — | depends on P1.1.C.2.b.1; cli/print.ts, PromptInputFooter (BridgeStatusIndicator), entrypoints/cli.tsx fast-path, main.tsx trustedDevice + bridge commander |
| P1.1.C.3 delete src/bridge, src/commands/bridge, src/commands/btw, orphan files, replace LICENSE.md | ready | — | — | depends on P1.1.C.2.b; final mass deletion; AGPL-3.0 LICENSE per LICENSE-DECISION.md |
| P1.2 delete Teleport / Ultraplan / CCR | ready | — | — | depends on P1.1 stubs |
| P1.3 delete Chrome / Desktop / OAuth UI | ready | — | — | depends on P1.2; `docs/deepseek-auth.md` done |
| P1.4 config paths `~/.claude` to `~/.deepcode` | ready | — | — | depends on P1.3 |
| P1.5 `CLAUDE.md` to `DEEPCODE.md` memory | ready | — | — | depends on P1.4 |
| P1.6 remove `CLAUDE_CODE_*` env reads | ready | — | — | depends on P1.4/P1.5 |
| P1.7 replace voice STT (Whisper.cpp) | ready | — | — | `docs/voice-stt.md` done; parallel after P1.3 |
| P1.8 stub `@anthropic-ai/sdk` types | ready | — | — | depends on P1.1-P1.7 callers stable |
| P1.9 drop `@anthropic-ai/sdk` from `package.json` | ready | — | — | depends on P1.8 |
| P1.10 GrowthBook/Statsig plus OTel rename | ready | — | — | `docs/otel-rename.md` done; after P1.4 |
| P1.11 residual cleanup plus model alias swap | ready | — | — | `docs/model-alias-deprecation.md` done; after P1.10 |
| P1.12 Phase 1 sign-off PR | ready | — | — | after P1.1-P1.11 |

### Phases 2-5

Not decomposed yet; refer to `PURE_DEEPSEEK_PLAN.md` and expand here on
phase entry.

## Track B — SANDBOX_FORTRESS_PLAN.md

### F0: scaffold

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| F0.1 fortress scaffold | done | (squashed) | `08f6e7b` | manager plus types plus dirs |
| F0.2 test harness plus bench | done | (squashed) | `49183cf` | 343-line harness |
| F0.3 API contract | done | #14 | `9d7bee8` | 745-line contract |
| F0.3-fix canonicalize path | done | #15 | `7bb9bfc` | dedup root vs package |

### F1: integrate fortress structure

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| F1.1 migrate adapter into fortress | done | #17 | `cbe57d4` | git mv plus shim |
| F1.2 per-tool sandbox profiles | done | #24 | `a0a72c2` | TOOL_PROFILES + mergeProfileIntoConfig + Shell/Bash/manager plumbing; FS enforcement working; network enforcement deferred to F2.x |
| F1.3 adapter test coverage hardening | ready | — | — | depends on F1.2 |

### F2-F5

### F2: hardening and enforcement

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| F2.x Layer 2 network outbound enforcement | ready | — | — | enforce per-tool networkMode via outbound proxy interceptor; surfaced as gap during F1.2 |

## External decisions

| Decision | Path | Status |
|---|---|---|
| License posture | `LICENSE-DECISION.md` | done |
| DeepSeek auth UX | `docs/deepseek-auth.md` | done |
| Model alias deprecation | `docs/model-alias-deprecation.md` | done |
| OTel rename | `docs/otel-rename.md` | done |
| Voice STT replacement | `docs/voice-stt.md` | done |
| sandbox-runtime distribution | `docs/sandbox-runtime-distribution.md` | done |

## Currently in flight

(none)

## Blocked items

(none)

## Conventions

- "Squashed" in PR column means merge happened before consistent PR
  labelling; the commit is authoritative.
- Commit short SHA is 7 characters. Always cite merge commit, not branch tip.
- "Depends on X" means cannot start until X is done.
- "Parallel after X" means can start once X is done but does not need X's
  output.
- Update this log in the SAME PR/commit as the task it tracks. Never make
  log-only commits.
- Markdown formatting: ASCII pipes `|` only, no Unicode box-drawing.
- When authoring new doc files, always verify after writing: heading count,
  inline-code backtick count, code-fence count match expectations. Codex
  tooling has stripped markdown markers in past PRs (#18, #20).
