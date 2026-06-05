// Import the BASE adapter DIRECTLY from legacy.ts, NOT via the barrel — the barrel
// now re-exports THIS fortress instance as `SandboxManager` (PR-C), so importing the
// base through the barrel would form a runtime→barrel→runtime self-cycle. legacy.ts
// is the pure base and never imports manager/runtime, so this stays acyclic.
import {
  SandboxManager as baseSandboxManager,
  getSandboxBaseRuntimeConfig,
  type ISandboxManager,
} from './adapter/legacy.js'
import { mergeFortressFsDeltaIntoConfig } from './adapter/per-tool-profiles.js'
import { applyFortressConfigFromSettings } from './adapter/fortressConfigLoader.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import { logForDebugging } from '../utils/debug.js'
// The pure, node-tested state machine (PR-A) backing the rule-engine methods, and
// the fs-deny projector (PR-D) that turns effective rules into OS-enforceable
// filesystem patterns.
import { createFortressManagerState } from './rule-engine/managerState.mjs'
import {
  fortressUnenforcedWriteWarnings,
  fortressRulesToFsDelta,
  isEmptyFsDelta,
} from './rule-engine/fsProjector.mjs'
import type {
  CacheFriendlyConfigSummary,
  EffortLevel,
  FortressDecisionResult,
  FortressRule,
  FortressRuleset,
  FortressViolationRecord,
  IFortressViolationDb,
  ResourceKind,
  RulesetLayer,
  StrictnessLevel,
  ToolSandboxProfile,
} from './types.js'

export interface IFortressSandboxManager extends ISandboxManager {
  getRulesetByLayer(layer: RulesetLayer): Promise<FortressRuleset>
  setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void>
  resolveEffectiveRules(): Promise<FortressRule[]>
  resolveFortressDecision(resource: ResourceKind, target: string): FortressDecisionResult
  enableDryRunMode(enabled: boolean): void
  isDryRunMode(): boolean
  getViolationDb(): IFortressViolationDb
  recordFortressViolation(record: FortressViolationRecord): void
  setEffortLevel(effort: EffortLevel): Promise<void>
  getCurrentEffort(): EffortLevel
  setStrictnessByEffort(
    mapping: Record<EffortLevel, StrictnessLevel>,
  ): Promise<void>
  buildViolationFeedback(): string | null
  buildCacheFriendlyConfigSummary(): CacheFriendlyConfigSummary
  getFortressUnenforcedWriteWarnings(): string[]
  getProfileForTool(toolName: string): ToolSandboxProfile
  setProfileForTool(toolName: string, profile: ToolSandboxProfile): void
}

export class FortressSandboxManager implements IFortressSandboxManager {
  // All rule-engine state + logic lives in the pure factory; each method below is a
  // one-line delegation. The base sandbox methods still delegate to baseSandboxManager.
  readonly #state = createFortressManagerState()
  #fortressConfigSubscribed = false

  initialize(
    sandboxAskCallback?: Parameters<ISandboxManager['initialize']>[0],
  ): Promise<void> {
    // After the base sandbox initializes, load the fortress rules/effort from settings
    // (PR-E — this is what activates enforcement) and reload them on any settings
    // change (subscribed once). Loading is best-effort: a failure never blocks init.
    return baseSandboxManager.initialize(sandboxAskCallback).then(() => {
      this.#loadFortressConfig()
      if (!this.#fortressConfigSubscribed) {
        this.#fortressConfigSubscribed = true
        settingsChangeDetector.subscribe(() => this.#loadFortressConfig())
      }
    })
  }

  #loadFortressConfig(): void {
    try {
      const warnings = applyFortressConfigFromSettings(this, getSettings_DEPRECATED())
      for (const warning of warnings) {
        logForDebugging(`[fortress config] ${warning}`)
      }
    } catch (error) {
      logForDebugging(`[fortress config] failed to apply settings.fortress: ${error}`)
    }
  }

  isSupportedPlatform(): boolean {
    return baseSandboxManager.isSupportedPlatform()
  }

  isPlatformInEnabledList(): boolean {
    return baseSandboxManager.isPlatformInEnabledList()
  }

  getSandboxUnavailableReason(): string | undefined {
    return baseSandboxManager.getSandboxUnavailableReason()
  }

  isSandboxingEnabled(): boolean {
    return baseSandboxManager.isSandboxingEnabled()
  }

