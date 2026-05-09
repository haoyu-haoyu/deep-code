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
