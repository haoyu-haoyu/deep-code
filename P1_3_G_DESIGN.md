# P1.3.G Design - Teleport Infrastructure Mass Delete

## Phase A - Architecture Findings

### A1. Scan scope and base

Base scanned:

- `main` at `e71f710a8c1847113793821a7e4ac1600be943c6`
- This is after P1.3.F.b.Z.cite, so all `services/api/*` SDK wrappers are already gone and the post-F bundle refresh is cited.

The P1.3.G objective is to remove the remaining Claude.ai teleport / remote-session infrastructure that is now outside the Pure-DeepSeek runtime path.

Initial target files from the execution log:

- `packages/deep-code/src/utils/teleport.tsx`
- `packages/deep-code/src/utils/teleport/api.ts`
- `packages/deep-code/src/utils/teleport/environmentSelection.ts`
- `packages/deep-code/src/utils/teleport/environments.ts`
- `packages/deep-code/src/utils/teleport/gitBundle.ts`
- `packages/deep-code/src/utils/background/remote/preconditions.ts`

Actual line counts:

| File | LOC | Role |
|---|---:|---|
| `utils/teleport.tsx` | 1222 | Main teleport-to-remote and teleport-resume flow; repository validation, git bundle upload, session creation, polling, archive. |
| `utils/teleport/api.ts` | 464 | OAuth-backed sessions API helpers, event POST, title update, auth headers, schemas and remote message type. |
| `utils/teleport/environmentSelection.ts` | 77 | Environment selection helper around `fetchEnvironments()`. |
| `utils/teleport/environments.ts` | 118 | CCR environment list/create helpers and environment types. |
| `utils/teleport/gitBundle.ts` | 275 | Git bundle creation and upload to Claude.ai file API. |
| `utils/background/remote/preconditions.ts` | 226 | Claude.ai login, git clean, remote env, GitHub app/token checks. |
| Initial target total | 2382 | These 6 files are the hard P1.3.G deletion core. |

Directory completeness scan:

- `utils/teleport/` contains exactly `api.ts`, `environmentSelection.ts`, `environments.ts`, and `gitBundle.ts`.
- `utils/background/remote/` contains only `preconditions.ts`.
- `utils/teleport.tsx` is a sibling file, not part of the `utils/teleport/` directory.

### A2. Export inventory for core target files

`utils/teleport.tsx` exports:

- `TeleportResult`
- `TeleportProgressStep`
- `TeleportProgressCallback`
- `validateGitState()`
- `processMessagesForTeleportResume()`
- `checkOutTeleportedSessionBranch()`
- `RepoValidationResult`
- `validateSessionRepository()`
- `teleportResumeCodeSession()`
- `teleportToRemoteWithErrorHandling()`
- `teleportFromSessionsAPI()`
- `PollRemoteSessionResponse`
- `pollRemoteSessionEvents()`
- `teleportToRemote()`
- `archiveRemoteSession()`

`utils/teleport/api.ts` exports:

- `CCR_BYOC_BETA`
- `isTransientNetworkError()`
- `axiosGetWithRetry()`
- `SessionStatus`
- `GitSource`
- `KnowledgeBaseSource`
- `SessionContextSource`
- `OutcomeGitInfo`
- `GitRepositoryOutcome`
- `Outcome`
- `SessionContext`
- `SessionResource`
- `ListSessionsResponse`
- `CodeSessionSchema`
- `CodeSession`
- `prepareApiRequest()`
- `fetchCodeSessionsFromSessionsAPI()`
- `getOAuthHeaders()`
- `fetchSession()`
- `getBranchFromSession()`
- `RemoteMessageContent`
- `sendEventToRemoteSession()`
- `updateSessionTitle()`

`utils/teleport/environments.ts` exports:

- `EnvironmentKind`
- `EnvironmentState`
- `EnvironmentResource`
- `EnvironmentListResponse`
- `fetchEnvironments()`
- `createDefaultCloudEnvironment()`

`utils/teleport/environmentSelection.ts` exports:

- `EnvironmentSelectionInfo`
- `getEnvironmentSelectionInfo()`

`utils/teleport/gitBundle.ts` exports:

- `BundleUploadResult`
- `createAndUploadGitBundle()`

`utils/background/remote/preconditions.ts` exports:

