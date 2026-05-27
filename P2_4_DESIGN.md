# P2.4 Design - Workspace Rollback Scan + Path Recommendation

## Executive summary

- P2.4 implements workspace rollback through side-git snapshots.
- The core invariant is explicit: never touch the user's `.git`.
- The snapshot store should live under `~/.deepcode/snapshots/<workspace-hash>/.git`.
- The feature should snapshot before and after each user turn.
- `/restore` should let the user inspect and restore recent snapshots.
- `revert_turn` should let the model request a rollback through the tool system.
- The design risk is medium-high because it crosses file writes, git state, disk growth, and tool permission flow.
- The recommended path is Path C: phased delivery.
- Path C ships snapshot infrastructure first, then restore UX, then the model-facing tool.
- The expected follow-up work is 6-8 sub-PRs.
- The expected total touch set is 30-50 files across source, tests, dist, and citation docs.
- P2.4 should not reuse file-history as the snapshot engine because file-history is tool-edit scoped, not workspace scoped.

## Plan anchors

- `PURE_DEEPSEEK_PLAN.md` defines P2.4 as "Workspace rollback (side-git snapshots)".
- The plan goal is to snapshot the workspace before each turn into a side `.git` directory.
- The plan also requires `/restore`.
- The plan also requires a `revert_turn` tool.
- The plan names `src/services/snapshot/` as a new directory.
- The plan names `src/commands/restore.tsx` as a new command UI.
- The plan names `src/tools/RevertTurnTool/` as a new tool.
- The plan names `src/services/snapshot/diskCap.ts` for a 500MB hard limit.
- The plan operation list uses `~/.deepcode/snapshots/<workspace-hash>/.git`.
- The plan operation list uses `git --work-tree=<workspace> --git-dir=<side-git> add -A`.
- The plan operation list uses turn-scoped commit messages.
- The plan operation list requires listing the last 10 snapshots.
- The plan operation list requires `revert_turn({turn_id})`.
- The plan operation list requires pruning oldest snapshots above the disk cap.
- The plan operation list says never to touch the user's `.git`.
- `P2_ROADMAP.md` classifies P2.4 as medium-high risk.
- `P2_ROADMAP.md` calls out side git, lock file, and disk cap tests as mitigations.
- `P2_ROADMAP.md` says no snapshot subsystem exists yet.

## Phase A - Existing infrastructure inventory

### A1. Side-git approach

- The planned storage path is `~/.deepcode/snapshots/<workspace-hash>/.git`.
- The planned commits are side-git commits, not user repository commits.
- The planned add operation is `git --work-tree=<workspace> --git-dir=<side-git> add -A`.
- The planned restore operation should also use explicit `--git-dir` and `--work-tree`.
- The current repo has no `packages/deep-code/src/services/snapshot/` directory.
- The current repo has no dedicated side-git snapshot service.
- The current repo has no `/restore` command for workspace snapshots.
- The current repo has `/rewind`, but `/rewind` is a file-history and conversation restore feature.
- The current repo has file-history snapshots under `~/.deepcode/file-history/<sessionId>/`.
- File-history tracks files touched by known edit tools.
- File-history is not a full workspace snapshot engine.
- File-history does not cover arbitrary user shell edits unless those edits flow through tracked tool hooks.
- P2.4 therefore needs a new workspace-level snapshot subsystem.
- The closest git helper module is `packages/deep-code/src/utils/git.ts`.
- `utils/git.ts` contains `findGitRoot`.
- `utils/git.ts` contains `findCanonicalGitRoot`.
- `utils/git.ts` contains `gitExe`.
- `utils/git.ts` contains `getGitDir`.
- `utils/git.ts` contains `getRemoteUrl`.
- `utils/git.ts` contains `getRepoRemoteHash`.
- `utils/git.ts` contains preserved-state helpers for stashing and restoring local changes.
- `findGitRoot` walks parent directories until a `.git` dir or file is found.
- `findCanonicalGitRoot` resolves worktree indirection through `.git` files and `commondir`.
- `findCanonicalGitRoot` is the better starting point for workspace root resolution.
- `gitExe()` centralizes the git binary path.
- `getGitDir()` already handles `.git` directory and file forms.
- These helpers are designed around the user's repository.
- The side-git implementation should reuse helper style, not helper semantics blindly.
- Side-git commands must not call plain `git add` or plain `git checkout` from the workspace.
- Side-git commands must always pass the side-git path explicitly.
- Side-git commands must use absolute paths.
- Side-git commands should use `execFile`-style APIs rather than shell string concatenation.
- The implementation should not use `git stash`.
- The implementation should not use `git reset --hard` against the user's repo.
- The implementation should not use `git checkout .` against the user's repo.
- The implementation should not use `git clean` against the user's repo.
- The side-git repo can be initialized with `git init --separate-git-dir` or by creating a normal bare-ish `.git` store with explicit commands.
- The safer first design is to initialize the side `.git` directory directly and always use `--git-dir` plus `--work-tree`.
- A manifest outside `.git` is useful for listing snapshots without parsing only git logs.
- The manifest should live under `~/.deepcode/snapshots/<workspace-hash>/manifest.jsonl` or equivalent.
- The manifest should include snapshot id.
- The manifest should include turn id.
- The manifest should include phase.
- The manifest should include commit sha.
- The manifest should include timestamp.
- The manifest should include changed file count if cheaply available.
- The manifest should not store file contents.
- The manifest should not store prompt text.
- The manifest should not store secrets from environment variables.
- The manifest can store relative file paths because restore previews need file names.
- The manifest can store size estimates for disk-cap pruning.
- Snapshot commits can store actual workspace content in the side-git object database.
- That storage is necessary for restore.
- That storage is also why disk cap enforcement is required.

