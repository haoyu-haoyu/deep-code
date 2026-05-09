import {
  SandboxManager as baseSandboxManager,
  type ISandboxManager,
} from '../utils/sandbox/sandbox-adapter.js'
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

function notImplemented(method: string): never {
  throw new Error(
    `FortressSandboxManager.${method} is not implemented in the F0.1 scaffold`,
  )
}

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
  ): Promise<string> {
    return baseSandboxManager.wrapWithSandbox(
      command,
      binShell,
      customConfig,
      abortSignal,
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

  getRulesetByLayer(_layer: RulesetLayer): Promise<FortressRuleset> {
    return notImplemented('getRulesetByLayer')
  }

  setRuleset(
    _layer: RulesetLayer,
    _rules: FortressRule[],
  ): Promise<void> {
    return notImplemented('setRuleset')
  }

  resolveEffectiveRules(): Promise<FortressRule[]> {
    return notImplemented('resolveEffectiveRules')
  }

  enableDryRunMode(_enabled: boolean): void {
    return notImplemented('enableDryRunMode')
  }

  isDryRunMode(): boolean {
    return notImplemented('isDryRunMode')
  }

  getViolationDb(): IFortressViolationDb {
    return notImplemented('getViolationDb')
  }

  setEffortLevel(_effort: EffortLevel): Promise<void> {
    return notImplemented('setEffortLevel')
  }

  getCurrentEffort(): EffortLevel {
    return notImplemented('getCurrentEffort')
  }

  setStrictnessByEffort(
    _mapping: Record<EffortLevel, StrictnessLevel>,
  ): Promise<void> {
    return notImplemented('setStrictnessByEffort')
  }

  buildViolationFeedback(): string | null {
    return notImplemented('buildViolationFeedback')
  }

  buildCacheFriendlyConfigSummary(): CacheFriendlyConfigSummary {
    return notImplemented('buildCacheFriendlyConfigSummary')
  }

  getProfileForTool(_toolName: string): ToolSandboxProfile {
    return notImplemented('getProfileForTool')
  }

  setProfileForTool(
    _toolName: string,
    _profile: ToolSandboxProfile,
  ): void {
    return notImplemented('setProfileForTool')
  }
}
