/**
 * Pure keystroke/chord parsing for the keybinding config, split out so it is
 * node-testable. Produces ParsedKeystroke-shaped objects
 * ({ key, ctrl, alt, shift, meta, super }) and Chord arrays.
 */

/**
 * Parse a keystroke string like "ctrl+shift+k" into a ParsedKeystroke.
 * Supports modifier aliases (ctrl/control, alt/opt/option, meta,
 * cmd/command/super/win). Each '+'-separated part is trimmed before matching so
 * incidental spacing ("ctrl + k") does not leak into the key name.
 *
 * @param {string} input
 * @returns {{key:string, ctrl:boolean, alt:boolean, shift:boolean, meta:boolean, super:boolean}}
 */
export function parseKeystroke(input) {
  const parts = input.split('+')
  const keystroke = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    super: false,
  }
  for (const part of parts) {
    // Trim the part so " shift " / "ctrl " classify as the modifier, not as a
    // key name with embedded whitespace (which would never match a real event).
    const lower = part.trim().toLowerCase()
    switch (lower) {
      case 'ctrl':
      case 'control':
        keystroke.ctrl = true
        break
      case 'alt':
      case 'opt':
      case 'option':
        keystroke.alt = true
        break
      case 'shift':
        keystroke.shift = true
        break
      case 'meta':
        keystroke.meta = true
        break
      case 'cmd':
      case 'command':
      case 'super':
      case 'win':
        keystroke.super = true
        break
      case 'esc':
        keystroke.key = 'escape'
        break
      case 'return':
        keystroke.key = 'enter'
        break
      case 'space':
        keystroke.key = ' '
        break
      case '↑':
        keystroke.key = 'up'
        break
      case '↓':
        keystroke.key = 'down'
        break
      case '←':
        keystroke.key = 'left'
        break
      case '→':
        keystroke.key = 'right'
        break
      default:
        keystroke.key = lower
        break
    }
  }

  return keystroke
}

/**
 * Parse a chord string like "ctrl+k ctrl+s" into an array of ParsedKeystrokes.
 *
 * Chord steps are separated by whitespace ("ctrl+k ctrl+s" = two steps). The '+'
 * inside a step joins modifiers to a key and carries no whitespace meaning, so we
 * first collapse any spaces AROUND a '+' ("ctrl + shift + k" -> "ctrl+shift+k")
 * before splitting on the remaining whitespace. Without this, "ctrl + shift + k"
 * split into five space-separated segments and produced a five-keystroke chord
 * that a real Ctrl+Shift+K (one keystroke) could never match — a binding that
 * silently never fired.
 *
 * @param {string} input
 * @returns {Array<ReturnType<typeof parseKeystroke>>}
 */
export function parseChord(input) {
  // A lone space character IS the space key binding, not a separator.
  if (input === ' ') return [parseKeystroke('space')]
  const normalized = input.replace(/\s*\+\s*/g, '+')
  return normalized.trim().split(/\s+/).map(parseKeystroke)
}