### A2. Workspace hash computation

- P2.4 needs a stable `workspace-hash` to choose a snapshot directory.
- The existing project config identity helper is `getProjectPathForConfig()` in `packages/deep-code/src/utils/config.ts`.
- `getProjectPathForConfig()` resolves the original working directory.
- `getProjectPathForConfig()` prefers `findCanonicalGitRoot(getOriginalCwd())`.
- `getProjectPathForConfig()` falls back to `path.resolve(getOriginalCwd())`.
- That pattern is a good local workspace-root precedent.
- The existing remote identity helper is `getRepoRemoteHash()` in `utils/git.ts`.
- `getRepoRemoteHash()` normalizes remote URLs.
- `getRepoRemoteHash()` returns a SHA-256-derived 16-character hash.
- The remote hash is useful across machines for analytics and settings sync.
- The remote hash alone is not sufficient for side-git storage.
- Multiple local clones of the same remote should not share one local snapshot object database.
- Sharing one snapshot store across those clones would be dangerous.
- The side-git storage hash should therefore be path based by default.
- Recommended storage id: SHA-256 of the realpath of the canonical workspace root.
- Recommended algorithm: Node `crypto.createHash('sha256')`.
- `packages/deep-code/src/utils/hash.ts` has `hashContent`.
- `hashContent` may use `Bun.hash`.
- `Bun.hash` is fine for in-memory or non-stable internal hashes.
- Snapshot directory names should use cryptographic SHA-256 for stability and auditability.
- The side-git service should store the hash algorithm version in its manifest.
- The side-git service should store `repoRemoteHash` as metadata when available.
- The side-git service should store `canonicalWorkspaceRoot` as metadata.
- Non-git workspaces still need rollback support.
- For non-git workspaces, the canonical root can be the original cwd or configured workspace root.
- Symlink resolution should happen before hashing.
- Cross-machine consistency conflicts with local clone isolation.
- Recommendation: prioritize local clone isolation for storage.
- Recommendation: record remote hash as metadata for future workspace-aware grouping.

### A3. Turn lifecycle hooks

