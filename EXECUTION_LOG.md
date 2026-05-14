# DeepCode pure-DeepSeek migration — execution log

Last updated: 2026-05-14 (P1.2.N.a)
Source plans: PURE_DEEPSEEK_PLAN.md, SANDBOX_FORTRESS_PLAN.md

## Quick status

| Track | Phase | Last completed | Next ready | Blocked? |
|---|---|---|---|---|
| A: Pure-DeepSeek | 1 | P1.2.N.a delete RemoteAgent + ultraplan cluster | P1.2.N.b delete teleport resume picker chain | no |
| B: Sandbox Fortress | F1 | F1.3 adapter test coverage hardening | F2.x Layer 2 network outbound enforcement | no |

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
| P1.1.C.2.b.2 strip bridge imports in CLI / footer / cli entrypoint / main | done | #33 | `251e28b` | print.ts: remote_control SDK branch deleted, bridgeHandle + forwardMessagesToBridge + resolveAndPrepend gone; PromptInputFooter BridgeStatusIndicator deleted; cli.tsx bridge fast-path deleted; main.tsx trustedDevice + remote-control commander deleted |
| P1.1.C.3 delete src/bridge, src/commands/bridge, src/commands/btw, orphan files, replace LICENSE.md | done | #34 | `87a40b7` | 35 bridge dir files + 6 orphans deleted; commands.ts bridge conditional require cleaned; LICENSE.md replaced with AGPL-3.0 |
| P1.2.0 extract RemoteMessageContent type to src/types | done | #36 | `666cbed` | C.1-style mini extraction; useDirectConnect + useSSHSession import paths updated; original type stays in teleport/api.ts as duplicate until teleport dir deletion |
| P1.2.1 remove --remote CLI flag option | done | #37 | `6f1618d` | main.tsx --remote [description] option declaration removed; downstream options.remote / remote !== null readers left dead for P1.2.2 |
| P1.2.2.a delete --remote dead block in main.tsx | done | #38 | `55284e9` | main.tsx remoteOption + remote derivation removed; outer OR chain and policy check simplified; ~100-line `if (remote !== null)` block deleted; teleport branch promoted to primary if |
| P1.2.2.b strip useRemoteSession + remoteSessionConfig from REPL and main launchRepl callers | done | #39 | `6e8f697` | REPL.tsx: useRemoteSession hook + isRemoteSession state + 10+ dead branches removed; activeRemote uses sentinel fallback; main.tsx KAIROS attach block no longer passes remoteSessionConfig |
| P1.2.3 remove --teleport CLI flag option | done | #40 | `181efc0` | main.tsx --teleport [session] option declaration removed (mirror P1.2.1); downstream teleport variable / branches left dead for P1.2.4 |
| P1.2.4 strip teleport dead branches in main.tsx and cli/print.ts | done | #41 | `a7b1e3f` | main.tsx teleport variable + outer if + 70-line teleport block deleted; cli/print.ts teleport print handler deleted; prepareApiRequest kept (used by non-teleport callers); fetchSession + 4 teleport.js symbols removed |
| P1.2.5 simplify feature('ULTRAPLAN') sites to constant false | done | #42 | `3c165df` | commands.ts ultraplan const + spread; processUserInput.ts gate; REPL.tsx 4 sites including dialogs; ExitPlanModePermissionRequest.tsx showUltraplan; PromptInput.tsx 3 sites; orphan state vars left for P1.11 |
| P1.2.6 deregister scheduleRemoteAgents and RemoteTriggerTool | done | #43 | `9b5bb2f` | tools.ts RemoteTriggerTool conditional require + spread removed; skills/bundled/index.ts scheduleRemoteAgents registration removed; implementation files dying in P1.2.N |
| P1.2.7 strip RemoteAgentTask dead branches from AgentTool | done | #44 | `2b0e44a` | AgentTool.tsx + UI.tsx; 1 import line + RemoteLaunchedOutput type + isolation 'remote' enum + remote launch block + remote_launched discriminated branch all gone |
| P1.2.8.a strip ultrareview consumers (PromptInput, barrel, registry, keyword util) | done | #45 | `dc0c2ea` | commands.ts: drop `{ ultrareview }` named import + array entry; commands/review.ts: drop ultrareview Command + isUltrareviewEnabled import + DEEPCODE_REMOTE_REVIEW_URL const + named export; PromptInput.tsx: drop 2 imports + ultrareviewTriggers useMemo + rainbow loop + deps array entry + notification useEffect; utils/ultraplan/keyword.ts: drop findUltrareviewTriggerPositions + hasUltrareviewKeyword; 5 files (commands/review/* + services/api/ultrareviewQuota.ts) become orphan for P1.2.8.b; intra-cluster import reviewRemote→ultrareviewQuota left in place (mirrors P1.2.6 deregister pattern, P1.2.8.b cleans both together) |
| P1.2.8.b delete orphan commands/review/* and ultrareviewQuota.ts | done | #46 | `656c5c6` | git rm of 5 files: reviewRemote.ts, ultrareviewCommand.tsx, UltrareviewOverageDialog.tsx, ultrareviewEnabled.ts, services/api/ultrareviewQuota.ts; commands/review/ directory empty and gone; zero source edits |
| P1.2.9 strip restoreRemoteAgentTasks from REPL.tsx | done | #47 | `8610c77` | REPL.tsx: drop line-192 import + two `void restoreRemoteAgentTasks({...})` call sites (resume callback + initialMessages useEffect); -11 net lines; restoreReadFileState/exitRestoredWorktree/restoreWorktreeForResume/adoptResumedSessionFile preserved; RemoteAgentTask def site + 4 other live consumers (tasks.ts, tasks/types.ts, TaskOutputTool, commands/ultraplan.tsx) deferred to P1.2.10/.11 |
| P1.2.10 strip RemoteAgent UI consumers + delete RemoteSession UI files | done | #48 | `9d7457b` | tasks/pillLabel.ts: drop remote_agent case + simplify pillNeedsCta; BackgroundTask.tsx: drop case "remote_agent" + RemoteSessionProgress import; TaskOutputTool.tsx: drop 2 discriminated branches + RemoteAgentTaskState import; BackgroundTasksDialog.tsx: 13 sites (2 imports + ListItem union member + filter + return field + keybinding kill + killRemoteAgentTask fn + detail switch case + runningAgentCount + actions array + toListItem switch case); DELETE RemoteSessionDetailDialog.tsx (903 lines) + RemoteSessionProgress.tsx (242 lines); type system untouched (P1.2.12); ultraplan command untouched (P1.2.11) |
| P1.2.11.a strip ExitPlanModePermissionRequest ultraplan dead branches | done | #49 | `77fc18d` | ExitPlanModePermissionRequest.tsx: 8 sites — drop launchUltraplan import + 'ultraplan' from ResponseValue union + showUltraplan const + showUltraplan from useMemo callback/deps + dead `if (value === 'ultraplan')` block (incl. launchUltraplan call) + showUltraplan from buildPlanApprovalOptions signature + dead `if (showUltraplan)` option-push; commands/ultraplan.tsx now 0 external consumers (P1.2.11.b deletes it) |
| P1.2.11.b delete commands/ultraplan.tsx + AppStateStore residual + 3 reader strips | done | #50 | `98b2f8c` | DELETE commands/ultraplan.tsx (470 LOC); AppStateStore.ts: drop 5 ultraplan fields + comments (lines 459-476); REPL.tsx: drop ultraplanPendingChoice const + useEffect block + 2 type union enum members + simplify isActive comparison (4 sites); cli/print.ts: drop isUltraplanMode merge line; onChangeAppState.ts: drop is_ultraplan_mode read spread + write field (atomic with AppStateStore); SessionExternalMetadata wire type kept (deferred to P1.3/P1.10) |
| P1.2.12 strip RemoteAgentTask from type system + tasks registry | done | #51 | `235a257` | tasks.ts: drop RemoteAgentTask import + array entry; tasks/types.ts: drop RemoteAgentTaskState import + remove from TaskState + BackgroundTaskState unions; Task.ts: drop remote_agent map entry from TASK_ID_PREFIXES; `Task.ts:9` `'remote_agent'` in TaskType union deliberately kept (would break RemoteAgentTask.tsx self-discriminator until P1.2.N deletes the file) |
| P1.2.N.a delete RemoteAgent + ultraplan cluster | done | #52 | `ed25425` | Task.ts: drop `| 'remote_agent'` from TaskType union (atomic with RemoteAgentTask.tsx delete); DELETE 8 tracked files across tasks/RemoteAgentTask/ + utils/ultraplan/ + utils/background/remote/remoteSession.ts + skills/bundled/scheduleRemoteAgents.ts + tools/RemoteTriggerTool/ (3 dirs disappear); `utils/ultraplan/prompt.txt` was absent/untracked at base; bundle delta expected ~0 (P1.2.12 already tree-shook the chain); RemoteAgentMetadata helpers in utils/sessionStorage.ts orphan after this PR, deferred to P1.2.N.b/c |
| P1.2.N.b delete teleport resume picker chain | ready | — | — | depends on P1.2.N.a; DELETE hooks/useTeleportResume.tsx + components/TeleportResumeWrapper.tsx + components/ResumeTask.tsx + components/TeleportProgress.tsx; MODIFY dialogLaunchers.tsx to drop launchTeleportResumeWrapper (0 caller verified); also potentially clean utils/sessionStorage.ts RemoteAgentMetadata helpers if orphan |
| P1.2.N.c deregister + delete /teleport and /remote-env slash commands | ready | — | — | depends on P1.2.N.b; MODIFY commands.ts to drop teleport + remoteEnv imports + array entries; DELETE commands/teleport/index.js + commands/remote-env/ dir + components/RemoteEnvironmentDialog.tsx; finishes P1.2 source-side cleanup |
| P1.2.Z chore: refresh prebuilt dist bundle | ready | — | — | after P1.2.N: run `bun run build:full-cli` and commit fresh `dist/deepcode-full.mjs` + `cli.js` once; absorbs all source-vs-bundle drift accumulated across the P1.2 series (Codex review P1 surfaced in PR #50) |
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
| F1.3 adapter test coverage hardening | done | #35 | `1a81f5e` | adapter-*.test.mjs files covering resolvePathPatternForSandbox, resolveSandboxFilesystemPath, shouldAllowManagedSandboxDomainsOnly, convertToSandboxRuntimeConfig, addToExcludedCommands, SandboxManager lifecycle |

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
