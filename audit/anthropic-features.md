# Anthropic-only Feature Directory Inventory

Task: P0.2  
Base commit: `541c58c9b185a824225c07b8d2a3a68ce420216a`  
Generated: 2026-05-09

## Methodology

- Walked each path listed in `PURE_DEEPSEEK_PLAN.md` P0.2 using `find`-equivalent traversal.
- Counted files recursively for directory/glob entries and directly for file entries.
- Counted dependents by scanning `packages/deep-code/src` static `import`, `export ... from`, dynamic `import(...)`, and `require(...)` specifiers, resolving local `.js` specifiers back to TypeScript source files.
- Dependent counts exclude files inside the inventoried path itself.

Summary: 21 inventory entries cover 71 source files, satisfying the P0.2 `>= 47` file-count acceptance target.

| path | classification | file count | dependents (importing files count) | notes |
| --- | --- | ---: | ---: | --- |
| `packages/deep-code/src/bridge/` | DELETE | 31 | 25 | Remote bridge, Claude web session, trusted-device, remote transport, and environment reconnect code. No DeepSeek-native equivalent is planned; later removals must first unwind `main.tsx`, REPL bridge hooks, login/logout, brief upload, and bridge UI imports. |
| `packages/deep-code/src/commands/bridge/` | DELETE | 2 | 1 | Slash command wrapper for the bridge subsystem; only external dependent is the command registry. |
| `packages/deep-code/src/commands/btw/` | DELETE | 2 | 1 | Browser-to-web / remote control command surface; only external dependent is the command registry. |
| `packages/deep-code/src/commands/chrome/` | DELETE | 2 | 1 | Claude-in-Chrome setup command; depends on the Chrome integration that has no DeepSeek replacement. |
| `packages/deep-code/src/commands/desktop/` | DELETE | 2 | 1 | Desktop upsell command surface; Anthropic desktop product integration should be removed rather than replaced. |
| `packages/deep-code/src/commands/ultraplan*` | DELETE | 1 | 3 | CCR plan-on-the-web command. Downstream references are command registration and background-task/permission UI affordances. |
| `packages/deep-code/src/components/DesktopUpsell/` | DELETE | 1 | 2 | User-visible Anthropic desktop upsell. Remove with REPL startup dialog and tips registry references. |
| `packages/deep-code/src/components/ConsoleOAuthFlow.tsx` | DELETE | 1 | 4 | Anthropic console OAuth UI. DeepSeek API-key auth should not reuse this flow. |
| `packages/deep-code/src/components/Teleport*` | DELETE | 5 | 4 | Teleport UI components for remote Claude sessions. Remove with resume/launch/teleport utility call sites. |
| `packages/deep-code/src/components/ClaudeInChromeOnboarding.tsx` | DELETE | 1 | 1 | Onboarding UI for Claude-in-Chrome extension. Remove with Chrome MCP setup. |
| `packages/deep-code/src/components/ClaudeMdExternalIncludesDialog.tsx` | REWRITE | 1 | 2 | Memory-file include dialog is useful, but `CLAUDE.md` naming must migrate to `DEEPCODE.md` with legacy fallback in later config tasks. |
| `packages/deep-code/src/components/IdeOnboardingDialog.tsx` | REWRITE | 1 | 2 | IDE integration stays, but product copy and installation assumptions must be DeepCode-native. |
| `packages/deep-code/src/utils/teleport*` | DELETE | 5 | 30 | Teleport client, environment selection, git bundle, and remote resume helpers. This is the broadest dependency cluster and should drive deletion ordering. |
| `packages/deep-code/src/utils/claudeInChrome/` | DELETE | 7 | 12 | Chrome native host, MCP server, setup, prompt, and rendering code for Claude-in-Chrome. No DeepSeek replacement is planned. |
| `packages/deep-code/src/services/voiceStreamSTT.ts` | REWRITE | 1 | 3 | Anthropic voice endpoint client. Keep the voice feature surface but replace with local Whisper.cpp default and Deepgram opt-in. |
| `packages/deep-code/src/services/api/firstTokenDate.ts` | DELETE | 1 | 1 | Anthropic-billed first-token metric. Remove with auth handler dependency. |
| `packages/deep-code/src/services/api/claude.ts` | REWRITE | 1 | 25 | Central Anthropic API facade. Keep a compatibility seam only long enough to move callers to the DeepSeek client and local type stubs. |
| `packages/deep-code/src/skills/bundled/scheduleRemoteAgents.ts` | DELETE | 1 | 1 | CCR trigger / scheduled remote agent skill. No DeepSeek-platform equivalent is planned. |
| `packages/deep-code/src/skills/bundled/stuck.ts` | DELETE | 1 | 1 | `[ANT-ONLY]` bundled skill; safe to remove when bundled skill registry is updated. |
| `packages/deep-code/src/tools/RemoteTriggerTool/` | DELETE | 3 | 2 | Tool backing scheduled remote agents. Remove after scheduleRemoteAgents and tool registry references are gone. |
| `packages/deep-code/src/constants/github-app.ts` | DELETE | 1 | 5 | Anthropic GitHub App / action template constants. Remove or replace with a separate DeepCode GitHub workflow only if a later product task explicitly adds one. |

