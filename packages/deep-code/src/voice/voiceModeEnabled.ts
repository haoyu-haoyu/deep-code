// Voice mode runtime gates.
//
// P1.7.a deleted cloud STT; P1.7.b stubbed the voice hook; P1.7.c
// deferred local Whisper.cpp. All three gates return false until a
// future Whisper.cpp adapter reactivates voice (see docs/voice-stt.md).

export function isVoiceGrowthBookEnabled(): boolean {
  return false
}

export function hasVoiceAuth(): boolean {
  return false
}

export function isVoiceModeEnabled(): boolean {
  return false
}
