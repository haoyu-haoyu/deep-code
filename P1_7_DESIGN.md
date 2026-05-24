# P1.7 Design - Voice STT Scan and Path Recommendation

## Phase A — Voice subsystem inventory

### A1. Scan scope and base

Base scanned:

- `main` at `c7f902123edfd5fa21aee5d2bb4d7ae3c3c09473`.
- This is after P1.6.cite, so the first CLAUDE_CODE_* env cleanup is cited and P1.7 is the next A-track item.
- Scope is docs-only: no source, test, dist, or markdown file other than this design file is changed by the scan PR.

Primary scan commands used:

- `wc -l` over the 12 core voice files.
- `rg -n` for `VOICE_MODE`, `voice_stream`, `Deepgram`, `audio-capture`, `useVoice`, `/voice`, `voiceEnabled`, `voice:pushToTalk`, and voice UI components.
- `rg -l -i voice` over `packages/deep-code/src` to identify the broad reference set.
- Targeted reads of `voice/voiceModeEnabled.ts`, `services/voiceStreamSTT.ts`, `services/voice.ts`, `commands/voice/voice.ts`, `tools/ConfigTool/ConfigTool.ts`, `keybindings/defaultBindings.ts`, `docs/voice-stt.md`, and the voice tests.

Important scan note:

- The pre-scan summary mentioned `main.tsx` as a reference site. At this base, `rg -n -i voice packages/deep-code/src/main.tsx` returns no match. The active runtime integration appears to be in `screens/REPL.tsx`, `commands.ts`, `state/AppState.tsx`, and the PromptInput/TextInput component chain.
- The broad source scan found 39 files containing `voice`-like text. Two are lexical false positives for P1.7 execution planning: `services/PromptSuggestion/promptSuggestion.ts` (`Claude-voice` style label) and `tools/MCPTool/classifyForCollapse.ts` (`list_invoices`). Excluding those leaves 37 current source files relevant enough to track in the reference inventory below.

### A2. Core voice files

The current voice subsystem core totals 3495 LOC.

| File | LOC | Category | Purpose |
|---|---:|---|---|
| `packages/deep-code/src/services/voiceStreamSTT.ts` | 535 | Anthropic-only | Anthropic `voice_stream` websocket STT client; OAuth token path, private API websocket, Deepgram/Nova route, transcript protocol, finalize timers. |
| `packages/deep-code/src/services/voice.ts` | 525 | Provider-neutral | Local microphone capture and dependency probing; lazy-loads `audio-capture-napi`, SoX, and `arecord`; reusable by local Whisper.cpp if retained. |
| `packages/deep-code/src/services/voiceKeyterms.ts` | 106 | Anthropic-only | Deepgram keyword/keyterm hints for `voice_stream`; no clear local Whisper.cpp equivalent. |
| `packages/deep-code/src/voice/voiceModeEnabled.ts` | 36 | Mixed | Build/runtime gate helper; GrowthBook gate remains, but `hasVoiceAuth()` and `isVoiceModeEnabled()` currently return `false`. |
| `packages/deep-code/src/commands/voice/voice.ts` | 138 | Mixed | `/voice` command; toggles `voiceEnabled`, checks stream availability, checks local mic capture, shows language hints. |
| `packages/deep-code/src/commands/voice/index.ts` | 20 | Mixed | Slash command metadata and availability wrapper using `isVoiceModeEnabled()`. |
| `packages/deep-code/src/context/voice.tsx` | 87 | Provider-neutral | React/zustand-like voice state provider: status, error, interim transcript, audio levels, warmup. |
| `packages/deep-code/src/hooks/useVoice.ts` | 1144 | Mixed | Hold-to-talk recording hook; local audio capture plus Anthropic `voice_stream` connection, retry, replay, transcript injection, analytics. |
| `packages/deep-code/src/hooks/useVoiceIntegration.tsx` | 676 | Provider-neutral | Prompt-input integration, keybinding capture, interim text overlay, focus-mode handling; imports `useVoice` behind `VOICE_MODE`. |
| `packages/deep-code/src/hooks/useVoiceEnabled.ts` | 25 | Mixed | Combines settings intent with auth/runtime voice gate. Currently always disabled because `hasVoiceAuth()` returns false. |
| `packages/deep-code/src/components/PromptInput/VoiceIndicator.tsx` | 136 | Provider-neutral | Prompt input recording/processing indicator and warmup hint UI. |
| `packages/deep-code/src/components/LogoV2/VoiceModeNotice.tsx` | 67 | Mixed | "Voice mode is now available" notice, gated by `isVoiceModeEnabled()` and global notice counters. |

