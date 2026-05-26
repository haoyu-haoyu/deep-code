/**
 * P1.10.B.0 local feature flag compatibility shim.
 *
 * Path C in P1_10_DESIGN.md moves callers from the GrowthBook-backed
 * implementation to this vendor-free boundary before deleting the old runtime.
 * During migration, keep the GrowthBook-compatible API shape but make all
 * reads resolve to caller-owned defaults and all lifecycle hooks safe no-ops.
 */

export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: unknown
}

type FeatureFlagRefreshListener = () => void | Promise<void>

export function onGrowthBookRefresh(
  listener: FeatureFlagRefreshListener,
): () => void {
  void listener
  return () => {}
}

export function hasGrowthBookEnvOverride(feature: string): boolean {
  void feature
  return false
}

export function getAllGrowthBookFeatures(): Record<string, unknown> {
  return {}
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return {}
}

export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  void feature
  void value
}

export function clearGrowthBookConfigOverrides(): void {}

export function getApiBaseUrlHost(): string | undefined {
  return undefined
}

export async function initializeGrowthBook(): Promise<null> {
  return null
}

export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  void feature
  return defaultValue
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  void feature
  return defaultValue
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  refreshIntervalMs: number,
): T {
  void feature
  void refreshIntervalMs
  return defaultValue
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  void gate
  return false
}

export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  void gate
  return false
}

export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  void gate
  return false
}

export function refreshGrowthBookAfterAuthChange(): void {}

export function resetGrowthBook(): void {}

export async function refreshGrowthBookFeatures(): Promise<void> {}

export function setupPeriodicGrowthBookRefresh(): void {}

export function stopPeriodicGrowthBookRefresh(): void {}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  void configName
  return defaultValue
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  void configName
  return defaultValue
}