- The primary TUI turn boundary is in `packages/deep-code/src/screens/REPL.tsx`.
- `REPL.tsx` owns `onQuery`.
- `onQuery` calls `queryGuard.tryStart()`.
- `queryGuard.tryStart()` prevents overlapping user turns in one process.
- `onQuery` builds user and assistant message state.
- `onQuery` calls `mrOnBeforeQuery`.
- `onQuery` calls `onQueryImpl`.
- `onQuery` has a `finally` path that calls `queryGuard.end(...)`.
- `onQuery` calls `mrOnTurnComplete(messagesRef.current, aborted)`.
- `onQueryImpl` calls the query engine and consumes streaming events.
- `onQueryImpl` calls `onTurnComplete?.(messagesRef.current)` after turn completion.
- Existing message recovery hooks use `mrOnBeforeQuery`.
- Existing message recovery hooks use `mrOnTurnComplete`.
- Existing file-history initialization uses `fileHistoryMakeSnapshot`.
- `QueryEngine.ts` also makes initial file-history snapshots for persisted sessions.
- `services/runtime/messageSend.ts` is not the best first hook for snapshots.
- `messageSend.ts` handles provider runtime and streaming dispatch.
- P2.4 snapshots are workspace lifecycle events, not provider events.
- The first lifecycle integration should hook at the TUI turn boundary.
- Recommended pre-turn hook: after `queryGuard.tryStart()` succeeds.
- Recommended pre-turn hook: before any model/tool work can mutate files.
- Recommended pre-turn phase: `phase: 'pre'`.
- Recommended post-turn hook: in `finally`, after turn work has settled.
- Recommended post-turn phase: `phase: 'post'`.
- The post-turn hook should still run after a user cancel if workspace changes may have occurred.
- Snapshot errors should not crash the interactive session by default.
- Snapshot errors should surface a concise warning.
- If pre-turn snapshot fails because of lock contention, the turn can continue only if the product decision accepts missing rollback coverage.
- A stricter product decision can block the turn until snapshot succeeds or times out.
- For P2.4.a and P2.4.b, keep snapshot service isolated and testable.
- For P2.4.c, add integration tests around turn start and turn end.
- The existing `queryGuard` reduces in-process races.
- The side-git lock still needs to protect against multiple DeepCode processes.
- The side-git lock also protects against background tasks and resumed sessions.

### A4. Disk cap precedent

- The P2.4 plan requires a 500MB total side-git size cap.
- There is no generic reusable directory disk-cap helper in the current repo.
- There are several related precedents.
- `packages/deep-code/src/utils/task/diskOutput.ts` has a disk-backed output cap.
- `diskOutput.ts` uses append queues.
- `diskOutput.ts` uses byte estimates.
- `diskOutput.ts` uses a hard maximum output size.
- `diskOutput.ts` has explicit drain behavior for tests.
- That pattern is useful for queueing and deterministic tests.
- `packages/deep-code/src/utils/imageStore.ts` caps stored image paths.
- `imageStore.ts` evicts old image cache directories.
- That pattern is useful for "oldest first" pruning.
- `packages/deep-code/src/utils/plugins/cacheUtils.ts` cleans orphaned plugin cache versions.
- `cacheUtils.ts` uses marker files and age thresholds.
- That pattern is useful for safe deletion and interrupted cleanup.
- `packages/deep-code/src/utils/fileHistory.ts` caps snapshots with `MAX_SNAPSHOTS = 100`.
- File-history cap is count based.
- P2.4 needs byte based pruning.
- `utils/git.ts` has preserved-state limits for file count and total size.
- P2.4 needs a persistent object database cap.
- Recommended P2.4 helper: `src/services/snapshot/diskCap.ts`.
- Recommended cap constant: `500 * 1024 * 1024`.
- Recommended public API: `enforceSnapshotDiskCap({workspaceSnapshotDir, maxBytes})`.
- Recommended algorithm: measure side-git directory and manifest metadata.
- Recommended prune order: oldest snapshot commit first.
- Recommended pruning target: get below cap with margin.
- Recommended first implementation: full directory scan after each post-turn snapshot.
- Full scans are acceptable for the first phase because the cap is 500MB.
- Disk-cap tests should not create 500MB fixtures.
- Disk-cap tests should inject a fake size provider.
- Disk-cap tests should use tiny caps and small fixture files.
- Disk-cap tests should verify oldest snapshot pruning.
- Disk-cap tests should verify the newest snapshot is retained when possible.
- Disk-cap tests should verify manifest consistency after pruning.

### A5. Lock file precedent