### A3. Current disabled state

The subsystem is not merely hidden by product policy; key runtime functions are hard-disabled:

- `voice/voiceModeEnabled.ts`:
  - `isVoiceGrowthBookEnabled()` still evaluates the `VOICE_MODE` build feature and GrowthBook kill switch.
  - `hasVoiceAuth()` returns `false`.
  - `isVoiceModeEnabled()` returns `false`.
- `services/voiceStreamSTT.ts`:
  - `isVoiceStreamAvailable()` returns `false`.
  - `getVoiceStreamToken()` returns `null`.
- Result:
  - `/voice` returns "Voice mode is not available."
  - `voiceEnabled` cannot be set through ConfigTool because preflight rejects it.
  - UI render paths usually sit behind `feature('VOICE_MODE')` plus `useVoiceEnabled()` or `isVoiceModeEnabled()`.

### A4. Source reference inventory: 37 files

The 37-file list below is the current source voice-reference inventory after excluding the two lexical false positives noted in A1. Categories describe whether each site is Anthropic-only, provider-neutral, or mixed.

#### Hooks, context, and state

| File | Category | Notes |
|---|---|---|
| `context/voice.tsx` | Provider-neutral | State container for voice UI and recording lifecycle. |
| `state/AppState.tsx` | Provider-neutral | Wraps app state with `VoiceProvider` only in `VOICE_MODE` builds; external builds get passthrough. |
| `hooks/useVoice.ts` | Mixed | Contains local audio orchestration but is coupled to `voice_stream`, Deepgram keyterms, OAuth failure handling, retry/replay analytics. |
| `hooks/useVoiceEnabled.ts` | Mixed | Reads settings and `hasVoiceAuth()`; currently makes voice false. |
| `hooks/useVoiceIntegration.tsx` | Provider-neutral | Bridges TextInput/PromptInput to `useVoice`; keybinding and interim text logic can be reused after a provider swap. |
| `hooks/renderPlaceholder.ts` | Provider-neutral | Placeholder rendering references voice-related UI state indirectly. |

#### Services and analytics

| File | Category | Notes |
|---|---|---|
| `services/voiceStreamSTT.ts` | Anthropic-only | Private Anthropic websocket, OAuth bearer auth, `voice_stream` wire protocol, Deepgram route selection. |
| `services/voice.ts` | Provider-neutral | Local mic capture and audio dependency checks; candidate to keep for future local Whisper.cpp. |
| `services/voiceKeyterms.ts` | Anthropic-only | Deepgram keyword hints for the cloud STT endpoint. |
| `services/analytics/datadog.ts` | Mixed | Allows voice telemetry event names such as `tengu_voice_recording_started` and `tengu_voice_toggled`. |

#### CLI, commands, and command output

| File | Category | Notes |
|---|---|---|
| `commands.ts` | Mixed | Registers `voiceCommand` behind `feature('VOICE_MODE')`; command is already absent in public command registry tests. |
| `commands/voice/index.ts` | Mixed | Voice slash command metadata and runtime availability. |
| `commands/voice/voice.ts` | Mixed | `/voice` toggles settings but imports cloud STT availability and local audio checks. |
| `screens/REPL.tsx` | Provider-neutral | Wires voice integration and keybinding handler into the REPL behind `VOICE_MODE`. |
| `utils/messages/mappers.ts` | Provider-neutral | Mentions `/voice` as an example local command output. |
| `entrypoints/sdk/coreSchemas.ts` | Provider-neutral | Mentions `/voice` as an example local slash command transcript item. |
| `utils/suggestions/commandSuggestions.ts` | Provider-neutral | Comment around visible prefix siblings such as `/voice-memo`; no runtime STT dependency. |

#### Config and settings