- `checkNeedsClaudeAiLogin()`
- `checkIsGitClean()`
- `checkHasRemoteEnvironment()`
- `checkIsInGitRepo()`
- `checkHasGitRemote()`
- `checkGithubAppInstalled()`
- `checkGithubTokenSynced()`
- `checkRepoForRemoteAccess()`

### A3. Direct external import audit

The audit found no external direct imports of `utils/teleport.tsx`.

This matters because the largest single file in the core set appears already isolated after P1.3.F:

- All references to its exported functions are internal to `utils/teleport.tsx`.
- Its imports from `utils/teleport/*` and `utils/background/remote/preconditions.ts` keep the dependency chain alive only because the file itself remains.
- A first P1.3.G source PR can likely delete `utils/teleport.tsx` alone without touching callers.

External imports of `utils/teleport/api.ts` remain in:

- `assistant/sessionHistory.ts`
- `main.tsx`
- `server/directConnectManager.ts` (type-only `RemoteMessageContent`)
- `screens/REPL.tsx` (type-only `RemoteMessageContent`)
- `hooks/useRemoteSession.ts`
- `commands/remote-setup/api.ts`
- `remote/RemoteSessionManager.ts`

External imports of `utils/teleport/environments.ts` remain in:

- `commands/remote-setup/api.ts`
- `utils/filePersistence/outputsScanner.ts` (type-only `EnvironmentKind`)

External imports of `utils/background/remote/preconditions.ts` remain in:

- `components/TeleportError.tsx`

Additional remote-area files discovered:

- `commands/remote-setup/index.ts`
- `commands/remote-setup/remote-setup.tsx`
- `components/TeleportError.tsx`
- `hooks/useAssistantHistory.ts`
- `hooks/useDirectConnect.ts`
- `remote/RemoteSessionManager.ts`
- `remote/SessionsWebSocket.ts`
- `remote/remotePermissionBridge.ts`
- `remote/sdkMessageAdapter.ts`
- `types/remoteMessage.ts`
- `utils/filePersistence/outputsScanner.ts`

### A4. Caller matrix

| Caller | Teleport import(s) | Main use | Gate status | Proposed handling |
|---|---|---|---|---|
| `assistant/sessionHistory.ts` | `getOAuthHeaders`, `prepareApiRequest` from `utils/teleport/api.ts` | OAuth auth context for `claude assistant` history pagination. | Used by `hooks/useAssistantHistory.ts`; assistant path is gated by `feature('KAIROS')` in `main.tsx`. | Delete with assistant-history viewer cascade unless KAIROS is retained in P1.3.H. |
| `main.tsx` | `prepareApiRequest` from `utils/teleport/api.ts` | Auth check for `claude assistant [sessionId]` viewer attach. | `feature('KAIROS')` branch around assistant attach; direct-connect/ssh paths are separate. | Remove assistant viewer branch or stub auth check in a precondition PR; do not touch direct-connect/ssh branches in the same patch. |
| `server/directConnectManager.ts` | Type-only `RemoteMessageContent` from `utils/teleport/api.ts`; type-only `RemotePermissionResponse` from `remote/RemoteSessionManager.ts` | Direct-connect WebSocket manager; not Claude.ai teleport. | `feature('DIRECT_CONNECT')` in `main.tsx`. | Switch type imports to `types/remoteMessage.ts` and a neutral direct-connect permission type. Keep direct-connect behavior. |
| `screens/REPL.tsx` | Type-only `RemoteMessageContent` from `utils/teleport/api.ts` | Remote/direct-connect input content typing. | REPL handles direct-connect, ssh, and general remote UI states. | Switch type import to `types/remoteMessage.ts`; no logic change. |
| `hooks/useRemoteSession.ts` | `RemoteSessionManager`, `RemoteSessionConfig`, `RemotePermissionResponse`, `RemoteMessageContent`, `updateSessionTitle` | Claude.ai CCR remote session hook. | No external import of `useRemoteSession()` found. | Delete whole file if no hidden consumer appears in build; otherwise leave a throwing stub before delete. |
| `commands/remote-setup/api.ts` | `getOAuthHeaders`, `prepareApiRequest`, `fetchEnvironments` | `/web-setup` GitHub token import and default environment creation. | Command loaded only behind `feature('CCR_REMOTE_SETUP')`, command `availability: ['claude-ai']`, growthbook `tengu_cobalt_lantern`, and policy `allow_remote_sessions`. | Delete with `commands/remote-setup/{index,remote-setup,api}.ts(x)` and remove command loader from `commands.ts`. |
| `remote/RemoteSessionManager.ts` | `RemoteMessageContent`, `sendEventToRemoteSession` | Claude.ai remote session WebSocket + event POST manager. | Only external users found: type-only direct-connect hooks, `useRemoteSession`, `useAssistantHistory`. | Split shared type(s) for direct-connect/ssh first, then delete class with `useRemoteSession`. |