  isSandboxEnabledInSettings(): boolean {
    return baseSandboxManager.isSandboxEnabledInSettings()
  }

  checkDependencies(): ReturnType<ISandboxManager['checkDependencies']> {
    return baseSandboxManager.checkDependencies()
  }

  isAutoAllowBashIfSandboxedEnabled(): boolean {
    return baseSandboxManager.isAutoAllowBashIfSandboxedEnabled()
  }

  areUnsandboxedCommandsAllowed(): boolean {
    return baseSandboxManager.areUnsandboxedCommandsAllowed()
  }

  isSandboxRequired(): boolean {
    return baseSandboxManager.isSandboxRequired()
  }

  areSandboxSettingsLockedByPolicy(): boolean {
    return baseSandboxManager.areSandboxSettingsLockedByPolicy()
  }

  setSandboxSettings(
    options: Parameters<ISandboxManager['setSandboxSettings']>[0],
  ): Promise<void> {
    return baseSandboxManager.setSandboxSettings(options)
  }

  getFsReadConfig(): ReturnType<ISandboxManager['getFsReadConfig']> {
    return baseSandboxManager.getFsReadConfig()
  }

  getFsWriteConfig(): ReturnType<ISandboxManager['getFsWriteConfig']> {
    return baseSandboxManager.getFsWriteConfig()
  }

  getNetworkRestrictionConfig(): ReturnType<
    ISandboxManager['getNetworkRestrictionConfig']
  > {
    return baseSandboxManager.getNetworkRestrictionConfig()
  }

  getAllowUnixSockets(): ReturnType<ISandboxManager['getAllowUnixSockets']> {
    return baseSandboxManager.getAllowUnixSockets()
  }

  getAllowLocalBinding(): ReturnType<ISandboxManager['getAllowLocalBinding']> {
    return baseSandboxManager.getAllowLocalBinding()
  }

  getIgnoreViolations(): ReturnType<ISandboxManager['getIgnoreViolations']> {
    return baseSandboxManager.getIgnoreViolations()
  }

  getEnableWeakerNestedSandbox(): ReturnType<
    ISandboxManager['getEnableWeakerNestedSandbox']
  > {
    return baseSandboxManager.getEnableWeakerNestedSandbox()
  }

  getExcludedCommands(): string[] {
    return baseSandboxManager.getExcludedCommands()
  }

  getProxyPort(): number | undefined {
    return baseSandboxManager.getProxyPort()
  }

  getSocksProxyPort(): number | undefined {
    return baseSandboxManager.getSocksProxyPort()
  }

  getLinuxHttpSocketPath(): string | undefined {
    return baseSandboxManager.getLinuxHttpSocketPath()
  }

  getLinuxSocksSocketPath(): string | undefined {
    return baseSandboxManager.getLinuxSocksSocketPath()
  }

  waitForNetworkInitialization(): Promise<boolean> {
    return baseSandboxManager.waitForNetworkInitialization()
  }