| File | Category | Notes |
|---|---|---|
| `tools/ConfigTool/ConfigTool.ts` | Mixed | Runtime validation for `voiceEnabled`; imports `voiceModeEnabled`, `voiceStreamSTT`, and `voice.ts`. |
| `tools/ConfigTool/supportedSettings.ts` | Mixed | Registers `voiceEnabled` only when `VOICE_MODE` is built. |
| `tools/ConfigTool/prompt.ts` | Mixed | Hides `voiceEnabled` when voice GrowthBook gate is off. |
| `utils/settings/types.ts` | Mixed | Schema for `voiceEnabled` and language setting text that mentions voice dictation. |
| `utils/config.ts` | Provider-neutral | Tracks voice notice count, language hint count, and footer hint count. |
| `components/LanguagePicker.tsx` | Provider-neutral | User-facing language copy includes voice language. |

#### Keybindings

| File | Category | Notes |
|---|---|---|
| `keybindings/defaultBindings.ts` | Mixed | Registers default `space: voice:pushToTalk` behind `VOICE_MODE`. |
| `keybindings/schema.ts` | Mixed | Declares `voice:pushToTalk` action. |
| `keybindings/validate.ts` | Mixed | Validates `voice:pushToTalk` bindings and warns about warmup text insertion. |

#### Components and UI

| File | Category | Notes |
|---|---|---|
| `components/TextInput.tsx` | Provider-neutral | Reads voice state and renders mini waveform cursor while recording. |
| `components/LogoV2/LogoV2.tsx` | Mixed | Renders `VoiceModeNotice` in multiple logo layouts. |
| `components/LogoV2/VoiceModeNotice.tsx` | Mixed | Notice depends on `isVoiceModeEnabled()` and global counters. |
| `components/PromptInput/VoiceIndicator.tsx` | Provider-neutral | Recording/processing status and warmup hint. |
| `components/PromptInput/PromptInput.tsx` | Provider-neutral | Dims interim voice dictation text. |
| `components/PromptInput/Notifications.tsx` | Provider-neutral | Replaces notifications with voice indicator while recording/processing. |
| `components/PromptInput/PromptInputFooterLeftSide.tsx` | Provider-neutral | Footer hint: "hold {shortcut} to speak"; reads voice state and settings. |
| `components/Spinner/utils.ts` | Provider-neutral | Comment references voice-mode waveform parameters; no dependency. |

#### Tool prompts with lexical "voice"

| File | Category | Notes |
|---|---|---|
| `tools/BashTool/BashTool.tsx` | Provider-neutral | Prompt schema says to write command descriptions in active voice; not STT-specific. |
| `tools/PowerShellTool/PowerShellTool.tsx` | Provider-neutral | Same active-voice wording; not STT-specific. |

### A5. Test fixtures and design doc reference

Tests:

- `packages/deep-code/test/b3-voice-unmount.test.mjs` (54 LOC)
  - Reads `src/components/TextInput.tsx`.
  - Asserts the voice waveform `<Box ref={animRef}>` is conditional.
  - Asserts `needsAnimation = isVoiceRecording && !reducedMotion`.
  - Asserts `BaseTextInput` remains single-site.
- `packages/deep-code/test/deepcode-package.test.mjs`
  - Contains a command-registry assertion that public command sources do not include `voiceCommand ? [voiceCommand]`.

Decision doc:

- `docs/voice-stt.md`
  - `Status: Decided`
  - `Decision date: 2026-05-10`
  - Current plan: replace Anthropic `voice_stream` websocket with bundled local Whisper.cpp.
  - Explicitly says no cloud STT fallback.
  - Requires bundled binaries plus `models/ggml-base.en.bin`.
  - Notes self-use single-user rationale.
  - Lists tests that must exist before P1.7 is complete.

## Phase B — Path options

### B1. Trade-off table