### A5. Hidden dependency findings

`components/TeleportError.tsx` is part of the same deletion cascade.

- It imports `checkIsGitClean` and `checkNeedsClaudeAiLogin` from `utils/background/remote/preconditions.ts`.
- It is imported only by `utils/teleport.tsx`.
- If `utils/teleport.tsx` is deleted first, `components/TeleportError.tsx` becomes orphaned and can be deleted in the same or next PR.

`commands/remote-setup/*` is a Claude.ai remote setup surface.

- `commands/remote-setup/index.ts` defines the `/web-setup` local-jsx command.
- The command is loaded in `commands.ts` only when `feature('CCR_REMOTE_SETUP')`.
- It is also guarded by `availability: ['claude-ai']`, growthbook `tengu_cobalt_lantern`, and `allow_remote_sessions`.
- It calls OAuth-backed endpoints through `commands/remote-setup/api.ts`.
- It should be removed in P1.3.G unless the user wants to retain a web setup command for a future Deep Code web product.

`utils/filePersistence/outputsScanner.ts` is not teleport-only.

- It imports only the `EnvironmentKind` type from `utils/teleport/environments.ts`.
- It implements file-persistence output scanning and is used by `utils/plans.ts`.
- Handling should be a type-localization edit, not deletion.
- Candidate fix: replace the import with a local union type `type EnvironmentKind = 'anthropic_cloud' | 'byoc' | 'bridge'`, or move the type to a neutral module if more callers appear.

`remote/remotePermissionBridge.ts` and `remote/sdkMessageAdapter.ts` are shared by direct-connect and ssh.

- `useRemoteSession.ts` uses both.
- `useDirectConnect.ts` uses both.
- `useSSHSession.ts` also uses both.
- They are not safe to delete as part of a Claude.ai teleport-only cleanup.

`remote/SessionsWebSocket.ts` appears tied to Claude.ai `RemoteSessionManager`.

- It is imported by `remote/RemoteSessionManager.ts`.
- No other external users were found.
- It can likely be deleted with `RemoteSessionManager.ts`, after direct-connect/ssh types are disentangled.

`types/remoteMessage.ts` already exists.

- It contains a neutral `RemoteMessageContent` type with a comment saying it moved out of `utils/teleport/api.ts`.
- Direct-connect and ssh hooks already use this neutral type.
- Remaining type imports from `utils/teleport/api.ts` in `server/directConnectManager.ts` and `screens/REPL.tsx` should switch to this file.

## Phase B - Deletion and Migration Strategy

### B1. File categories

Safe direct delete candidates:

- `utils/teleport.tsx`
- `components/TeleportError.tsx`

Deletion after caller cleanup:

- `utils/teleport/api.ts`
- `utils/teleport/environmentSelection.ts`
- `utils/teleport/environments.ts`
- `utils/teleport/gitBundle.ts`
- `utils/background/remote/preconditions.ts`
- `commands/remote-setup/api.ts`
- `commands/remote-setup/index.ts`
- `commands/remote-setup/remote-setup.tsx`
- `hooks/useRemoteSession.ts`
- `remote/RemoteSessionManager.ts`
- `remote/SessionsWebSocket.ts`
- `assistant/sessionHistory.ts`
- `hooks/useAssistantHistory.ts`

Do not delete in P1.3.G without a separate direct-connect/ssh decision:

- `hooks/useDirectConnect.ts`
- `hooks/useSSHSession.ts`
- `remote/remotePermissionBridge.ts`
- `remote/sdkMessageAdapter.ts`
- `types/remoteMessage.ts`
- `server/directConnectManager.ts`
- `screens/REPL.tsx`

