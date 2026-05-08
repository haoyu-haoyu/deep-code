import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const textInputPath = resolve(packageRoot, 'src/components/TextInput.tsx')

test('TextInput conditionally renders the voice waveform Box', () => {
  // The whole point of B3: when voice is idle, the <Box ref={animRef}>
  // wrapper must not be in the React tree. With the wrapper absent,
  // useAnimationFrame's inner useTerminalViewport sees a null elementRef
  // and its useLayoutEffect bails before walking the DOM. That's the
  // per-keystroke saving for every TextInput in the UI.
  const src = readFileSync(textInputPath, 'utf8')
  assert.match(
    src,
    /needsAnimation\s*\?\s*<Box ref=\{animRef\}>/,
    'TextInput must wrap in <Box ref={animRef}> only when needsAnimation is true',
  )
  assert.doesNotMatch(
    src,
    /return\s*<Box ref=\{animRef\}>\s*\n\s*<BaseTextInput/,
    'TextInput must NOT unconditionally wrap BaseTextInput in <Box ref={animRef}>',
  )
})

test('needsAnimation gates voice recording AND reducedMotion', () => {
  // The flag is the single source of truth for whether the waveform path
  // is active. A user with reducedMotion=true must never trigger the
  // animation-frame subscription even while recording — that would
  // re-introduce the cost we're trying to avoid for accessibility users.
  const src = readFileSync(textInputPath, 'utf8')
  assert.match(
    src,
    /needsAnimation\s*=\s*isVoiceRecording\s*&&\s*!reducedMotion/,
    'needsAnimation must combine isVoiceRecording AND !reducedMotion',
  )
})

test('TextInput still uses BaseTextInput exactly once', () => {
  // Sanity: the conditional refactor must not duplicate the BaseTextInput
  // JSX in both branches — we extract it to a local const and reuse.
  // Two copies would double-evaluate the props spread and risk
  // diverging behavior between the recording and idle paths.
  const src = readFileSync(textInputPath, 'utf8')
  const occurrences = (src.match(/<BaseTextInput\b/g) ?? []).length
  assert.equal(
    occurrences,
    1,
    `expected exactly 1 <BaseTextInput> JSX site, found ${occurrences}`,
  )
})