| Path | Scope | Estimated source delta | Package/build impact | Main benefit | Main cost |
|---|---|---:|---|---|---|
| Path A - Pure deletion | Delete all core voice files and strip reference sites. | About 3500 LOC delete plus reference cleanup. | No new assets; post-delete dist refresh only. | Fastest and cleanest removal of disabled Anthropic/cloud voice. | Contradicts current `docs/voice-stt.md` decision and removes reusable local audio work. |
| Path B - Bundled Whisper.cpp | Implement local Whisper.cpp with binaries and model. | Large positive delta; multiple new tests and packaging scripts. | Roughly +200 MB npm package plus binary signing/notarization policy. | Produces working local voice mode and matches current decision doc. | Multi-week infrastructure project outside safe autonomous scope. |
| Path C - Hybrid cloud delete, local shell retained | Delete cloud STT and Deepgram pieces; keep/stub local audio shell and UI gates. | About 2000 LOC net delete; about 1000 LOC retained/stubbed. | No new assets; post-delete dist refresh only. | Removes Anthropic-only risk now while preserving future Whisper.cpp entry point. | Leaves explicit disabled voice residue for a later implementation phase. |

### B2. Path A - Pure deletion

Path A mirrors the P1.3.G teleport deletion pattern.

Actions: delete all 12 core voice files, remove `commands.ts` `voiceCommand` registration, strip REPL/AppState/TextInput/PromptInput/LogoV2/ConfigTool/settings/keybindings/analytics references, delete `b3-voice-unmount.test.mjs`, update `docs/voice-stt.md` from `Status: Decided` to `Status: Cancelled`, then run P1.7.Z.

Pros:

- Minimum residue.
- No package bloat.
- Removes Anthropic `voice_stream`, OAuth, Deepgram, and native audio complexity in one phase.
- Strong precedent in P1.3.F.b and P1.3.G mass deletion.

Cons:

- Directly contradicts the current `docs/voice-stt.md` decision.
- Removes reusable local audio capture that could support future Whisper.cpp.
- Requires wide JSX and settings/keybinding cleanup across many reference sites.
- `/voice` command disappears instead of providing a graceful "unavailable" response.

### B3. Path B - Bundled Whisper.cpp

Path B implements the current `docs/voice-stt.md` decision.

Actions: bundle `whisper-cpp-{darwin-arm64,darwin-x64,linux-x64}` plus `models/ggml-base.en.bin`, pin upstream `ggerganov/whisper.cpp`, add build/sync scripts, rewrite `voiceStreamSTT.ts` as a child-process adapter, migrate `useVoice.ts` off websocket partials, delete `voiceKeyterms.ts`, add binary discovery/cancel/unmount/disabled/e2e tests, and update package-size expectations.

Pros:

- Delivers a working voice mode.
- Aligns with `docs/voice-stt.md`.
- Avoids cloud STT and keeps audio local.

Cons:

- Adds roughly 200 MB to package/install footprint once multiple binaries and a model are included.
- Requires native binary distribution, platform matrix policy, and likely signing/notarization review.
- Requires a model update policy and pinned binary provenance.
- Requires non-trivial streaming/insertion behavior changes because local Whisper.cpp is not a websocket partial-transcript service.
- Too large for the current PR cadence and risky to do autonomously inside Codex without external binary provenance decisions.

### B4. Path C - Hybrid cloud delete, local shell retained

Path C removes Anthropic-only cloud STT now and preserves only the reusable local scaffolding.

Actions: delete `services/voiceStreamSTT.ts` and `services/voiceKeyterms.ts`; keep `services/voice.ts`; keep `voice/voiceModeEnabled.ts` as an explicit disabled gate unless full command deletion is chosen; stub `hooks/useVoice.ts`; keep or simplify `useVoiceIntegration.tsx`; make `/voice` unavailable without cloud imports; update `docs/voice-stt.md` to `Status: Deferred`; adjust tests; then run P1.7.Z.

Pros:

- Removes Anthropic-only `voice_stream` and Deepgram code.
- Preserves reusable local audio capture for a future Whisper.cpp phase.
- Gives the user a clear deferred state rather than a silent contradiction.
- Unblocks P1.8 SDK type-stub cleanup by removing voice-specific Anthropic private API imports and OAuth assumptions.
- Fits the recent "done with residue tracked" cadence: close the unsafe cloud path now, track the local implementation as future work.

Cons:

- Leaves dead or disabled voice UI/settings surfaces unless a follow-up removes them.
- Still requires careful keybinding, ConfigTool, and PromptInput cleanup to avoid broken imports.
- Does not deliver working voice mode.
- Requires a clear decision on whether `/voice` remains as an unavailable command.

## Phase C — Recommended path + rationale

### C1. Recommendation

Recommend **Path C - Hybrid cloud delete, local shell retained**.