Minor caller edits expected:

- `screens/REPL.tsx`: type import only, `utils/teleport/api.ts` to `types/remoteMessage.ts`.
- `server/directConnectManager.ts`: type import only, `utils/teleport/api.ts` to `types/remoteMessage.ts`; possibly replace `RemotePermissionResponse` import from `remote/RemoteSessionManager.ts`.
- `utils/filePersistence/outputsScanner.ts`: localize `EnvironmentKind` type.
- `commands.ts`: remove `CCR_REMOTE_SETUP` dynamic loader and `webCmd` inclusion.
- `main.tsx`: remove `prepareApiRequest` import and assistant viewer branch, or isolate KAIROS assistant attach from Claude.ai session APIs.

### B2. Candidate deletion totals

Core P1.3.G deletion target:

- 6 files
- 2382 LOC

Strong cascade candidate set:

| File | LOC | Reason |
|---|---:|---|
| `components/TeleportError.tsx` | 188 | Only used by `utils/teleport.tsx`; imports remote preconditions. |
| `commands/remote-setup/api.ts` | 182 | Claude.ai OAuth and environment setup API. |
| `commands/remote-setup/index.ts` | 20 | `/web-setup` command registration, CCR remote setup feature gate. |
| `commands/remote-setup/remote-setup.tsx` | 186 | UI wrapper around remote setup API. |
| `hooks/useRemoteSession.ts` | 605 | Claude.ai CCR remote session hook; no external hook call found. |
| `remote/RemoteSessionManager.ts` | 343 | Claude.ai remote session manager; direct-connect currently imports only types from it. |
| `remote/SessionsWebSocket.ts` | 404 | Used by `RemoteSessionManager` only in the scan. |
| `assistant/sessionHistory.ts` | 87 | Claude.ai assistant history API pagination. |
| `hooks/useAssistantHistory.ts` | 250 | No external hook call found; depends on assistant history and remote config type. |

Strong cascade LOC:

- 2265 LOC

Core plus strong cascade:

- 15 files
- 4647 LOC

This is larger than the initial "about 2500 LOC" estimate because the scan found the CCR setup command and assistant/remote-session viewer cascade.

### B3. Non-teleport remote code to preserve

Direct-connect and ssh remote support are not the same as Claude.ai teleport.

Preserve unless separately scoped:

- `server/createDirectConnectSession.ts`
- `server/directConnectManager.ts`
- `hooks/useDirectConnect.ts`
- `hooks/useSSHSession.ts`
- `remote/remotePermissionBridge.ts`
- `remote/sdkMessageAdapter.ts`
- `types/remoteMessage.ts`

Rationale:

- Direct-connect is gated by `feature('DIRECT_CONNECT')` and uses a Deep Code server URL flow.
- SSH remote is gated by `feature('SSH_REMOTE')` and tunnels auth over SSH.
- Both share message conversion and permission-bridge helpers.
- Deleting shared remote helpers with Claude.ai teleport would cascade into non-Claude.ai features.

## Phase C - Proposed Sub-PR Split

### C1. Recommended path

Use a three-step source sequence plus docs cites:

1. `P1.3.G.a` - Isolate neutral shared types and remove dead `utils/teleport.tsx`.
2. `P1.3.G.b` - Delete CCR setup, assistant viewer history, remote-session manager/hook, and preconditions.
3. `P1.3.G.Z` - Bundle refresh after source deletions if dist drift is significant.

Docs cite PRs should follow the existing phase pattern.

### C2. P1.3.G.a - precondition and first delete

Scope:

- Switch type-only imports:
  - `screens/REPL.tsx` from `utils/teleport/api.ts` to `types/remoteMessage.ts`.
  - `server/directConnectManager.ts` from `utils/teleport/api.ts` to `types/remoteMessage.ts`.
- Localize `EnvironmentKind` in `utils/filePersistence/outputsScanner.ts`.
- Remove any `RemotePermissionResponse` dependency from direct-connect by moving or duplicating a tiny neutral type.
- Delete `utils/teleport.tsx`.
- Delete `components/TeleportError.tsx` if no references remain after `utils/teleport.tsx` deletion.

Risk:

- Low to medium.
- Type-only import changes should be mechanical.
- `utils/teleport.tsx` direct external use is zero in the scan.

Validation:

