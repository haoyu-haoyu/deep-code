import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvDefinedFalsy } from 'src/utils/envUtils.js'
import { clearMcpAuthCache } from './client.js'
import { normalizeNameForMCP } from './normalization.js'
import type { ScopedMcpServerConfig } from './types.js'

type ClaudeAIMcpServer = {
  type: 'mcp_server'
  id: string
  display_name: string
  url: string
  created_at: string
}

type ClaudeAIMcpServersResponse = {
  data: ClaudeAIMcpServer[]
  has_more: boolean
  next_page: string | null
}

const FETCH_TIMEOUT_MS = 5000
const MCP_SERVERS_BETA_HEADER = 'mcp-servers-2025-12-04'

function isDeepCodeDeepSeekProvider(): boolean {
  const provider = (
    process.env.DEEPCODE_PROVIDER ??
    process.env.DEEP_CODE_PROVIDER ??
    'deepseek'
  ).toLowerCase()
  return provider === 'deepseek'
}

/**
 * Fetches MCP server configurations from Claude.ai org configs.
 * These servers are managed by the organization via Claude.ai.
 *
 * Results are memoized for the session lifetime (fetch once per CLI session).
 */
export const fetchClaudeAIMcpConfigsIfEligible = memoize(
  async (): Promise<Record<string, ScopedMcpServerConfig>> => {
    try {
      if (isDeepCodeDeepSeekProvider()) {
        logForDebugging('[claudeai-mcp] Disabled for DeepSeek native provider')
        logEvent('tengu_claudeai_mcp_eligibility', {
          state:
            'disabled_deepseek_provider' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      if (isEnvDefinedFalsy(process.env.ENABLE_CLAUDEAI_MCP_SERVERS)) {
        logForDebugging('[claudeai-mcp] Disabled via env var')
        logEvent('tengu_claudeai_mcp_eligibility', {
          state:
            'disabled_env_var' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      logForDebugging('[claudeai-mcp] No access token')
      logEvent('tengu_claudeai_mcp_eligibility', {
        state:
          'no_oauth_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {}
    } catch {
      logForDebugging(`[claudeai-mcp] Fetch failed`)
      return {}
    }
  },
)

/**
 * Clears the memoized cache for fetchClaudeAIMcpConfigsIfEligible.
 * Call this after login so the next fetch will use the new auth tokens.
 */
export function clearClaudeAIMcpConfigsCache(): void {
  fetchClaudeAIMcpConfigsIfEligible.cache.clear?.()
  // Also clear the auth cache so freshly-authorized servers get re-connected
  clearMcpAuthCache()
}

/**
 * Record that a claude.ai connector successfully connected. Idempotent.
 *
 * Gates the "N connectors unavailable/need auth" startup notifications: a
 * connector that was working yesterday and is now failed is a state change
 * worth surfacing; an org-configured connector that's been needs-auth since
 * it showed up is one the user has demonstrably ignored.
 */
export function markClaudeAiMcpConnected(name: string): void {
  saveGlobalConfig(current => {
    const seen = current.claudeAiMcpEverConnected ?? []
    if (seen.includes(name)) return current
    return { ...current, claudeAiMcpEverConnected: [...seen, name] }
  })
}

export function hasClaudeAiMcpEverConnected(name: string): boolean {
  return (getGlobalConfig().claudeAiMcpEverConnected ?? []).includes(name)
}