### C2. Rationale

Path C is the best fit for the current DeepCode phase because the current runtime is already disabled at three critical points: `hasVoiceAuth()` returns `false`, `isVoiceModeEnabled()` returns `false`, and `isVoiceStreamAvailable()` returns `false`. The code that remains active is mostly infrastructure and residue. Deleting only the Anthropic/cloud STT path removes the highest-risk private API, OAuth, and Deepgram coupling while keeping `services/voice.ts`, the only obvious reusable local asset for a later Whisper.cpp implementation. This aligns with the single-user self-use context in `docs/voice-stt.md`, the aggressive source-delete precedent from P1.3.F.b and P1.3.G, and the downstream P1.8 need to shrink `@anthropic-ai/sdk` and Anthropic-private assumptions. Path B is the desired end-state if the user wants working voice soon, but its binary distribution, model bundling, package-size growth, and signing/provenance policy are outside a safe autonomous Codex cleanup PR. Path A is cleaner than Path C but cancels the existing local-Whisper decision and discards reusable local audio capture prematurely.

### C3. What Path C means operationally

- Treat cloud STT removal as P1.7 source cleanup.
- Treat bundled Whisper.cpp as a future feature phase, not as a cleanup prerequisite.
- Make the disabled state explicit in docs and command behavior.
- Preserve user-data/backward-compat posture by not deleting settings schema unless the user chooses full voice removal.
- Keep each sub-PR compile-safe; if a file deletion would leave imports dangling, remove or stub direct callers in the same sub-PR.

## Phase D — Sub-PR breakdown

### D1. Recommended Path C breakdown

Proposed compile-safe split:

| Sub-PR | Goal | Files likely touched | Expected result |
|---|---|---|---|
| P1.7.a | Delete cloud STT and Deepgram leaf code. | `services/voiceStreamSTT.ts`, `services/voiceKeyterms.ts`, direct imports in `commands/voice/voice.ts`, `tools/ConfigTool/ConfigTool.ts`, and `hooks/useVoice.ts`. | No `voice_stream`, Deepgram, or OAuth STT path remains; `/voice` and ConfigTool return unavailable without cloud imports. |
| P1.7.b | Stub/simplify voice hook runtime. | `hooks/useVoice.ts`, possibly `hooks/useVoiceIntegration.tsx`, `context/voice.tsx`. | Hold-to-talk no-op surface remains compile-safe; no websocket/audio stream is opened. |
| P1.7.c | Update docs and command semantics. | `docs/voice-stt.md`, `commands/voice/*`, `voice/voiceModeEnabled.ts`, settings/help text as needed. | Status becomes `Deferred`; `/voice` behavior is explicitly unavailable, or command removal is decided. |
| P1.7.d | Adjust UI, keybindings, and tests. | PromptInput/TextInput/LogoV2 references, keybindings files, `b3-voice-unmount.test.mjs`, `deepcode-package.test.mjs`. | Tests reflect disabled/deferred voice state; no broken UI imports remain. |
| P1.7.Z | Refresh prebuilt bundle. | `packages/deep-code/dist/deepcode-full.mjs` only. | Dist absorbs source drift after P1.7 source PRs. |

Estimated source delete for Path C:

- Direct leaf deletes: 641 LOC (`voiceStreamSTT.ts` + `voiceKeyterms.ts`).
- Hook simplification: about 1000 LOC net delete if `useVoice.ts` becomes a small no-op facade.
- Integration/UI/test simplification: about 300-500 LOC net delete depending on `/voice` and keybinding decisions.
- Total: about 2000 LOC net source delete, with roughly 1000 LOC preserved/stubbed for future Whisper.cpp.

### D2. Alternative path notes

If the user chooses Path A, keep the same dependency order but delete broader layers: cloud STT services, then hooks/context, then command/settings/keybindings, then UI/tests/docs, followed by P1.7.Z. Estimated net source delete is about 3800-4200 LOC.

If the user chooses Path B, pause source surgery and first decide binary provenance, model choice, supported platforms, package-size budget, signing/notarization, and CI fixture policy. That path needs a separate multi-stage implementation plan before code edits.

## Phase E — Risk assessment

### E1. Whisper.cpp binary distribution and signing