  wrapWithSandbox(
    command: Parameters<ISandboxManager['wrapWithSandbox']>[0],
    binShell?: Parameters<ISandboxManager['wrapWithSandbox']>[1],
    customConfig?: Parameters<ISandboxManager['wrapWithSandbox']>[2],
    abortSignal?: Parameters<ISandboxManager['wrapWithSandbox']>[3],
    toolName?: string,
  ): Promise<string> {
    // F3 PR-D — fs-deny enforcement. Project the effective fortress rules to the
    // OS-enforceable filesystem deltas.
    const fsDelta = fortressRulesToFsDelta(this.#state.resolveEffectiveRules())
    // INERT / no fortress fs rules (the default state): pass the UNTOUCHED
    // customConfig so the wrapped command is byte-identical to the pre-fortress path.
    // Synthesizing empty arrays here would alter the wrapped command vs `undefined`.
    if (isEmptyFsDelta(fsDelta)) {
      return baseSandboxManager.wrapWithSandbox(
        command,
        binShell,
        customConfig,
        abortSignal,
        toolName,
      )
    }
    // Union the fortress deltas onto the settings BASE (R5: never replace — the
    // runtime REPLACES customConfig.filesystem.<arr> per field, so the merged config
    // must carry base ∪ custom ∪ fortress or the settings denylist would be dropped).
    const merged = mergeFortressFsDeltaIntoConfig(
      fsDelta,
      customConfig,
      getSandboxBaseRuntimeConfig(),
    )
    return baseSandboxManager.wrapWithSandbox(
      command,
      binShell,
      merged,
      abortSignal,
      toolName,
    )
  }

  cleanupAfterCommand(): void {
    baseSandboxManager.cleanupAfterCommand()
  }

  getSandboxViolationStore(): ReturnType<
    ISandboxManager['getSandboxViolationStore']
  > {
    return baseSandboxManager.getSandboxViolationStore()
  }

  annotateStderrWithSandboxFailures(
    command: string,
    stderr: string,
  ): string {
    return baseSandboxManager.annotateStderrWithSandboxFailures(command, stderr)
  }

  getLinuxGlobPatternWarnings(): string[] {
    // Base Linux/WSL settings-glob warnings only. The fortress's own unenforced-write
    // warnings are CROSS-PLATFORM (a non-projectable fs-write deny isn't enforced for
    // shell commands on any platform), so they live in getFortressUnenforcedWriteWarnings
    // below — not gated to Linux — and are surfaced by the doctor on every platform.
    return baseSandboxManager.getLinuxGlobPatternWarnings()
  }

  getFortressUnenforcedWriteWarnings(): string[] {
    // The fortress fs-write deny patterns NOT projected to the OS sandbox (glob /
    // relative / non-absolute) → not enforced for SHELL (Bash) commands on ANY platform
    // (they ARE enforced for the file tools via the per-call hook). Cross-platform;
    // gated only on sandboxing being enabled (matching the base warning's enabled gate).
    if (!this.isSandboxEnabledInSettings()) return []
    return fortressUnenforcedWriteWarnings(this.#state.resolveEffectiveRules())
  }

  refreshConfig(): void {
    baseSandboxManager.refreshConfig()
  }

  reset(): Promise<void> {
    return baseSandboxManager.reset()
  }

  // ── rule-engine methods (delegated to the pure state machine) ───────────────
  // Methods declared Promise<…> by the interface wrap the sync state call in
  // Promise.resolve (the interface is async-shaped so a future persistent backend
  // can be swapped in without a signature change).

  getRulesetByLayer(layer: RulesetLayer): Promise<FortressRuleset> {
    return Promise.resolve(this.#state.getRulesetByLayer(layer))
  }

  setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void> {
    this.#state.setRuleset(layer, rules)
    return Promise.resolve()
  }

  resolveEffectiveRules(): Promise<FortressRule[]> {
    return Promise.resolve(this.#state.resolveEffectiveRules())
  }

  // The faithful per-call decision for a concrete absolute target (PR-F file-tool hook):
  // deny-first absolute over the current rules, with the effort/strictness no-match
  // default. Sync (no OS round-trip). The pure state method is itself fail-safe.
  resolveFortressDecision(resource: ResourceKind, target: string): FortressDecisionResult {
    return this.#state.resolveDecision({ resource, target })
  }

  enableDryRunMode(enabled: boolean): void {
    this.#state.enableDryRunMode(enabled)
  }

  isDryRunMode(): boolean {
    return this.#state.isDryRunMode()
  }

  getViolationDb(): IFortressViolationDb {
    return this.#state.getViolationDb()
  }

  // Record a fortress violation (PR-F file-tool deny / dry-run). Feeds BOTH the async
  // canonical DB and the sync mirror that buildViolationFeedback reads.
  recordFortressViolation(record: FortressViolationRecord): void {
    this.#state.recordFortressViolation(record)
  }

  setEffortLevel(effort: EffortLevel): Promise<void> {
    this.#state.setEffortLevel(effort)
    return Promise.resolve()
  }

  getCurrentEffort(): EffortLevel {
    return this.#state.getCurrentEffort()
  }

  setStrictnessByEffort(
    mapping: Record<EffortLevel, StrictnessLevel>,
  ): Promise<void> {
    this.#state.setStrictnessByEffort(mapping)
    return Promise.resolve()
  }

  buildViolationFeedback(): string | null {
    return this.#state.buildViolationFeedback()
  }

  buildCacheFriendlyConfigSummary(): CacheFriendlyConfigSummary {
    return this.#state.buildCacheFriendlyConfigSummary()
  }

  getProfileForTool(toolName: string): ToolSandboxProfile {
    return this.#state.getProfileForTool(toolName)
  }

  setProfileForTool(toolName: string, profile: ToolSandboxProfile): void {
    this.#state.setProfileForTool(toolName, profile)
  }
}
