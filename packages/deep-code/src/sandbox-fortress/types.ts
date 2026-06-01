import type {
  SandboxAskCallback,
  SandboxDependencyCheck,
  SandboxRuntimeConfig,
  SandboxViolationEvent,
} from '@anthropic-ai/sandbox-runtime'

export type FortressRuntimeConfig = SandboxRuntimeConfig
export type FortressViolationEvent = SandboxViolationEvent
export type FortressAskCallback = SandboxAskCallback
export type FortressDependencyCheck = SandboxDependencyCheck

export type RulesetLayer = 'builtin-default' | 'org' | 'agent' | 'user'

export type ResourceKind = 'fs-read' | 'fs-write' | 'net-host' | 'process-exec'

export type RuleAction = 'allow' | 'deny' | 'ask'

export interface FortressRule {
  layer: RulesetLayer
  resource: ResourceKind
  pattern: string
  action: RuleAction
  metadata?: {
    reason?: string
    expiresAt?: number
    sourceFile?: string
    sourceLine?: number
  }
}

export interface FortressRuleset {
  layer: RulesetLayer
  rules: FortressRule[]
}

export type EffortLevel = 'off' | 'high' | 'max'

export type StrictnessLevel = 'lenient' | 'standard' | 'paranoid'

export interface ToolSandboxProfile {
  toolName: string
  fileSystemMode: 'read-only' | 'workspace-write' | 'no-fs'
  /**
   * @deprecated ADVISORY ONLY — NOT a security boundary. `mergeProfileIntoConfig`
   * writes the deny/restrict intent into `customConfig.network`, but the
   * sandbox-runtime HTTP/SOCKS proxy reads its allowlist from GLOBAL init config
   * at process start, not per-call customConfig — so `networkMode: 'deny'` does
   * NOT block outbound traffic. (The only enforced network control today is the
   * process-wide `allowManagedDomainsOnly` policy in adapter/legacy.ts.) A
   * per-call Layer-2 outbound interceptor is needed to make this real (tracked
   * as F2.x). Until then do NOT rely on networkMode to isolate a tool's network
   * access; treat it as a defense-in-depth hint only.
   */
  networkMode: 'allow' | 'deny' | 'allow-with-restrictions'
  additionalDenyPatterns?: string[]
  additionalAllowPatterns?: string[]
}

export interface FortressViolationRecord {
  id: string
  timestamp: number
  event: SandboxViolationEvent
  toolName?: string
  command?: string
  dryRun?: boolean
}

export interface IFortressViolationDb {
  recordViolation(record: FortressViolationRecord): Promise<void>
  listViolations(limit?: number): Promise<FortressViolationRecord[]>
  clearViolations(): Promise<void>
  close(): Promise<void>
}

export interface CacheFriendlyConfigSummary {
  static: string
  dynamic: string
}