- The best existing lock precedent is `packages/deep-code/src/utils/computerUse/computerUseLock.ts`.
- `computerUseLock.ts` uses a lock filename.
- `computerUseLock.ts` writes lock metadata with `flag: 'wx'`.
- `flag: 'wx'` gives atomic create-or-fail behavior.
- The lock metadata includes session id, pid, and acquisition time.
- The lock implementation checks stale pids.
- The lock implementation supports reentrant acquisition for the same session.
- The lock implementation registers cleanup.
- This is the best template for snapshot lock files.
- `packages/deep-code/src/utils/sessionStorage.ts` has per-file write queues.
- `sessionStorage.ts` is useful for in-process serialization.
- It is not enough for cross-process side-git safety.
- `QueryGuard` serializes user queries in one REPL instance.
- `QueryGuard` is not enough for multiple processes.
- P2.4 should have both an in-process queue and a lock file.
- Recommended lock path: `~/.deepcode/snapshots/<workspace-hash>/snapshot.lock`.
- Recommended lock metadata: pid, session id, workspace root, startedAt, operation, turn id.
- Recommended lock acquire operation: atomic write with exclusive create.
- Recommended stale handling: check pid liveness.
- Recommended timeout: short default for UI operations.
- Lock release should remove only a lock owned by the current process/session.
- Lock release should tolerate missing files.
- Lock acquisition should fail closed for restore.
- Lock acquisition can warn and skip for post-turn snapshot if product chooses non-blocking behavior.
- The first implementation should keep lock code small and heavily tested.
- Tests should simulate contention.
- Tests should simulate stale lock ownership.
- Tests should verify lock files are not deleted when ownership differs.

### A6. revert_turn tool surface

- Tool registration is centralized in `packages/deep-code/src/tools.ts`.
- `tools.ts` exposes `getAllBaseTools()`.
- Tools are built with `buildTool` from `packages/deep-code/src/Tool.ts`.
- The tool contract uses schemas, validation, permission metadata, and UI rendering hooks.
- `TaskStopTool` is a small example of strict zod input and output.
- `ExitWorktreeTool` is a better example for destructive workspace state changes.
- `ExitWorktreeTool` marks destructive behavior explicitly.
- `ExitWorktreeTool` fails closed when worktree state cannot be verified.
- `ExitWorktreeTool` requires explicit user intent for destructive cleanup.
- `BashTool` is a reference for permission and destructive command warnings.
- File edit tools are references for file-history integration.
- `revert_turn` should be treated as destructive.
- `revert_turn` can overwrite files in the workspace.
- `revert_turn` can undo user-wanted changes.
- `revert_turn` should not be auto-approved by default.
- `revert_turn` should require explicit confirmation.
- `revert_turn` should display affected files before execution.
- `revert_turn` should validate that the target turn exists.
- `revert_turn` should validate that a matching pre or post snapshot exists.
- `revert_turn` should fail closed if snapshot metadata is inconsistent.
- `revert_turn` should not accept arbitrary commit shas from the model.
- `revert_turn` should accept only `{turn_id: number}`.
- The tool can map turn id to snapshot id internally.
- The tool should default to restoring the pre-turn snapshot for that turn.
- P2.4.e should keep the first tool schema narrow.
- Tool output should report local restore completion.
- Tool output should not claim remote or user git rollback.
- Tool output should include the restored snapshot id.
- Tool output should include affected file count.
- Tool UI should make confirmation meaningful.
- Tool tests should cover permission classification.
- Tool tests should cover invalid turn id.
- Tool tests should cover restore success.
- Tool tests should cover lock contention.

## Phase B - Path options

### Path A - Minimal: snapshot plus /restore only

- Path A implements pre-turn snapshots.
- Path A implements post-turn snapshots.
- Path A implements `/restore`.
- Path A lists recent snapshots.
- Path A restores selected snapshots with side-git checkout.
- Path A skips the `revert_turn` tool.
- Path A does not meet the full plan.
- Path A omits the model self-revert workflow.
- Path A loses part of the intended safety value.
- Path A is acceptable only if schedule pressure dominates completeness.

### Path B - Full per plan

- Path B implements all planned operations.
- Path B implements side-git snapshot service.
- Path B implements turn start snapshot.
- Path B implements turn end snapshot.
- Path B implements `/restore`.
- Path B implements `revert_turn`.
- Path B implements disk cap pruning.
- Path B implements lock-file race protection.
- Path B implements tests for snapshot, restore, cap, and lock.
- Path B also maximizes integration risk.
- Path B couples storage, lifecycle, UX, and model tool semantics.
- Path B is harder to review.
- Path B is harder to revert if the model-facing tool has issues.
- Path B is not recommended as one implementation slice.