Path B requires native binaries for macOS arm64, macOS x64, and Linux x64, plus a model file. This changes the npm package from source/JS distribution into a binary/model distribution channel. Risks include binary provenance, reproducible builds, macOS signing/notarization, CI artifact handling, package size, unsupported platform behavior, model license, and update cadence.

This is the main reason not to choose Path B for the cleanup phase.

### E2. `audio-capture-napi` native dependency

`services/voice.ts` lazy-loads `audio-capture-napi` and intentionally avoids startup preload because native module loading can block. This file is provider-neutral but still risky:

- The native load can block on first voice keypress.
- Microphone permission behavior differs by OS.
- Linux fallback behavior depends on SoX or `arecord`.
- Testability is limited without a real audio environment.

Path C keeps this file only as future-local-voice scaffolding. If the user chooses Path A, delete it.

### E3. `bun:bundle` feature gate behavior

Many sites use `feature('VOICE_MODE')` to let the bundler remove voice code from external builds. Important sites:

- `voice/voiceModeEnabled.ts`
- `commands.ts`
- `state/AppState.tsx`
- `screens/REPL.tsx`
- `hooks/useVoiceIntegration.tsx`
- PromptInput/TextInput components
- ConfigTool supported settings
- keybinding defaults

Risk:

- Removing only a leaf file can break compile-time `require()` or dynamic imports.
- Replacing gates with runtime conditions can leak strings or imports into external builds.
- Each sub-PR must run the full suite, and source edits must keep the bundler expectations intact.

### E4. Reference-site cascade risk

The 37-file reference inventory spans:

- hooks/context/state;
- services/analytics;
- commands/CLI;
- ConfigTool/settings;
- keybindings;
- REPL;
- TextInput/PromptInput/LogoV2 components;
- tests and docs.

The riskiest edits are JSX and hook edits:

- `screens/REPL.tsx` contains large JSX call sites for `VoiceKeybindingHandler`.
- `components/PromptInput/Notifications.tsx` conditionally replaces notification output with `VoiceIndicator`.
- `components/TextInput.tsx` has a test-locked conditional waveform wrapper.
- `components/PromptInput/PromptInputFooterLeftSide.tsx` mixes hint rendering, global counters, and keybinding display.

### E5. Test fixture impact

`b3-voice-unmount.test.mjs` is not a full voice e2e test. It protects the TextInput waveform optimization. Path C can either:

- retain it if TextInput still has voice-state conditional rendering; or
- replace it with a disabled-state fixture if voice UI is stripped.

`deepcode-package.test.mjs` already asserts that public command sources do not include the voice command registration form. If `/voice` behavior changes, that fixture may need a narrow update.

### E6. `@anthropic-ai/sdk` and OAuth unblock check

The core voice cloud STT path imports OAuth configuration and uses Anthropic private websocket semantics, not merely SDK types:

- `services/voiceStreamSTT.ts` imports `getOauthConfig`.
- It uses Bearer OAuth credentials for the websocket.
- It references private API and `claude.ai` Cloudflare behavior.
- It references Deepgram and conversation-engine GrowthBook flags.

Removing `services/voiceStreamSTT.ts` and `services/voiceKeyterms.ts` materially helps the P1.8 SDK-type-stub direction because it removes one of the remaining Anthropic-private runtime islands.

## Phase F — Key decision points

Before P1.7.a starts, the user should answer these explicitly:

### Q1. Path choice

Confirm Path A, B, or C.

Recommendation: Path C.

Reason: remove the disabled Anthropic/cloud STT path now, keep local audio capture as future Whisper.cpp scaffolding, and avoid binary distribution work in the cleanup phase.

### Q2. `/voice` command behavior

Choose one:

- Remove `/voice` entirely (Path A).
- Keep `/voice` and always return "voice mode is unavailable in this build" (Path C).

Recommendation for Path C: keep `/voice` for one source phase as an explicit unavailable command, then decide after docs/test cleanup whether it should disappear.

### Q3. `services/voice.ts` audio capture

Choose one:

- Delete `services/voice.ts` entirely (Path A).
- Keep it as provider-neutral local audio capture scaffolding (Path C).

Recommendation for Path C: keep `services/voice.ts`, but do not wire it to runtime UI until a local STT adapter exists.

### Q4. `docs/voice-stt.md` status

