# DeepCode pure-DeepSeek migration — execution log

Last updated: 2026-05-14 (P1.3.B.a3)
Source plans: PURE_DEEPSEEK_PLAN.md, SANDBOX_FORTRESS_PLAN.md

## Quick status

| Track | Phase | Last completed | Next ready | Blocked? |
|---|---|---|---|---|
| A: Pure-DeepSeek | 2 | P1.3.B.a3 strip Chrome config + onboarding + state chain | P1.3.B.b mass delete Chrome cluster files | no |
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
| P1.2.N.b delete teleport resume picker chain + sessionStorage RemoteAgentMetadata cluster | done | #53 | `6e58b34` | DELETE hooks/useTeleportResume.tsx + components/TeleportResumeWrapper.tsx + components/ResumeTask.tsx + components/TeleportProgress.tsx; MODIFY dialogLaunchers.tsx (drop launchTeleportResumeWrapper + TeleportRemoteResponse import; 0 caller verified); MODIFY utils/sessionStorage.ts (drop RemoteAgentMetadata type + 4 export functions + private helper + orphan `unlink` import — ~95 LOC; entire cluster was RemoteAgentTask-only consumer, orphan after P1.2.N.a); `utils/teleport.tsx` exports `teleportResumeCodeSession`/`checkOutTeleportedSessionBranch`/`processMessagesForTeleportResume`/`TeleportProgressStep`/`TeleportResult` may become orphan but kept (P1.3 territory) |
| P1.2.N.c deregister + delete /teleport and /remote-env slash commands | done | #54 | `d5f8408` | commands.ts: drop teleport + remoteEnv imports (lines 45 + 167) + array entries (lines 233 + 292); DELETE commands/teleport/index.js (1-line stub `{ isEnabled: () => false, isHidden: true, name: 'stub' }`); DELETE commands/remote-env/index.ts + remote-env.tsx (commands/remote-env/ dir gone); DELETE components/RemoteEnvironmentDialog.tsx; orphan exports left for P1.3 (utils/teleport/environmentSelection.ts now 0 consumer; utils/teleport.tsx `teleportResumeCodeSession`/`checkOutTeleportedSessionBranch`/`processMessagesForTeleportResume`/`TeleportProgressStep`/`TeleportResult` all 0 external consumer but file kept due to 9 non-teleport Anthropic service consumers); P1.2 source-side cleanup COMPLETE |
| P1.2.Z chore: refresh prebuilt dist bundle | done | #55 | `be8e33b` | `bun run build:full-cli` rebuilds dist/deepcode-full.mjs from current source (post-P1.2.N.c state); commits the remaining -2537 line generated-bundle delta from the current committed baseline (committed dist had already been refreshed through P1.2.10); absorbs Codex review P1/P2 from PR #50/#54 about committed prebuilt bundle drift; idempotency verified (second build produced unchanged diff); P1.2 PHASE 100% COMPLETE, next phase P1.3 |
| P1.3.A delete /stickers and /install-slack-app slash commands | done | #56 | `803fea4` | DELETE commands/{stickers,install-slack-app}/; commands.ts: drop 2 imports + array entries; services/tips/tipRegistry.ts: drop stale /install-slack-app spinner tip; /upgrade + /feedback + /install-github-app + /extra-usage all deferred to follow-up sub-PRs (P1.3.A.2: /install-github-app 14-file UI flow; P1.3.A.3: claude.ai rate-limit UX cluster incl. /upgrade + /extra-usage + rate-limit-options + RateLimitMessage; P1.3.A.4: /feedback + redactSensitiveInfo extraction) |
| P1.3.A.2 delete /install-github-app multi-step UI flow | done | #58 | `a92857c` | DELETE commands/install-github-app/ entire dir (14 files: 11 step UIs + setupGitHubActions + install-github-app.tsx + index.ts) + components/WorkflowMultiselectDialog.tsx (orphan after cluster) + constants/github-app.ts (orphan; only install-github-app consumers); MODIFY commands.ts (drop installGitHubApp import + array entry); MODIFY services/tips/tipRegistry.ts (drop install-github-app spinner tip per P1.3 precedent); MODIFY test/deepcode-package.test.mjs (drop installGitHubAppCommandSource fixture per P1.3 precedent); OAuthService caller count reduced by 1 but service preserved for P1.3.E |
| P1.3.A.3.a delete RateLimitMessage UI + strip REPL handler | done | #59 | `08dfa83` | DELETE components/messages/RateLimitMessage.tsx; MODIFY AssistantTextMessage.tsx (drop RateLimitMessage import + isRateLimitErrorMessage import + conditional render block; preserve dead `onOpenRateLimitOptions?` prop signature for P1.3.H sweep); MODIFY REPL.tsx (drop handleOpenRateLimitOptions useCallback + 2 Messages JSX prop sites; keep onSubmitRef because pending-input recovery still consumes it); user-visible: none (claude.ai rate-limit UI never triggered in DeepCode); services/rateLimitMessages.ts kept (still consumed by services/claudeAiLimits.ts, P1.3.F territory) |
| P1.3.A.3.b delete /upgrade + /extra-usage + /rate-limit-options commands | done | #60 | `9f33907` | DELETE commands/{upgrade,extra-usage,rate-limit-options}/ (8 files, 3 dirs gone); MODIFY commands.ts (drop 4 imports + 4 array entries: upgrade, extraUsage, extraUsageNonInteractive, rateLimitOptions); MODIFY components/Settings/Usage.tsx (drop extraUsageCommand import + simplify `!extra_usage.is_enabled` block to direct return null, leaving $[0] cache slot hole for bun:bundle regenerate); MODIFY tipRegistry/test fixture per P1.3 precedent (if applicable); /usage command + Settings/Usage tab full deletion deferred to P1.3.A.3.c |
| P1.3.A.3.c delete Settings/Usage tab + /usage command | done | #61 | `3768c2f` | DELETE components/Settings/Usage.tsx (claude.ai usage UI no longer meaningful in DeepCode) + commands/usage/{index.ts,usage.tsx} (2 files, dir gone); MODIFY components/Settings/Settings.tsx (drop Usage import + 'Usage' from defaultTab union + t6 cache block + Tab JSX + tabs array entry); MODIFY commands.ts (drop usage import line 51 + 2 array entries lines 294 + 606); MODIFY tipRegistry/test per P1.3 precedent (if applicable); usageReport (lazy /insights shim, unrelated) preserved |
| P1.3.A.3.d delete OverageCreditUpsell + LogoV2 surgery | ready | — | — | deferred candidate for P1.3.H or independent sub-PR; OverageCreditUpsell.tsx deeply integrated with LogoV2.tsx, CondensedLogo.tsx, tipRegistry.ts — requires Welcome screen / LogoV2 refactor |
| P1.3.A.4 extract redactSensitiveInfo + delete /feedback | done | #57 | `66a5ef5` | NEW utils/redact.ts (extracted redactSensitiveInfo function from Feedback.tsx); MODIFY components/FeedbackSurvey/submitTranscriptShare.ts (line 16 import path); DELETE commands/feedback/{index.ts,feedback.tsx} + components/Feedback.tsx (591 LOC); MODIFY commands.ts (drop feedback import + 2 array entries); MODIFY FeedbackSurvey.tsx + REPL.tsx to remove the now-broken optional /feedback follow-up while preserving survey/transcript sharing; MODIFY services/tips/tipRegistry.ts + test/deepcode-package.test.mjs to drop stale /feedback references; MODIFY claudeCodeGuideAgent.ts + UserToolErrorMessage.tsx to replace stale /feedback guidance with MACRO.ISSUES_EXPLAINER |
| P1.3.B.a1 strip Chrome from MCP/API/attachments | done | #62 | `4eb2c09` | MODIFY services/mcp/config.ts (drop isClaudeInChromeMCPServer import + reserved-name validation block at lines 636-639); MODIFY services/mcp/client.ts (drop import + lazy claudeInChromeToolRendering + Chrome MCP in-process else-if branch + tool rendering spread); MODIFY services/api/claude.ts (drop 2 imports + hasChromeTools + injectChromeHere + CHROME_TOOL_SEARCH_INSTRUCTIONS spread); MODIFY utils/attachments.ts (drop 2 imports + clientSide.push Chrome block); utils/claudeInChrome/ + commands/chrome/ + 2 hooks + ClaudeInChromeOnboarding + skills/bundled/claudeInChrome.ts still have consumers (P1.3.B.a2/.a3 strip remaining, .b mass delete) |
| P1.3.B.a2 strip Chrome from boot/REPL/commands/CLI | done | #63 | `7f38426` | MODIFY main.tsx (drop 3 claudeInChrome imports + remove --chrome/--no-chrome options + drop Chrome MCP reserved-name branch + Chrome setup decision block; showSetupScreens now receives false for claudeInChrome); MODIFY screens/REPL.tsx (drop useChromeExtensionNotification + usePromptsFromClaudeInChrome imports/call sites); MODIFY commands.ts (drop chrome import + legacy command array entry); MODIFY skills/bundled/index.ts (drop registerClaudeInChromeSkill + shouldAutoEnableClaudeInChrome); MODIFY entrypoints/cli.tsx (drop --claude-in-chrome-mcp + --chrome-native-host fast paths); setChromeFlagOverride now unreferenced by main startup intentionally, cleaned in P1.3.B.a3; bundle delta -4272 lines vs rebuilt 4eb2c09 bundle |
| P1.3.B.a3 strip Chrome config + onboarding + state chain | done | #XX | `<7-char-merge-SHA>` | MODIFY interactiveHelpers.tsx (drop claudeInChrome parameter from showSetupScreens + Chrome onboarding trigger block); MODIFY main.tsx (drop now-removed false argument at showSetupScreens call site); MODIFY components/Settings/Config.tsx (drop claudeInChromeDefaultEnabled settings UI entry); MODIFY bootstrap/state.ts (drop chromeFlagOverride STATE field + getter/setter); MODIFY utils/swarm/spawnUtils.ts + tools/shared/spawnMultiAgent.ts (drop getChromeFlagOverride import + --chrome/--no-chrome propagation blocks); utils/config.ts Chrome field declarations + fieldsToReset entries intentionally survive for deferred P1.3.B.b consumers; source delta -55 LOC, rebuilt bundle delta -3181 lines vs rebuilt 7f38426 bundle |
| P1.3.B.b mass delete Chrome cluster files | ready | — | — | depends on P1.3.B.a3; DELETE utils/claudeInChrome/ (7 files: chromeNativeHost, common, mcpServer, prompt, setup, setupPortable, toolRendering) + commands/chrome/ (2 files) + components/ClaudeInChromeOnboarding.tsx + hooks/useChromeExtensionNotification.tsx + hooks/usePromptsFromClaudeInChrome.tsx + skills/bundled/claudeInChrome.ts; ~2900 LOC nuked |
| P1.3.C Desktop handoff + deep-link delete | ready | — | — | depends on P1.3.B; delete DesktopHandoff + utils/desktopDeepLink + utils/deepLink/banner (3 files) |
| P1.3.D Login/Logout/Profile UX rewrite to DeepSeek API key | ready | — | — | depends on P1.3.C; per docs/deepseek-auth.md: new ~/.deepcode/config.json reader/writer + paste TUI + rewritten /login + new /profile slash command + delete ConsoleOAuthFlow.tsx |
| P1.3.E OAuth core dismantle | ready | — | — | depends on P1.3.D; utils/auth.ts (2002 LOC) rewrite + services/oauth/ delete (5 files, ~1050 LOC) + all getClaudeAIOAuthTokens callers updated |
| P1.3.F Anthropic API services strip | ready | — | — | depends on P1.3.E; ~15-20 files in services/api/* + services/claudeAiLimits + services/mcp/claudeai + assistant/sessionHistory + commands/remote-setup |
| P1.3.G teleport.tsx + utils/teleport/* + background/remote/preconditions final mass delete | ready | — | — | depends on P1.3.F; all OAuth-protected consumers gone, ~2500 LOC teleport infrastructure deletable |
| P1.3.H UI/utils residual cleanup | ready | — | — | depends on P1.3.G; utils/{billing,extraUsage,fastMode,effort,betas}.ts, components/LogoV2/ChannelsNotice, residual claude.ai-specific code |
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
