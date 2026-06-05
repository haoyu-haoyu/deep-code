/**
 * Legacy entry point. The real implementation lives in
 * src/sandbox-fortress/adapter/legacy.ts as part of the DeepCode Sandbox
 * Fortress architecture. This file is kept for backwards compatibility
 * with existing import paths and will be removed in a future major.
 */
export * from '../../sandbox-fortress/adapter/legacy.js'
// F3 wiring PR-C: the live sandbox manager is now the FortressSandboxManager
// instance. This explicit named export shadows the `SandboxManager` that arrives via
// the `export *` above (ESM: an explicit export wins over a star re-export of the
// same name), so all consumers of `SandboxManager` transparently get the fortress.
// The fortress base methods delegate to the legacy base unchanged (inert swap).
export { fortressSandboxManager as SandboxManager } from '../../sandbox-fortress/runtime.js'