Choose one:

- `Status: Cancelled` if Path A.
- `Status: Deferred` if Path C.

Recommendation for Path C: `Status: Deferred`, with rationale that cloud STT was removed and local Whisper.cpp is postponed until binary/model distribution is approved.

### Q5. Voice keybinding entries

Choose one:

- Delete `voice:pushToTalk` from `keybindings/{schema,defaultBindings,validate}.ts`.
- Keep the keybinding action gated/no-op while voice is explicitly unavailable.

Recommendation for Path C: remove the default `space` binding immediately, but decide whether to keep the schema action only if `/voice` remains unavailable. A no-op action should not swallow user input.

## Phase G — Reference appendix

### G1. Full path inventory by directory

`services/`

- `services/voiceStreamSTT.ts` - Anthropic websocket STT.
- `services/voice.ts` - local audio capture and dependency probing.
- `services/voiceKeyterms.ts` - Deepgram keyterm hints.
- `services/analytics/datadog.ts` - voice telemetry allowlist.

`voice/`

- `voice/voiceModeEnabled.ts` - build/runtime voice availability gates.

`commands/`

- `commands.ts` - `voiceCommand` registration behind `VOICE_MODE`.
- `commands/voice/index.ts` - command metadata.
- `commands/voice/voice.ts` - command implementation.

`context/`, `state/`, `hooks/`

- `context/voice.tsx` - state provider.
- `state/AppState.tsx` - provider wrapper.
- `hooks/useVoice.ts` - recording/STT hook.
- `hooks/useVoiceEnabled.ts` - settings plus auth gate.
- `hooks/useVoiceIntegration.tsx` - PromptInput integration and keybinding handler.
- `hooks/renderPlaceholder.ts` - UI placeholder helper with voice-related reference.

`screens/`

- `screens/REPL.tsx` - runtime voice integration in REPL.

`components/`

- `components/TextInput.tsx` - waveform cursor and hide-placeholder behavior.
- `components/LogoV2/LogoV2.tsx` - notice render points.
- `components/LogoV2/VoiceModeNotice.tsx` - voice availability notice.
- `components/PromptInput/VoiceIndicator.tsx` - voice indicator and warmup hint.
- `components/PromptInput/PromptInput.tsx` - interim transcript dimming.
- `components/PromptInput/Notifications.tsx` - recording/processing notification override.
- `components/PromptInput/PromptInputFooterLeftSide.tsx` - footer speak hint.
- `components/Spinner/utils.ts` - waveform color comment.
- `components/LanguagePicker.tsx` - language copy mentions voice.

`tools/`

- `tools/ConfigTool/ConfigTool.ts` - voice setting validation.
- `tools/ConfigTool/supportedSettings.ts` - `voiceEnabled` registration.
- `tools/ConfigTool/prompt.ts` - prompt hides unavailable voice setting.
- `tools/BashTool/BashTool.tsx` - active-voice lexical instruction only.
- `tools/PowerShellTool/PowerShellTool.tsx` - active-voice lexical instruction only.

`keybindings/`

- `keybindings/defaultBindings.ts` - default `space` binding.
- `keybindings/schema.ts` - `voice:pushToTalk` action.
- `keybindings/validate.ts` - validation and warning for voice binding.

`utils/`

- `utils/config.ts` - global counters for notices/hints.
- `utils/settings/types.ts` - settings schema and descriptions.
- `utils/messages/mappers.ts` - slash command output example.
- `utils/suggestions/commandSuggestions.ts` - `/voice-memo` comment.

`entrypoints/`

- `entrypoints/sdk/coreSchemas.ts` - slash command transcript example.

`tests/docs`

- `packages/deep-code/test/b3-voice-unmount.test.mjs` - TextInput waveform guard.
- `packages/deep-code/test/deepcode-package.test.mjs` - package/command registry fixture.
- `docs/voice-stt.md` - current decided local Whisper.cpp plan.

### G2. Caller graph

Cloud STT leaf:

- `services/voiceStreamSTT.ts`
  - imports `constants/oauth`, websocket/proxy/mtls/http helpers, GrowthBook cache, slow JSON operations.
  - exported `isVoiceStreamAvailable()` and `connectVoiceStream()` are consumed by:
    - `hooks/useVoice.ts`;
    - `commands/voice/voice.ts`;
    - `tools/ConfigTool/ConfigTool.ts`.

