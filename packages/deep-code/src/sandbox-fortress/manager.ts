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
import { getPlatform } from '../utils/platform.js'
// The pure, node-tested state machine (PR-A) backing the rule-engine methods, and
// the fs-deny projector (PR-D) that turns effective rules into OS-enforceable
// filesystem patterns.
import { createFortressManagerState } from './rule-engine/managerState.mjs'
import {
  fortressLinuxUnenforcedWriteWarnings,
  fortressRulesToFsDelta,
  isEmptyFsDelta,
} from './rule-engine/fsProjector.mjs'
import type {
  CacheFriendlyConfigSummary,
  EffortLevel,
  FortressRule,
  FortressRuleset,
  IFortressViolationDb,
  RulesetLayer,
  StrictnessLevel,
  ToolSandboxProfile,
} from './types.js'

export interface IFortressSandboxManager extends ISandboxManager {
  getRulesetByLayer(layer: RulesetLayer): Promise<FortressRuleset>
  setRuleset(layer: RulesetLayer, rules: FortressRule[]): Promise<void>
  resolveEffectiveRules(): Promise<FortressRule[]>
  enableDryRunMode(enabled: boolean): void
  isDryRunMode(): boolean
  getViolationDb(): IFortressViolationDb
  setEffortLevel(effort: EffortLevel): Promise<void>
  getCurrentEffort(): EffortLevel
  setStrictnessByEffort(
    mapping: Record<EffortLevel, StrictnessLevel>,
  ): Promise<void>
  buildViolationFeedback(): string | null
  buildCacheFriendlyConfigSummary(): CacheFriendlyConfigSummary
  getProfileForTool(toolName: string): ToolSandboxProfile
  setProfileForTool(toolName: string, profile: ToolSandboxProfile): void
}

export class FortressSandboxManager implements IFortressSandboxManager {
  // All rule-engine state + logic lives in the pure factory; each method below is a
  // one-line delegation. The base sandbox methods still delegate to baseSandboxManager.
  readonly #state = createFortressManagerState()

  initialize(
    sandboxAskCallback?: Parameters<ISandboxManager['initialize']>[0],
  ): Promise<void> {
    return baseSandboxManager.initialize(sandboxAskCallback)
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
    const base = baseSandboxManager.getLinuxGlobPatternWarnings()
    // Surface fortress fs-write patterns bubblewrap won't enforce on Linux/WSL (an
    // unsupported glob, or a non-absolute pattern that is never projected), so a deny
    // is never SILENTLY treated as enforced. Gated the same way the base warning is
    // (Linux/WSL + sandbox enabled).
    const platform = getPlatform()
    if ((platform === 'linux' || platform === 'wsl') && this.isSandboxEnabledInSettings()) {
      return [...base, ...fortressLinuxUnenforcedWriteWarnings(this.#state.resolveEffectiveRules())]
    }
    return base
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

  enableDryRunMode(enabled: boolean): void {
    this.#state.enableDryRunMode(enabled)
  }

  isDryRunMode(): boolean {
    return this.#state.isDryRunMode()
  }

  getViolationDb(): IFortressViolationDb {
    return this.#state.getViolationDb()
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
