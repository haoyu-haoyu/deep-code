import { FortressSandboxManager } from './manager.js'

/**
 * The single live FortressSandboxManager instance (F3 wiring PR-C).
 *
 * This module sits strictly ABOVE adapter/legacy.ts in the import graph: legacy.ts
 * is the pure base adapter (it imports the sandbox-runtime SandboxManager and never
 * imports manager/runtime/the barrel), manager.ts imports its base directly from
 * legacy.ts, and this file performs the one `new`. The barrel
 * (utils/sandbox/sandbox-adapter.ts) re-exports this instance UNDER THE NAME
 * `SandboxManager`, so every consumer transparently talks to the fortress without a
 * call-site change. Instantiating here is what pulls manager + managerState + the
 * three cores into the bundle (an expected, one-time dist growth).
 *
 * NOTE (PR-C is an INERT swap): the fortress's base sandbox methods delegate to the
 * legacy base unchanged, and the rule-engine methods are inert with no rulesets set
 * + effort 'off', so runtime behavior — and the wrapped-command string — is identical
 * to the pre-swap legacy singleton. Enforcement (feeding resolved rules into the
 * wrapped command) lands in a later PR.
 */
export const fortressSandboxManager = new FortressSandboxManager()