- `rg -n "utils/teleport\\.tsx|from .*utils/teleport/api|from .*utils/teleport/environments|background/remote/preconditions" packages/deep-code/src`.
- `bun run build:full-cli`.
- `bun test`.

### C3. P1.3.G.b - CCR remote/session mass delete

Scope:

- Delete:
  - `utils/teleport/api.ts`
  - `utils/teleport/environmentSelection.ts`
  - `utils/teleport/environments.ts`
  - `utils/teleport/gitBundle.ts`
  - `utils/background/remote/preconditions.ts`
  - `commands/remote-setup/api.ts`
  - `commands/remote-setup/index.ts`
  - `commands/remote-setup/remote-setup.tsx`
  - `hooks/useRemoteSession.ts`
  - `remote/RemoteSessionManager.ts`
  - `remote/SessionsWebSocket.ts`
  - `assistant/sessionHistory.ts`
  - `hooks/useAssistantHistory.ts`
- Edit:
  - `commands.ts` to remove the `CCR_REMOTE_SETUP` dynamic import and `webCmd` inclusion.
  - `main.tsx` to remove `prepareApiRequest` import and the KAIROS assistant attach path that depends on Claude.ai sessions API.

Risk:

- Medium to high due to `main.tsx` and `commands.ts` edits.
- The deleted files are mostly feature-gated, but the import graph must compile after dynamic import removal.
- Direct-connect and ssh must still build and test.

Validation:

- `rg -n "utils/teleport|background/remote|commands/remote-setup|RemoteSessionManager|useRemoteSession|useAssistantHistory|sessionHistory" packages/deep-code/src`.
- Confirm remaining `remote/remotePermissionBridge.ts` and `remote/sdkMessageAdapter.ts` are still imported by direct-connect or ssh only.
- `bun run build:full-cli`.
- `bun test`.

### C4. Alternative split

If `main.tsx` assistant attach removal proves noisy, split `P1.3.G.b` further:

- `P1.3.G.b1` - Remove `/web-setup` and teleport utilities.
- `P1.3.G.b2` - Remove assistant viewer history and remote-session manager/hook.
- `P1.3.G.b3` - Clean `main.tsx` KAIROS assistant attach branch.

This would reduce per-PR blast radius but adds cite overhead.

## Phase D - Risk Assessment

### D1. Compile risks

Highest compile-risk files:

- `main.tsx`
- `commands.ts`
- `screens/REPL.tsx`
- `server/directConnectManager.ts`

Why:

- `main.tsx` has multiple feature-gated branches and dynamic imports.
- `commands.ts` conditionally requires command modules.
- `screens/REPL.tsx` is large and imports `RemoteMessageContent` only as a type, but type-only changes still affect TS build.
- `server/directConnectManager.ts` imports `RemotePermissionResponse` from a delete candidate.

### D2. Runtime risks

Low-risk deletions:

- `utils/teleport.tsx`, because no external imports were found.
- `components/TeleportError.tsx`, because it is only imported by `utils/teleport.tsx`.
- `utils/teleport/gitBundle.ts`, after `utils/teleport.tsx` is gone.
- `utils/teleport/environmentSelection.ts`, if no external import appears in a later audit.

Medium-risk deletions:

- `commands/remote-setup/*`, because command loading must be removed from `commands.ts`.
- `utils/teleport/api.ts`, because several callers still import helpers or types.
- `utils/teleport/environments.ts`, because one non-teleport file uses its type.

High-risk or decision-gated deletions:

- `main.tsx` assistant attach branch.
- `remote/RemoteSessionManager.ts` and `SessionsWebSocket.ts`, because direct-connect currently imports a type from the manager.
- `hooks/useRemoteSession.ts`, because it is large and remote-session specific, but currently has no external caller in the scan.

### D3. Gate status

Observed gates:

- `/web-setup` is behind `feature('CCR_REMOTE_SETUP')`, `availability: ['claude-ai']`, growthbook `tengu_cobalt_lantern`, and policy `allow_remote_sessions`.
- `main.tsx` assistant viewer attach is behind `feature('KAIROS')`.
- Direct-connect is behind `feature('DIRECT_CONNECT')`.
- SSH remote is behind `feature('SSH_REMOTE')`.
- `utils/background/remote/preconditions.ts` checks growthbook `tengu_cobalt_lantern` for remote access in addition to OAuth/GitHub state.

