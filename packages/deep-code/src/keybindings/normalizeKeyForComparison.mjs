/**
 * Normalize a keybinding string into a canonical form for EQUALITY comparison,
 * so duplicate-detection and reserved-shortcut matching agree with the runtime
 * matcher.
 *
 * Runtime matching (resolver.ts keystrokesEqual / match.ts modifiersMatch)
 * collapses ALT and META into one logical modifier: terminals deliver Alt/Option
 * as key.meta and cannot distinguish the two, so "alt+k" and "meta+k" are the
 * SAME physical key at runtime. This normalizer must collapse them the same way —
 * otherwise validation treats them as distinct and (a) misses a real duplicate
 * ("alt+k" and "meta+k" both bound in one context, where the second silently
 * last-wins) and (b) fails to flag a "meta+X" user binding that collides with a
 * reserved "alt+X" key. cmd/command stays a distinct 'cmd' modifier.
 *
 * @param {string} key
 * @returns {string}
 */
export function normalizeKeyForComparison(key) {
  return key.trim().split(/\s+/).map(normalizeStep).join(' ')
}

function normalizeStep(step) {
  const parts = step.split('+')
  const modifiers = []
  let mainKey = ''

  for (const part of parts) {
    const lower = part.trim().toLowerCase()
    if (
      [
        'ctrl',
        'control',
        'alt',
        'opt',
        'option',
        'meta',
        'cmd',
        'command',
        'shift',
      ].includes(lower)
    ) {
      // Normalize modifier names. alt/opt/option AND meta all collapse to 'alt',
      // mirroring the runtime matcher (alt and meta are one logical modifier).
      if (lower === 'control') modifiers.push('ctrl')
      else if (lower === 'option' || lower === 'opt' || lower === 'meta') {
        modifiers.push('alt')
      } else if (lower === 'command' || lower === 'cmd') modifiers.push('cmd')
      else modifiers.push(lower)
    } else {
      mainKey = lower
    }
  }

  modifiers.sort()
  return [...modifiers, mainKey].join('+')
}
