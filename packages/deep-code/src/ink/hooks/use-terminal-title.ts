import { useContext, useEffect } from 'react'
import stripAnsi from 'strip-ansi'
import { OSC, osc } from '../termio/osc.js'
import { stripOscControlChars } from '../termio/stripOscControlChars.mjs'
import { TerminalWriteContext } from '../useTerminalNotification.js'

/**
 * Declaratively set the terminal tab/window title.
 *
 * Pass a string to set the title. ANSI escape sequences are stripped
 * automatically so callers don't need to know about terminal encoding.
 * Pass `null` to opt out — the hook becomes a no-op and leaves the
 * terminal title untouched.
 *
 * On Windows, uses `process.title` (classic conhost doesn't support OSC).
 * Elsewhere, writes OSC 0 (set title+icon) via Ink's stdout.
 */
export function useTerminalTitle(title: string | null): void {
  const writeRaw = useContext(TerminalWriteContext)

  useEffect(() => {
    if (title === null || !writeRaw) return

    // stripAnsi removes well-formed ANSI sequences but NOT a bare BEL (0x07),
    // which would prematurely terminate the OSC 0 title; stripOscControlChars
    // removes any residual control bytes (BEL, lone ESC) so the title can't be split.
    const clean = stripOscControlChars(stripAnsi(title))

    if (process.platform === 'win32') {
      process.title = clean
    } else {
      writeRaw(osc(OSC.SET_TITLE_AND_ICON, clean))
    }
  }, [title, writeRaw])
}
