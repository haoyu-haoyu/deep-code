Voice STT replacement plan

Status: Decided
Decision date: 2026-05-10

Summary

Replace Anthropic's private voice_stream websocket (claude.ai OAuth) with
bundled local Whisper.cpp by default plus Deepgram cloud as an explicit
opt-in transport.

Architecture

- Default Whisper STT runs fully local — audio never leaves the user's
machine in the default transport.
- Whisper.cpp binary + chosen Whisper model are bundled with the npm
package (per Q5.2=b).
- DeepCode TUI captures microphone audio → pipes to bundled Whisper.cpp
binary → receives transcribed text → submits as prompt.
- If the active profile opts into Deepgram, DeepCode streams microphone
audio to Deepgram using a user-provided `DEEPGRAM_API_KEY` instead of the
local Whisper transport; this is the only STT mode where microphone audio
leaves the machine.

Bundled assets

- bin/whisper-cpp-darwin-arm64, bin/whisper-cpp-darwin-x64,
bin/whisper-cpp-linux-x64 — built from upstream ggerganov/whisper.cpp
at a pinned tag.
- models/ggml-tiny.en.bin (~75 MB) — below GitHub's 100 MiB file limit,
  small enough to ship, accurate enough for self-use coding prompts.
- The npm package install size grows by ~85 MB. Acceptable for self-use.
- Any later move to `ggml-base.en.bin` or a larger model requires adding
  Git LFS or an external artifact download/verification plan before P1.7
  can land.
- P1.7 updates `packages/deep-code/package.json` `files` to include `bin/`
and `models/`, then verifies `npm pack --dry-run` includes the selected
Whisper binaries and model.

Disabled state

- If Whisper binary fails to launch (e.g., unsupported platform like Windows
ARM), voice mode is silently disabled.
- TUI does not show the voice button.
- /voice slash command prints voice mode is unavailable on this platform.
- No automatic fallback to cloud STT. Deepgram is used only when explicitly
configured.

Cancellation and unmount

- User presses Esc while recording → child process killed via SIGTERM,
partial transcription discarded.
- User unmounts voice component → child process killed.
- Existing `b3-voice-unmount.test.mjs` covers TextInput waveform rendering
only. P1.7 must add or extend tests with a fake STT child process and assert
unmount kills it without leaving an orphan.

Cloud STT opt-in

- Deepgram is supported as an opt-in transport only.
- Required env var: `DEEPGRAM_API_KEY`.
- Required config field: `voice.stt_transport = "deepgram"` in
`~/.deepcode/config.json`.
- `DEEPGRAM_API_KEY` is a secret and must be added to subprocess/env scrub
filters before the Deepgram transport lands. Bash, MCP stdio, LSP, and hooks
must not inherit it.
- Missing Deepgram key with Deepgram selected disables voice mode with a
clear unavailable message.
- No OpenAI Whisper API integration.
- No DeepSeek STT (DeepSeek does not currently offer a public STT API).

Rationale: self-use single-user, local Whisper is the default. Deepgram is
kept only as an explicit opt-in path to preserve the Phase 0 prerequisite
and streaming-partial option without making cloud STT the default.

Removed surfaces

- voiceStreamSTT.ts — Anthropic websocket client deleted entirely.
- claude.ai OAuth requirement for voice — deleted with the auth flow.
- Anthropic-owned Deepgram partial-streaming glue — deleted or rewritten
behind the DeepCode STT transport interface.

Tests required before P1.7

- Whisper binary discovery: bundled binary path resolves on macOS arm64,
macOS x64, Linux x64.
- Cancellation: recording for 3 s, press Esc, child process exits within 1 s.
- Unmount: mount voice component with fake STT child process, start recording,
unmount → child process receives SIGTERM and no orphaned child process remains.
- Disabled state: rename binary path → /voice shows unavailable message,
no crash.
- Deepgram opt-in: `voice.stt_transport = "deepgram"` + `DEEPGRAM_API_KEY`
uses the Deepgram transport; missing key disables voice with a clear
message.
- Secret scrub: with `DEEPGRAM_API_KEY` set, Bash/MCP/hooks/LSP child env
does not receive the variable.
- Packaging: `npm pack --dry-run` lists `bin/whisper-cpp-*` and
`models/ggml-tiny.en.bin`.
- End-to-end: 5 s clip → Whisper returns text → TUI inserts as prompt.

Phase 1 unblock

This decision unblocks P1.7 (replace voice STT).
