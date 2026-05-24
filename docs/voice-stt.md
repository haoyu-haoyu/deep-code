# Voice STT replacement plan

Status: Deferred
Decision date: 2026-05-10
Deferral date: 2026-05-25 (P1.7.a-c)

## P1.7 status update (deferred)

P1.7.a (#148, 9e8629f) deleted Anthropic `voice_stream` + Deepgram cloud
STT leaf services. P1.7.b (#149, 5f9fa7f) stubbed the `useVoice` hook to
a no-op facade. P1.7.c marks the local Whisper.cpp implementation as
deferred: the cloud STT path is gone, but bundling Whisper.cpp binaries
plus the ~140 MB model and managing macOS signing/notarization is a
standalone feature project, not a Phase 1 cleanup deliverable.

Until the deferred phase reactivates voice, `/voice` returns
"voice mode is unavailable in this build", `hasVoiceAuth()` and
`isVoiceModeEnabled()` and `isVoiceGrowthBookEnabled()` all return false,
and `services/voice.ts` audio capture is retained as future Whisper.cpp
scaffolding (per design Q3).

## Summary

Replace Anthropic's private `voice_stream` websocket (claude.ai OAuth) with
**bundled local Whisper.cpp**. No cloud STT alternative.

## Architecture

- STT runs **fully local** — audio never leaves the user's machine.
- Whisper.cpp binary plus chosen Whisper model are **bundled with the npm
  package** (per Q5.2=b).
- DeepCode TUI captures microphone audio, pipes to bundled Whisper.cpp
  binary, receives transcribed text, submits as prompt.

## Bundled assets

- `bin/whisper-cpp-darwin-arm64`, `bin/whisper-cpp-darwin-x64`,
  `bin/whisper-cpp-linux-x64` — built from upstream `ggerganov/whisper.cpp`
  at a pinned tag.
- `models/ggml-base.en.bin` (~140 MB) — small enough to ship, accurate
  enough for English coding-domain prompts.
- The npm package install size grows by ~150 MB. Acceptable for self-use.

## Disabled state

- If Whisper binary fails to launch (e.g., unsupported platform like Windows
  ARM), voice mode is silently disabled.
- TUI does not show the voice button.
- `/voice` slash command prints `voice mode is unavailable on this platform`.
- No fallback to cloud STT (see Removed cloud options).

## Cancellation and unmount

- User presses `Esc` while recording. Child process killed via `SIGTERM`,
  partial transcription discarded.
- User unmounts voice component. Child process killed.
- `b3-voice-unmount.test.mjs` covers unmount cleanup.

## Removed cloud STT options

- **No Deepgram integration.** The original Anthropic flow used Deepgram
  for streaming partials; we drop this entirely.
- **No OpenAI Whisper API integration.**
- **No DeepSeek STT** (DeepSeek does not currently offer a public STT API).

Rationale: self-use single-user, local Whisper is sufficient. Adding cloud
paths means additional auth surface, privacy considerations, and dependency
on third-party uptime.

## Removed surfaces

- `voiceStreamSTT.ts` — Anthropic websocket client deleted entirely.
- claude.ai OAuth requirement for voice — deleted with the auth flow.
- Deepgram client (if any) — deleted.

## Tests required before P1.7

- Whisper binary discovery: bundled binary path resolves on macOS arm64,
  macOS x64, Linux x64.
- Cancellation: recording for 3 s, press Esc, child process exits within 1 s.
- Unmount: mount voice component, start recording, unmount. No orphaned
  child process.
- Disabled state: rename binary path. `/voice` shows unavailable message,
  no crash.
- End-to-end: 5 s clip. Whisper returns text. TUI inserts as prompt.

## Phase 1 unblock

P1.7.a-c (2026-05-24/25) executed cloud STT delete + hook stub + docs
deferral. Local Whisper.cpp implementation is deferred to a separate
feature phase. Phase 1 advances to P1.7.d (voice UI/keybinding cleanup)
then P1.8.