### Path C - Phased: full plan with revert_turn deferred

- Path C implements the full plan through separate PRs.
- Path C starts with snapshot service core.
- Path C then adds disk cap and lock infrastructure.
- Path C then integrates turn lifecycle snapshots.
- Path C then adds `/restore`.
- Path C then adds `revert_turn`.
- Path C keeps model integration last.
- Path C keeps the highest-risk user-facing rollback operation behind tested infrastructure.
- Path C keeps each review smaller.
- Path C still lands the complete P2.4 feature.
- Path C is the recommended path.

## Phase C - Recommended path + rationale

- Recommendation: choose Path C.
- Rationale: snapshot infrastructure is a prerequisite for every other part.
- Rationale: disk cap and lock correctness are independent of command UI.
- Rationale: `/restore` is user-mediated and safer to ship before `revert_turn`.
- Rationale: `revert_turn` adds model agency and permission risk.
- Rationale: separating model integration reduces review scope.
- Rationale: the feature is medium-high risk and should be staged.
- Rationale: `revert_turn` can reuse the same restore path, reducing duplicate logic.
- Rationale: P2.1, P2.2, and P2.3 already used multi-PR phase execution successfully.
- Rationale: Path C gives clear tripwires for each implementation step.
- Recommended estimate: 6-8 sub-PRs after this scan.
- Recommended estimate: 30-50 file touches total.
- Recommended risk posture: block or warn on snapshot failures based on phase decision.
- Recommended implementation rule: all rollback operations go through one snapshot service API.
- Recommended implementation rule: command and tool surfaces must not run raw git logic directly.
- Recommended implementation rule: restore previews must show affected files before destructive checkout.

## Phase D - Sub-PR breakdown for Path C

### P2.4.scan - this PR

- Create `P2_4_DESIGN.md`.
- Inventory git helpers, workspace identity, turn lifecycle, disk cap, lock, command, and tool patterns.
- Recommend Path C.
- Define implementation sub-PRs.
- Define risks and key decisions.
- Keep changed files exactly one.

### P2.4.a - snapshot service core

- Create `packages/deep-code/src/services/snapshot/index.ts` or `.mjs` based on local style.
- Add `createSnapshot({workspaceRoot, turnId, phase})`.
- Add `listSnapshots({workspaceRoot, limit})`.
- Add `resolveSnapshotStore({workspaceRoot})`.
- Add workspace hash helper.
- Compute side-git path `~/.deepcode/snapshots/<hash>/.git`.
- Initialize side-git repository if missing.
- Run all git commands with explicit `--git-dir` and `--work-tree`.
- Commit snapshots with deterministic messages.
- Record manifest metadata: turn id, phase, timestamp, commit sha, workspace root, hash version, and optional relative changed files.
- Do not store prompt text.
- Do not touch user's `.git`.
- Test hash stability, non-git workspaces, snapshot commits, manifest writes, and user `.git` separation.
- Expected files: 4-7.

### P2.4.b - disk cap plus lock-file infrastructure

- Create `packages/deep-code/src/services/snapshot/diskCap.ts`.
- Create `packages/deep-code/src/services/snapshot/lock.ts`.
- Add 500MB default cap.
- Add injectable cap for tests.
- Add oldest-first pruning.
- Add manifest cleanup after pruning.
- Add lock acquisition with atomic exclusive create.
- Add lock metadata, stale lock recovery, and ownership-checked release.
- Add in-process queue around snapshot operations.
- Test cap enforcement, under-limit no-op, oldest pruning, lock contention, stale cleanup, and non-owner release refusal.
- Expected files: 4-8.

### P2.4.c - turn lifecycle integration

- Hook snapshot service into the main turn boundary.
- Preferred first hook is `REPL.tsx` `onQuery`.
- Create pre-turn snapshot after `queryGuard.tryStart()` succeeds.
- Create post-turn snapshot when turn work settles.
- Include aborted metadata for canceled turns.
- Keep snapshot errors visible but controlled.
- Avoid provider coupling.
- Avoid tool-specific edit hooks in this PR.
- Test one pre snapshot and one post snapshot per turn, including concurrency and abort behavior.
- Expected files: 4-8.

### P2.4.d - /restore command plus dialog