DeepSeek build implication:

- Claude.ai teleport and web setup are not needed for Pure-DeepSeek.
- Direct-connect and SSH remote are not automatically Claude.ai teleport and should be preserved unless a later phase explicitly removes them.

## Phase E - Key Decisions

### E1. Should `utils/background/remote/` be deleted entirely?

Current answer: yes, if P1.3.G removes `components/TeleportError.tsx` and `utils/teleport.tsx`.

Reason:

- The directory contains only `preconditions.ts`.
- External import is `components/TeleportError.tsx`.
- `utils/teleport.tsx` is the only importer of `components/TeleportError.tsx`.

Decision needed:

- Confirm no future non-teleport feature needs these GitHub/app/token preconditions.

### E2. Is `hooks/useRemoteSession.ts` teleport-only?

Current scan result: yes enough to delete, but with a build gate.

Evidence:

- No external `useRemoteSession(` call found.
- It imports Claude.ai session manager and `updateSessionTitle()` from `utils/teleport/api.ts`.
- Its comments and behavior are CCR remote-session specific.

Decision needed:

- Delete in P1.3.G.b unless a fresh grep before deletion finds a new caller.

### E3. Should `commands/remote-setup/` be deleted?

Current recommendation: yes.

Evidence:

- It is the `/web-setup` command for Claude.ai web + GitHub token import.
- It calls `prepareApiRequest()`, `getOAuthHeaders()`, and `fetchEnvironments()`.
- It opens `${CLAUDE_AI_ORIGIN}/code` onboarding.
- It is behind `CCR_REMOTE_SETUP` and `availability: ['claude-ai']`.

Decision needed:

- Confirm there is no Deep Code web replacement planned to reuse `/web-setup`.

### E4. Should the KAIROS assistant viewer branch be removed now?

Current recommendation: yes if P1.3.G is intended to eliminate Claude.ai session APIs, but isolate carefully.

Evidence:

- `main.tsx` assistant attach calls `prepareApiRequest()` only to authenticate to Claude.ai session APIs.
- `hooks/useAssistantHistory.ts` and `assistant/sessionHistory.ts` are tied to remote assistant history.

Risk:

- KAIROS assistant mode may include non-teleport local teammate flows. Do not remove all KAIROS code.
- Remove only the `claude assistant [sessionId]` viewer attach path that depends on Claude.ai sessions API.

### E5. Should `remote/` be deleted entirely?

Current recommendation: no.

Evidence:

- `remote/remotePermissionBridge.ts` and `remote/sdkMessageAdapter.ts` are used by `useDirectConnect.ts` and `useSSHSession.ts`.
- Direct-connect and SSH are separate remote execution surfaces.

Allowed deletion subset:

- `remote/RemoteSessionManager.ts`
- `remote/SessionsWebSocket.ts`

Only after:

- `server/directConnectManager.ts`, `hooks/useDirectConnect.ts`, and `hooks/useAssistantHistory.ts` no longer import types from `RemoteSessionManager.ts`.

## Proposed Final Audits Before Each Source PR

Before `P1.3.G.a`:

- `rg -n "teleportToRemote|teleportResume|pollRemoteSessionEvents|archiveRemoteSession|utils/teleport\\.tsx" packages/deep-code/src`
- `rg -n "from .*utils/teleport/api|from .*utils/teleport/environments|background/remote/preconditions" packages/deep-code/src`

Before `P1.3.G.b`:

- `rg -n "commands/remote-setup|web-setup|CCR_REMOTE_SETUP" packages/deep-code/src`
- `rg -n "RemoteSessionManager|useRemoteSession|useAssistantHistory|sessionHistory|SessionsWebSocket" packages/deep-code/src`
- `rg -n "from .*remote/remotePermissionBridge|from .*remote/sdkMessageAdapter" packages/deep-code/src`

Expected end state after P1.3.G:

- No `packages/deep-code/src/utils/teleport.tsx`.
- No `packages/deep-code/src/utils/teleport/` directory.
- No `packages/deep-code/src/utils/background/remote/` directory.
- No `commands/remote-setup/` directory.
- No Claude.ai session API callers.
- Direct-connect and SSH still compile if retained.
