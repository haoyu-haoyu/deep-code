import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../../tools/WebFetchTool/prompt.js'
import type { ToolSandboxProfile } from '../types.js'

/**
 * Per-tool sandbox profiles.
 *
 * Enforcement scope (F1.2):
 *   - fileSystemMode is FULLY enforced via customConfig per call.
 *     `read-only`, `workspace-write`, and `no-fs` correctly translate
 *     into SandboxRuntimeConfig.filesystem before wrapWithSandbox runs
 *     the sandbox-exec wrapper.
 *
 *   - networkMode is partially enforced (deny/restrict patterns are
 *     written into customConfig.network) but NOT enforced at the proxy
 *     level. The sandbox-runtime HTTP/SOCKS proxy reads its allowlist
 *     from global init config at process start, not per-call
 *     customConfig. As a result, `networkMode: 'deny'` cannot block
 *     outbound traffic until a Layer 2 outbound interceptor is added.
 *     Tracked as F2.x in EXECUTION_LOG.md.
 *
 * Until F2.x lands: callers must NOT rely on networkMode for security
 * boundaries; treat it as a defense-in-depth flag, not a guarantee.
 */
export const TOOL_PROFILES: Record<string, ToolSandboxProfile> = {
  [BASH_TOOL_NAME]: {
    toolName: BASH_TOOL_NAME,
    fileSystemMode: 'workspace-write',
    networkMode: 'allow',
    additionalDenyPatterns: [],
  },
  [FILE_READ_TOOL_NAME]: {
    toolName: FILE_READ_TOOL_NAME,
    fileSystemMode: 'read-only',
    networkMode: 'deny',
  },
  [FILE_EDIT_TOOL_NAME]: {
    toolName: FILE_EDIT_TOOL_NAME,
    fileSystemMode: 'workspace-write',
    networkMode: 'deny',
  },
  [WEB_FETCH_TOOL_NAME]: {
    toolName: WEB_FETCH_TOOL_NAME,
    fileSystemMode: 'no-fs',
    networkMode: 'allow-with-restrictions',
  },
}

const DEFAULT_CONFIG: SandboxRuntimeConfig = {
  network: {
    allowedDomains: [],
    deniedDomains: [],
  },
  filesystem: {
    denyRead: [],
    allowRead: [],
    allowWrite: [],
    denyWrite: [],
  },
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function mergeArrays(
  base: readonly string[] | undefined,
  override: readonly string[] | undefined,
): string[] {
  return unique([...(base ?? []), ...(override ?? [])])
}

function hardDenyNetwork(config: SandboxRuntimeConfig): void {
  config.network.allowedDomains = []
  config.network.allowUnixSockets = []
  config.network.allowAllUnixSockets = false
  config.network.allowLocalBinding = false
  delete config.network.httpProxyPort
  delete config.network.socksProxyPort
}

function cloneConfig(
  baseConfig?: Partial<SandboxRuntimeConfig>,
  customConfig?: Partial<SandboxRuntimeConfig>,
): SandboxRuntimeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...baseConfig,
    ...customConfig,
    network: {
      ...DEFAULT_CONFIG.network,
      ...baseConfig?.network,
      ...customConfig?.network,
      allowedDomains: mergeArrays(
        baseConfig?.network?.allowedDomains,
        customConfig?.network?.allowedDomains,
      ),
      deniedDomains: mergeArrays(
        baseConfig?.network?.deniedDomains,
        customConfig?.network?.deniedDomains,
      ),
    },
    filesystem: {
      ...DEFAULT_CONFIG.filesystem,
      ...baseConfig?.filesystem,
      ...customConfig?.filesystem,
      denyRead: mergeArrays(
        baseConfig?.filesystem?.denyRead,
        customConfig?.filesystem?.denyRead,
      ),
      allowRead: mergeArrays(
        baseConfig?.filesystem?.allowRead,
        customConfig?.filesystem?.allowRead,
      ),
      allowWrite: mergeArrays(
        baseConfig?.filesystem?.allowWrite,
        customConfig?.filesystem?.allowWrite,
      ),
      denyWrite: mergeArrays(
        baseConfig?.filesystem?.denyWrite,
        customConfig?.filesystem?.denyWrite,
      ),
    },
  }
}

export function mergeProfileIntoConfig(
  profile: ToolSandboxProfile,
  customConfig?: Partial<SandboxRuntimeConfig>,
  baseConfig?: Partial<SandboxRuntimeConfig>,
): SandboxRuntimeConfig {
  const merged = cloneConfig(baseConfig, customConfig)

  switch (profile.fileSystemMode) {
    case 'read-only':
      merged.filesystem.allowWrite = []
      break
    case 'workspace-write':
      break
    case 'no-fs':
      merged.filesystem.denyRead = ['/']
      merged.filesystem.allowRead = []
      merged.filesystem.allowWrite = []
      break
  }

  switch (profile.networkMode) {
    case 'deny':
      // ADVISORY ONLY: this writes a "no network" shape into customConfig, but
      // the running proxy does not read per-call config (see the file header +
      // ToolSandboxProfile.networkMode @deprecated). It does NOT block traffic.
      hardDenyNetwork(merged)
      break
    case 'allow':
    case 'allow-with-restrictions':
      break
  }

  merged.filesystem.denyRead = mergeArrays(
    merged.filesystem.denyRead,
    profile.additionalDenyPatterns,
  )
  merged.filesystem.allowWrite = mergeArrays(
    merged.filesystem.allowWrite,
    profile.additionalAllowPatterns,
  )

  return merged
}