- Create `packages/deep-code/src/commands/restore/index.ts`.
- Create `packages/deep-code/src/commands/restore/restore.tsx`.
- Consider adding `packages/deep-code/src/commands/restore/restore-command.mjs` for pure logic.
- Register `/restore` in `packages/deep-code/src/commands.ts`.
- Dialog lists last 10 snapshots with turn id, phase, timestamp, changed file count, and affected-file preview.
- Dialog requires confirmation before checkout.
- Restore uses the snapshot service API.
- Restore does not run raw git commands in the command component.
- Restore does not touch the user's `.git`.
- Restore warns that workspace files may be overwritten.
- Restore reports completion with snapshot id and affected file count.
- Test list rendering, confirmation, restore round trip, empty store, and lock contention.
- Expected files: 5-9.

### P2.4.e - revert_turn tool

- Create `packages/deep-code/src/tools/RevertTurnTool/RevertTurnTool.ts`.
- Create `packages/deep-code/src/tools/RevertTurnTool/UI.tsx`.
- Register the tool in `packages/deep-code/src/tools.ts`.
- Tool input is `{turn_id: number}`.
- Tool should not accept arbitrary paths or git shas.
- Tool should resolve the target snapshot through the snapshot service.
- Tool should default to the pre-turn snapshot for the target turn.
- Tool should be marked destructive.
- Tool should require confirmation by default.
- Tool should show affected files before execution.
- Tool should be non-concurrency-safe.
- Tool should use the same restore path as `/restore`.
- Tool should return structured output and fail closed on missing metadata, lock contention, or unknown affected files.
- Test schema validation, permission classification, success, invalid turn id, and confirmation-required behavior.
- Expected files: 5-9.

### P2.4.test - comprehensive hardening split, optional

- Use this split if P2.4.a through P2.4.e tests become too large.
- Add race, restore-overwrite, manifest-corruption, side-git invariant, non-git workspace, and path-traversal tests.
- Add Windows path normalization tests if support is claimed.
- Add large-file skip or warning tests if needed.
- Keep explicit tests that the user's `.git` remains untouched.
- Expected files: 2-6 if split is needed.

### P2.4.Z - dist refresh

- Rebuild `packages/deep-code/dist/deepcode-full.mjs`.
- Keep this PR dist-only.
- Verify build idempotency.
- Verify `bun test` baseline.
- Verify no lockfile drift enters the commit.
- Expected files: exactly 1.

### P2.4.cite - close phase

- Update `EXECUTION_LOG.md`.
- Cite scan and implementation PRs.
- Record recommendation and final path.
- Record tests and CI.
- Advance Phase 2 progress to the next roadmap item.
- Keep this PR docs-only.
- Expected files: exactly 1.

## Phase E - Risk assessment

### Race conditions

- File operations can happen while the user turn is still running.
- File operations can happen from tools.
- File operations can happen from user shell activity.
- File operations can happen from background hooks.
- Multiple DeepCode sessions can point at the same workspace.
- A side-git commit can race with another side-git commit.
- A restore can race with a snapshot.
- A restore can race with user edits.
- Mitigation: use `queryGuard` for in-process turn serialization.
- Mitigation: use a side-git lock file for cross-process serialization.
- Mitigation: use an in-process queue for snapshot operations.
- Mitigation: keep restore and snapshot operations mutually exclusive.
- Mitigation: display lock contention clearly.
- Mitigation: test concurrent lock acquisition.

### Side-git index corruption

- Git index writes are not safe if multiple writers share the same git dir.
- A stale index.lock can block future snapshots.
- A process crash during git add or commit can leave partial state.
- Mitigation: never share the user's index.
- Mitigation: use explicit side `--git-dir`.
- Mitigation: use explicit `--work-tree`.
- Mitigation: hold snapshot lock around all git operations.
- Mitigation: detect stale side-git index locks carefully.
- Mitigation: fail closed if side-git integrity is uncertain.
- Mitigation: add doctor checks later for side-git health.

### Disk cap accuracy