Deepgram keyterms leaf:

- `services/voiceKeyterms.ts`
  - consumed by `hooks/useVoice.ts`.
  - no current evidence of other external consumers.

Audio capture shell:

- `services/voice.ts`
  - consumed by `hooks/useVoice.ts`;
  - consumed by `commands/voice/voice.ts`;
  - consumed by `tools/ConfigTool/ConfigTool.ts`.

Runtime availability:

- `voice/voiceModeEnabled.ts`
  - consumed by `commands/voice/index.ts`;
  - consumed by `commands/voice/voice.ts`;
  - consumed by `hooks/useVoiceEnabled.ts`;
  - consumed by `tools/ConfigTool/ConfigTool.ts`;
  - consumed by `tools/ConfigTool/prompt.ts`;
  - consumed by `components/LogoV2/VoiceModeNotice.tsx`.

Hook integration:

- `context/voice.tsx`
  - consumed by `state/AppState.tsx`, `hooks/useVoice.ts`, `hooks/useVoiceIntegration.tsx`, `components/TextInput.tsx`, `components/PromptInput/Notifications.tsx`, and `components/PromptInput/PromptInputFooterLeftSide.tsx`.
- `hooks/useVoice.ts`
  - consumed by `hooks/useVoiceIntegration.tsx` and `commands/voice/voice.ts` (`normalizeLanguageForSTT`).
- `hooks/useVoiceIntegration.tsx`
  - consumed by `screens/REPL.tsx`.
- `hooks/useVoiceEnabled.ts`
  - consumed by PromptInput and Config/UI paths.

UI:

- `components/PromptInput/VoiceIndicator.tsx`
  - consumed by `components/PromptInput/Notifications.tsx` and `components/PromptInput/PromptInputFooterLeftSide.tsx`.
- `components/LogoV2/VoiceModeNotice.tsx`
  - consumed by `components/LogoV2/LogoV2.tsx`.

Commands/settings:

- `commands/voice/index.ts`
  - consumed by `commands.ts` through `feature('VOICE_MODE')`.
- `voiceEnabled`
  - appears in ConfigTool, settings types, command toggles, and `useVoiceEnabled()`.
- `voice:pushToTalk`
  - appears in keybinding default/schema/validation and `useVoiceIntegration.tsx`.

### G3. Anthropic-only artifact list

Hard Anthropic/cloud artifacts to delete in Path C:

- `services/voiceStreamSTT.ts` file.
- `services/voiceKeyterms.ts` file.
- `VOICE_STREAM_PATH = '/api/ws/speech_to_text/voice_stream'`.
- `VOICE_STREAM_BASE_URL` override.
- `getOauthConfig()` use for voice websocket base URL.
- Bearer OAuth websocket authorization.
- `voice_stream` JSON control messages:
  - `KeepAlive`;
  - `CloseStream`;
  - `TranscriptText`;
  - `TranscriptEndpoint`;
  - `TranscriptError`.
- Conversation-engine and Deepgram routing:
  - `use_conversation_engine`;
  - `stt_provider=deepgram-nova3`;
  - GrowthBook flag `tengu_cobalt_frost`;
  - keyterms query params.
- Cloud STT retry/replay analytics:
  - `tengu_voice_stream_early_retry`;
  - voice-stream-specific early error handling.
- User-facing OAuth/cloud failure text:
  - "Failed to connect to voice_stream (no OAuth token?)".

Provider-neutral artifacts to preserve only if Path C is confirmed:

- Local audio capture in `services/voice.ts`.
- Voice state context shape.
- PromptInput interim transcript model.
- TextInput waveform optimization, if no-op UI remains.
- Keybinding schema only if `/voice` remains unavailable but present.

### G4. Recommended next action

Ask the user to confirm Path C before P1.7.a.

If confirmed, P1.7.a should be a source PR that deletes cloud STT and Deepgram leaf code while keeping the project compiling in the same PR. The first PR must not delete `services/voiceStreamSTT.ts` without also removing or replacing every direct import from `hooks/useVoice.ts`, `commands/voice/voice.ts`, and `tools/ConfigTool/ConfigTool.ts`.
