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
