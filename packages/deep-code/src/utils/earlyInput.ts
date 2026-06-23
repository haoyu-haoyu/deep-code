/**
 * Early Input Capture
 *
 * This module captures terminal input that is typed before the REPL is fully
 * initialized. Users often type `claude` and immediately start typing their
 * prompt, but those early keystrokes would otherwise be lost during startup.
 *
 * Usage:
 * 1. Call startCapturingEarlyInput() as early as possible in cli.tsx
 * 2. When REPL is ready, call consumeEarlyInput() to get any buffered text
 * 3. stopCapturingEarlyInput() is called automatically when input is consumed
 */

import { processEarlyInputChunk } from './earlyInputChunk.mjs'
import { lastGrapheme } from './intl.js'

// Buffer for early input characters
let earlyInputBuffer = ''
// Flag to track if we're currently capturing
let isCapturing = false
// Reference to the readable handler so we can remove it later
let readableHandler: (() => void) | null = null

/**
 * Start capturing stdin data early, before the REPL is initialized.
 * Should be called as early as possible in the startup sequence.
 *
 * Only captures if stdin is a TTY (interactive terminal).
 */
export function startCapturingEarlyInput(): void {
  // Only capture in interactive mode: stdin must be a TTY, and we must not
  // be in print mode. Raw mode disables ISIG (terminal Ctrl+C → SIGINT),
  // which would make -p uninterruptible.
  if (
    !process.stdin.isTTY ||
    isCapturing ||
    process.argv.includes('-p') ||
    process.argv.includes('--print')
  ) {
    return
  }

  isCapturing = true
  earlyInputBuffer = ''

  // Set stdin to raw mode and use 'readable' event like Ink does
  // This ensures compatibility with how the REPL will handle stdin later
  try {
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.ref()

    readableHandler = () => {
      let chunk = process.stdin.read()
      while (chunk !== null) {
        if (typeof chunk === 'string') {
          processChunk(chunk)
        }
        chunk = process.stdin.read()
      }
    }

    process.stdin.on('readable', readableHandler)
  } catch {
    // If we can't set raw mode, just silently continue without early capture
    isCapturing = false
  }
}

/**
 * Process a chunk of input data.
 *
 * The byte-folding (including the escape-sequence skip — arrow/function keys,
 * focus events, bracketed-paste markers) lives in a pure, node-tested leaf; this
 * wrapper applies the result and acts on any control signal. Ctrl+C exits here
 * (not via gracefulShutdown) because at this early startup stage the shutdown
 * machinery isn't initialized yet.
 */
function processChunk(str: string): void {
  const { buffer, control } = processEarlyInputChunk(
    earlyInputBuffer,
    str,
    lastGrapheme,
  )
  earlyInputBuffer = buffer

  if (control === 'sigint') {
    stopCapturingEarlyInput()
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(130) // Standard exit code for Ctrl+C
  } else if (control === 'eof') {
    stopCapturingEarlyInput()
  }
}

/**
 * Stop capturing early input.
 * Called automatically when input is consumed, or can be called manually.
 */
export function stopCapturingEarlyInput(): void {
  if (!isCapturing) {
    return
  }

  isCapturing = false

  if (readableHandler) {
    process.stdin.removeListener('readable', readableHandler)
    readableHandler = null
  }

  // Don't reset stdin state - the REPL's Ink App will manage stdin state.
  // If we call setRawMode(false) here, it can interfere with the REPL's
  // own stdin setup which happens around the same time.
}

/**
 * Consume any early input that was captured.
 * Returns the captured input and clears the buffer.
 * Automatically stops capturing when called.
 */
export function consumeEarlyInput(): string {
  stopCapturingEarlyInput()
  const input = earlyInputBuffer.trim()
  earlyInputBuffer = ''
  return input
}

/**
 * Check if there is any early input available without consuming it.
 */
export function hasEarlyInput(): boolean {
  return earlyInputBuffer.trim().length > 0
}

/**
 * Seed the early input buffer with text that will appear pre-filled
 * in the prompt input when the REPL renders. Does not auto-submit.
 */
export function seedEarlyInput(text: string): void {
  earlyInputBuffer = text
}

/**
 * Check if early input capture is currently active.
 */
export function isCapturingEarlyInput(): boolean {
  return isCapturing
}