## Deletion-order Notes

- Start with leaf command directories and UI upsells (`commands/desktop`, `DesktopUpsell`, `commands/chrome`) before broad subsystems.
- `src/bridge/` and `src/utils/teleport*` have the highest dependent counts and should be split into smaller deletion PRs.
- `services/api/claude.ts` is not a pure delete target during Phase 1 because many generic model-query helpers still route through it; replace the API implementation and exported type surface first.
- `ClaudeMdExternalIncludesDialog.tsx` and `IdeOnboardingDialog.tsx` are not platform deletions; they are product-naming rewrites.

## File-level breakdown

| path | classification | dependents (importing files count) | notes |
|---|---:|---:|---|
| `packages/deep-code/src/bridge/bridgeApi.ts` | DELETE | 3 | Bridge HTTP client for CCR/Remote Control API. |
| `packages/deep-code/src/bridge/bridgeConfig.ts` | DELETE | 7 | Resolves Claude bridge OAuth token and `CLAUDE_BRIDGE_*` overrides. |
| `packages/deep-code/src/bridge/bridgeDebug.ts` | DELETE | 2 | Ant-only bridge fault injection for Remote Control recovery testing. |
| `packages/deep-code/src/bridge/bridgeEnabled.ts` | STUB | 10 | Entitlement/build gate for bridge mode; stub false while dependent UI/CLI imports are removed. |
| `packages/deep-code/src/bridge/bridgeMain.ts` | DELETE | 2 | Main Remote Control/CCR bridge session lifecycle. |
| `packages/deep-code/src/bridge/bridgeMessaging.ts` | DELETE | 3 | Bridge SDK message transport helpers. |
| `packages/deep-code/src/bridge/bridgePermissionCallbacks.ts` | STUB | 3 | Remote permission callback types used outside bridge; can become type-only/no-op during removal. |
| `packages/deep-code/src/bridge/bridgePointer.ts` | DELETE | 2 | Crash-recovery pointer for Remote Control sessions. |
| `packages/deep-code/src/bridge/bridgeStatusUtil.ts` | STUB | 7 | Bridge status text/link helpers imported by shared UI; stub while UI references are cut. |
| `packages/deep-code/src/bridge/bridgeUI.ts` | DELETE | 1 | Remote Control terminal UI and QR/link rendering. |
| `packages/deep-code/src/bridge/capacityWake.ts` | DELETE | 2 | Bridge poll-loop capacity wake primitive. |
| `packages/deep-code/src/bridge/codeSessionApi.ts` | DELETE | 1 | CCR v2 code-session API wrappers with Anthropic headers. |
| `packages/deep-code/src/bridge/createSession.ts` | DELETE | 3 | Creates web/bridge sessions for Remote Control. |
| `packages/deep-code/src/bridge/debugUtils.ts` | DELETE | 8 | Bridge-specific error detail extraction and secret redaction. |
| `packages/deep-code/src/bridge/envLessBridgeConfig.ts` | DELETE | 4 | GrowthBook config for env-less bridge sessions. |
| `packages/deep-code/src/bridge/flushGate.ts` | DELETE | 2 | Bridge message flush queueing state machine. |
| `packages/deep-code/src/bridge/inboundAttachments.ts` | DELETE | 2 | Resolves Claude web composer attachment UUIDs into local uploads. |
| `packages/deep-code/src/bridge/inboundMessages.ts` | DELETE | 2 | Extracts inbound Remote Control message fields. |
| `packages/deep-code/src/bridge/initReplBridge.ts` | DELETE | 2 | REPL hook that initializes bridge mode. |
| `packages/deep-code/src/bridge/jwtUtils.ts` | DELETE | 3 | JWT expiry helper used by CCR bridge/client transports. |
| `packages/deep-code/src/bridge/pollConfig.ts` | DELETE | 3 | Bridge polling interval configuration. |
| `packages/deep-code/src/bridge/pollConfigDefaults.ts` | DELETE | 2 | Bridge poll default values. |
| `packages/deep-code/src/bridge/remoteBridgeCore.ts` | DELETE | 1 | Core env-less CCR bridge implementation. |
| `packages/deep-code/src/bridge/replBridge.ts` | DELETE | 5 | REPL-side Remote Control bridge implementation. |
| `packages/deep-code/src/bridge/replBridgeHandle.ts` | STUB | 2 | Global handle setter/getter for bridge sessions; stub null while SendMessage/useReplBridge are unwound. |
| `packages/deep-code/src/bridge/replBridgeTransport.ts` | DELETE | 3 | Transport layer for bridge REPL sessions. |
| `packages/deep-code/src/bridge/sessionIdCompat.ts` | STUB | 7 | Bridge/remote session id compatibility helper; stub if product constants still import it. |
| `packages/deep-code/src/bridge/sessionRunner.ts` | DELETE | 1 | Starts child Claude CLI sessions for bridge work. |
| `packages/deep-code/src/bridge/trustedDevice.ts` | DELETE | 6 | Anthropic trusted-device enrollment for elevated Remote Control auth. |
| `packages/deep-code/src/bridge/types.ts` | STUB | 11 | Bridge constants/types are widely imported; replace with temporary compile-only exports during removal. |
| `packages/deep-code/src/bridge/workSecret.ts` | DELETE | 4 | Bridge work-secret handling for CCR session auth. |
| `packages/deep-code/src/commands/bridge/bridge.tsx` | DELETE | 1 | `/remote-control` command UI. |
| `packages/deep-code/src/commands/bridge/index.ts` | DELETE | 1 | Registers `/remote-control` command. |
| `packages/deep-code/src/commands/btw/btw.tsx` | DELETE | 1 | Claude web workflow command implementation. |
| `packages/deep-code/src/commands/btw/index.ts` | DELETE | 1 | Registers `btw` command. |
| `packages/deep-code/src/commands/chrome/chrome.tsx` | DELETE | 1 | Claude-in-Chrome settings/onboarding command implementation. |
| `packages/deep-code/src/commands/chrome/index.ts` | DELETE | 1 | Registers `chrome` command with `claude-ai` availability. |
| `packages/deep-code/src/commands/desktop/desktop.tsx` | DELETE | 1 | Claude Code Desktop handoff command implementation. |
| `packages/deep-code/src/commands/desktop/index.ts` | DELETE | 1 | Registers `desktop`/`app` command with `claude-ai` availability. |
| `packages/deep-code/src/commands/ultraplan.tsx` | DELETE | 3 | Remote Claude Code on the web multi-agent planning flow. |
| `packages/deep-code/src/components/ClaudeInChromeOnboarding.tsx` | DELETE | 1 | Claude-in-Chrome extension onboarding dialog. |
| `packages/deep-code/src/components/ClaudeMdExternalIncludesDialog.tsx` | REWRITE | 2 | CLAUDE.md-specific security prompt; rewrite for new project instruction filename/branding. |
| `packages/deep-code/src/components/ConsoleOAuthFlow.tsx` | DELETE | 4 | Anthropic Console/Claude.ai OAuth login UI; delete this UI while rewriting the separate auth handler to DeepSeek API-key flow. |
| `packages/deep-code/src/components/DesktopUpsell/DesktopUpsellStartup.tsx` | DELETE | 2 | Claude Code Desktop startup upsell. |
| `packages/deep-code/src/components/IdeOnboardingDialog.tsx` | REWRITE | 2 | IDE onboarding uses Claude branding/color and extension assumptions; rewrite for DeepCode/DeepSeek IDE flow if retained. |
| `packages/deep-code/src/components/TeleportError.tsx` | DELETE | 2 | Teleport prerequisite/login/stash dialog for Claude.ai web sessions. |
| `packages/deep-code/src/components/TeleportProgress.tsx` | DELETE | 1 | Teleport session resume progress UI. |
| `packages/deep-code/src/components/TeleportRepoMismatchDialog.tsx` | DELETE | 1 | Teleport repo mismatch selector. |
| `packages/deep-code/src/components/TeleportResumeWrapper.tsx` | DELETE | 1 | Teleport resume session picker/wrapper. |
| `packages/deep-code/src/components/TeleportStash.tsx` | DELETE | 1 | Auto-stash prompt used only by teleport. |
| `packages/deep-code/src/constants/github-app.ts` | DELETE | 5 | Emits Claude Code GitHub Action/workflow constants using Anthropic action and `ANTHROPIC_API_KEY`. |
| `packages/deep-code/src/services/api/claude.ts` | REWRITE | 25 | Core Anthropic SDK/Beta Messages streaming/query layer; must become provider-neutral or DeepSeek-native. |
| `packages/deep-code/src/services/api/firstTokenDate.ts` | DELETE | 1 | Fetches first Claude Code token date from Anthropic API. |
| `packages/deep-code/src/services/voiceStreamSTT.ts` | REWRITE | 3 | Anthropic private `voice_stream` STT websocket using Claude.ai OAuth. |
| `packages/deep-code/src/skills/bundled/scheduleRemoteAgents.ts` | DELETE | 1 | Bundled skill for Claude.ai scheduled remote agents/triggers. |
| `packages/deep-code/src/skills/bundled/stuck.ts` | DELETE | 1 | Ant-only diagnostic skill for stuck Claude Code sessions and Anthropic Slack reporting. |
| `packages/deep-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts` | DELETE | 2 | Tool implementation for Claude.ai remote trigger API. |
| `packages/deep-code/src/tools/RemoteTriggerTool/UI.tsx` | DELETE | 1 | UI renderer for RemoteTrigger tool results. |
| `packages/deep-code/src/tools/RemoteTriggerTool/prompt.ts` | DELETE | 2 | RemoteTrigger tool prompt names Claude.ai CCR API. |
| `packages/deep-code/src/utils/claudeInChrome/chromeNativeHost.ts` | DELETE | 1 | Native messaging host for Claude Chrome extension. |
| `packages/deep-code/src/utils/claudeInChrome/common.ts` | DELETE | 11 | Claude-in-Chrome MCP server names, browser/native-host paths, and tab tracking. |
| `packages/deep-code/src/utils/claudeInChrome/mcpServer.ts` | DELETE | 2 | Starts `@ant/claude-for-chrome-mcp` server and analytics. |
| `packages/deep-code/src/utils/claudeInChrome/prompt.ts` | DELETE | 5 | Claude-in-Chrome browser automation prompt/instructions. |
| `packages/deep-code/src/utils/claudeInChrome/setup.ts` | DELETE | 6 | Claude Chrome extension install/config/auto-enable setup. |
| `packages/deep-code/src/utils/claudeInChrome/setupPortable.ts` | DELETE | 2 | Chrome extension IDs and browser profile scanning. |
| `packages/deep-code/src/utils/claudeInChrome/toolRendering.tsx` | DELETE | 1 | Custom renderer for `@ant/claude-for-chrome-mcp` tools. |
| `packages/deep-code/src/utils/teleport/api.ts` | DELETE | 23 | Claude.ai/CCR Sessions API client, OAuth headers, session schemas, and retry helpers. |
| `packages/deep-code/src/utils/teleport/environmentSelection.ts` | DELETE | 1 | Selects Claude web remote environments from settings and environment-provider API results. |
| `packages/deep-code/src/utils/teleport/environments.ts` | DELETE | 7 | Anthropic environment-provider API client for cloud, BYOC, and bridge environments. |
| `packages/deep-code/src/utils/teleport/gitBundle.ts` | DELETE | 1 | Git bundle creation and Files API upload path for CCR seed-bundle seeding. |
| `packages/deep-code/src/utils/teleport.tsx` | DELETE | 10 | Claude.ai Sessions API teleport/resume, bundle upload, remote session polling/archive. |
