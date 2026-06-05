import {
  SandboxManager as baseSandboxManager,
  type ISandboxManager,
} from '../utils/sandbox/sandbox-adapter.js'
// The pure, node-tested state machine (PR-A) backing the rule-engine methods. This
// is the FIRST live import of the fortress cores; the class is still never
// instantiated (PR-C), so the import remains tree-shaken and dist byte-identical.
import { createFortressManagerState } from './rule-engine/managerState.mjs'
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
    return baseSandboxManager.wrapWithSandbox(
      command,
      binShell,
      customConfig,
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
    return baseSandboxManager.getLinuxGlobPatternWarnings()
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