- Directory size scans can be expensive in large object databases.
- `du` behavior varies across platforms.
- `fs.stat` file size sums differ from allocated disk blocks.
- Git object packing can change apparent size.
- Pruning commits does not immediately shrink object database unless unreachable objects are cleaned.
- Mitigation: define cap based on measured file byte sizes for determinism.
- Mitigation: use full scans first.
- Mitigation: keep cap tests injectable and platform-independent.
- Mitigation: prune oldest snapshots via manifest metadata.
- Mitigation: run git maintenance only if necessary and guarded.
- Mitigation: document that cap is best-effort after git object cleanup.

### User `.git` interference

- This is the highest invariant risk.
- Plain git commands can accidentally target the user's repository.
- Restore commands can overwrite user workspace files.
- Stash or reset operations can mutate user git state.
- Mitigation: never run plain workspace git commands for snapshot state.
- Mitigation: always pass `--git-dir` and `--work-tree`.
- Mitigation: centralize git command construction in snapshot service.
- Mitigation: test command arguments.
- Mitigation: test user `.git` mtime or status remains separate where practical.
- Mitigation: do not use `git stash`.
- Mitigation: do not use user-repo branches.
- Mitigation: do not create refs in the user's repo.

### Cross-platform paths

- Windows path separators need normalization.
- Windows drive letters may need case normalization.
- Symlinks can point multiple paths to the same workspace.
- Worktrees can use `.git` files.
- Non-git directories still need stable identity.
- Home directory expansion differs by platform.
- Mitigation: use `path.resolve`.
- Mitigation: use `fs.realpath` where available.
- Mitigation: reuse `findCanonicalGitRoot`.
- Mitigation: store algorithm version in manifest.
- Mitigation: support Linux and Darwin first if schedule requires.
- Mitigation: add Windows tests before claiming full Windows support.

### Tool model abuse

- `revert_turn` gives the model a way to overwrite workspace files.
- The model may revert changes the user wanted.
- The model may call rollback repeatedly.
- The model may revert to an old snapshot that loses unrelated edits.
- Mitigation: mark `revert_turn` destructive.
- Mitigation: require confirmation by default.
- Mitigation: show affected files.
- Mitigation: rate-limit or de-duplicate repeated calls.
- Mitigation: restrict input to turn id.
- Mitigation: do not accept commit sha from the model.
- Mitigation: log restore actions for audit.

### Restore overwriting unrelated files

- `/restore` can overwrite files changed after the snapshot.
- It can remove files created after the snapshot.
- It can restore generated files if they are tracked in the side-git snapshot.
- It can conflict with ignored files depending on side-git add rules.
- Mitigation: show affected files before restore.
- Mitigation: require user confirmation.
- Mitigation: classify adds, deletes, and modifications.
- Mitigation: allow cancel at preview.
- Mitigation: include local-only warning for non-user-git state.
- Mitigation: consider a dry-run diff before checkout.

## Phase F - Key decisions

### Q1. Path A/B/C selection

- Recommendation: Path C.
- Path C provides complete feature delivery through staged implementation.
- Path C keeps storage correctness ahead of model-facing rollback.
- Path C reduces review risk.

### Q2. Snapshot trigger location

- Recommendation: first lifecycle hook in `REPL.tsx` `onQuery`.
- Pre snapshot should run after `queryGuard.tryStart()`.
- Pre snapshot should run before model/tool work.
- Post snapshot should run when turn work settles.
- `messageSend.ts` is not the first choice because snapshots are workspace lifecycle events.

### Q3. Lock implementation

- Recommendation: file lock plus in-process queue.
- File lock should use atomic exclusive create.
- File lock should include pid and session id.
- File lock should support stale recovery.
- File lock should mirror the `computerUseLock.ts` pattern.

### Q4. revert_turn permission default

- Recommendation: confirm by default.
- `revert_turn` should be destructive.
- `revert_turn` should not be auto-approved.
- `revert_turn` should show affected files.

### Q5. /restore dialog UI parent

- Recommendation: TUI dialog command.
- The command should follow `/cache` and `/diff` local-jsx patterns.
- The command should list last 10 snapshots.
- The command should preview affected files.
- The command should require confirmation.

### Q6. Disk cap behavior at limit

- Recommendation: auto-prune oldest snapshots.
- The newest snapshot should be preserved when possible.
- If one snapshot exceeds the cap, keep it and warn.
- Prune should be local to the workspace snapshot store.

### Q7. workspace-hash algorithm

