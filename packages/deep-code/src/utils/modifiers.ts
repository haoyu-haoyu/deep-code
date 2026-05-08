export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // Load module in background
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prewarm } = require('modifiers-napi') as { prewarm: () => void }
    prewarm()
  } catch {
    // Ignore errors during prewarm
  }
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 *
 * Returns false on platforms other than darwin, and also returns false when
 * the optional `modifiers-napi` native dependency is not installed/loadable
 * — the bundled CLI does not ship it. Returning false (instead of throwing)
 * keeps Enter handling reliable in Apple Terminal: handleEnter calls this to
 * detect Shift+Return, and a thrown require error here used to silently
 * abort the entire submit path because it propagated out of the React
 * event handler.
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  try {
    // Dynamic import to avoid loading native module at top level
    const { isModifierPressed: nativeIsModifierPressed } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('modifiers-napi') as { isModifierPressed: (m: string) => boolean }
    return nativeIsModifierPressed(modifier)
  } catch {
    return false
  }
}