- Recommendation: SHA-256 of canonical workspace realpath for storage.
- Record repo remote hash as metadata when available.
- This prioritizes local clone isolation.
- This avoids sharing snapshots between multiple clones of the same repo.
- This may not be cross-machine stable.

### Q8. Cross-platform Windows support priority

- Recommendation: design with Windows in mind, test Darwin and Linux first.
- Path handling should use Node path APIs.
- The manifest should record algorithm version.
- Windows-specific behavior should be verified before claiming support.

## Phase G - Reference appendix

### Helper map

- Git helpers: `packages/deep-code/src/utils/git.ts`.
- Workspace identity: `packages/deep-code/src/utils/config.ts`.
- Stable hashing precedent: `packages/deep-code/src/utils/hash.ts`.
- File-history precedent: `packages/deep-code/src/utils/fileHistory.ts`.
- Rewind UI precedent: `packages/deep-code/src/commands/rewind/index.ts`.
- Rewind selector: `packages/deep-code/src/components/MessageSelector.tsx`.
- Turn boundary: `packages/deep-code/src/screens/REPL.tsx`.
- Query guard: `packages/deep-code/src/utils/QueryGuard.ts`.
- Disk output cap: `packages/deep-code/src/utils/task/diskOutput.ts`.
- Image cache eviction: `packages/deep-code/src/utils/imageStore.ts`.
- Plugin cache cleanup: `packages/deep-code/src/utils/plugins/cacheUtils.ts`.
- File lock template: `packages/deep-code/src/utils/computerUse/computerUseLock.ts`.
- In-process write queue precedent: `packages/deep-code/src/utils/sessionStorage.ts`.
- Command pattern: `packages/deep-code/src/commands/cache/`.
- Dialog command pattern: `packages/deep-code/src/commands/diff/`.
- Tool registration: `packages/deep-code/src/tools.ts`.
- Tool contract: `packages/deep-code/src/Tool.ts`.
- Small tool example: `packages/deep-code/src/tools/TaskStopTool/`.
- Destructive workspace-state example: `packages/deep-code/src/tools/ExitWorktreeTool/`.
- Permission/destructive-warning reference: `packages/deep-code/src/tools/BashTool/`.

### Snapshot API sketch

- `resolveSnapshotWorkspace({workspaceRoot})`
- `createSnapshot({workspaceRoot, turnId, phase, metadata})`
- `listSnapshots({workspaceRoot, limit})`
- `previewRestore({workspaceRoot, snapshotId})`
- `restoreSnapshot({workspaceRoot, snapshotId, confirmed})`
- `enforceSnapshotDiskCap({workspaceRoot, maxBytes})`
- `withSnapshotLock({workspaceRoot, operation}, fn)`
- `computeWorkspaceHash({workspaceRoot})`

### Required test themes

- Side-git store initialization.
- Pre-turn and post-turn commit creation.
- Last-10 snapshot listing.
- Non-git workspace support.
- User `.git` separation.
- Stable workspace hashing.
- Manifest writes without prompt text.
- Restore preview and restore round trip.
- Missing snapshot and lock contention failure.
- Disk cap pruning and under-limit no-op.
- Stale lock recovery and non-owner release refusal.
- Turn lifecycle trigger count.
- `/restore` empty state, list state, and confirmation.
- `revert_turn` schema, permission classification, and restore execution.

### Implementation notes

- Keep restore behavior centralized in the snapshot service.
- Keep command and tool surfaces thin.
- Keep P2.4 provider-neutral.
- Keep P2.3 cache work independent.
- Keep dist refresh for P2.4.Z.

## Local verification target

- `bun test` should keep the current 69/69 baseline passing for this docs-only scan.
- `git diff --name-only` should show only `P2_4_DESIGN.md`.
- No source files should change.
- No test files should change.
- No dist files should change.
- No lockfile should change.

## Final recommendation

- Proceed with Path C.
- Start with the snapshot service core.
- Add disk cap and lock infrastructure before lifecycle integration.
- Add lifecycle snapshots before `/restore`.
- Add `/restore` before `revert_turn`.
- Keep all git operations centralized in the snapshot service.
- Keep the user's `.git` untouched.
- Require confirmation for destructive restore operations.
- Treat disk cap and lock tests as required, not optional.
- Use P2.4.test only if hardening grows beyond the implementation PR limits.
