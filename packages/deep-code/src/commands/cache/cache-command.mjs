import {
  clear,
  getRecentTurns,
  getSessionTotals,
} from '../../cache/deepseek-cache.mjs'
import {
  DEEPSEEK_PRICING_SNAPSHOT_DATE,
  estimateDeepSeekCacheSavingsUsd,
  formatUsdEstimate,
} from '../../cache/deepseek-pricing.mjs'
import {
  formatCompactTokenCount,
  resolveCurrentCacheStatusProvider,
} from '../../components/cacheStatusChipData.mjs'
import {
  formatDeepSeekWarmupResult,
  warmDeepSeekCache,
} from '../../cache/deepseek-warmup.mjs'
import { providerSupports } from '../../deepcode/provider-capabilities.mjs'
import { firstNonEmpty } from '../../utils/configValue.mjs'
import { DEFAULT_DEEPSEEK_MODEL } from '../../services/providers/deepseek.mjs'

const HELP_ARGS = new Set(['help', '-h', '--help'])
const SUPPORTED_SUBCOMMANDS = new Set(['inspect', 'warmup', 'clear'])

export async function executeCacheCommand(args = '', {
  cwd = process.cwd(),
  env = process.env,
  provider = resolveCurrentCacheStatusProvider(env),
  context = {},
  warmup = warmDeepSeekCache,
  formatWarmup = formatDeepSeekWarmupResult,
} = {}) {
  if (!providerSupports(provider, 'cache_breakpoint')) {
    return {
      kind: 'text',
      value: 'Cache visualization unavailable for current provider',
    }
  }

  const subcommand = normalizeSubcommand(args)
  if (HELP_ARGS.has(subcommand)) {
    return {
      kind: 'text',
      value: 'Usage: /cache [inspect|warmup|clear]',
    }
  }
  if (!SUPPORTED_SUBCOMMANDS.has(subcommand)) {
    return {
      kind: 'text',
      value: `Unknown cache subcommand: ${subcommand}. Usage: /cache [inspect|warmup|clear]`,
    }
  }

  if (subcommand === 'clear') {
    clear()
    return {
      kind: 'text',
      value:
        'Local DeepSeek cache visualization state cleared. This does not clear DeepSeek remote cache.',
    }
  }

  if (subcommand === 'warmup') {
    const result = await warmup({
      env,
      cwd,
      provider,
      systemPrompt: context.systemPrompt ?? context.options?.systemPrompt ?? [],
      tools: context.tools ?? context.options?.tools ?? [],
      skills: context.skills ?? context.options?.skills ?? [],
      repoSummary: context.repoSummary ?? context.options?.repoSummary ?? '',
      stableHistory: context.stableHistory ?? context.options?.stableHistory ?? [],
    })
    return {
      kind: 'text',
      value: formatWarmup(result),
    }
  }

  return {
    kind: 'inspect',
    report: formatCacheInspectReport({
      totals: getSessionTotals(),
      turns: getRecentTurns(10),
      model: resolveCacheReportModel(env),
    }),
  }
}

// Resolve the model the cache-savings estimate should be priced at. Mirrors the
// session's model resolution order (DEEPSEEK_MODEL > DEEPCODE_MODEL > product
// default) so the report prices at the model actually in use. The product default
// is deepseek-v4-pro, NOT the flash tier the inspect path previously hardcoded —
// pro's cache savings are ~3x larger, so flash understated savings ~3x.
export function resolveCacheReportModel(env = process.env) {
  return firstNonEmpty(
    env.DEEPSEEK_MODEL,
    env.DEEPCODE_MODEL,
    DEFAULT_DEEPSEEK_MODEL,
  )
}

export function formatCacheInspectReport({
  totals = getSessionTotals(),
  turns = getRecentTurns(10),
  model = DEFAULT_DEEPSEEK_MODEL,
} = {}) {
  const hit = totals.totalHit ?? 0
  const miss = totals.totalMiss ?? 0
  const hitRate = formatRate(totals.hitRate)
  const savings = estimateDeepSeekCacheSavingsUsd({ hitTokens: hit, model })
  const lines = [
    'DeepSeek cache',
    `Session: hit=${hit} miss=${miss} hit_rate=${hitRate} turns=${totals.turnCount ?? turns.length}`,
    `Session compact: ${formatCompactTokenCount(hit)} hit / ${formatCompactTokenCount(hit + miss)} total`,
    `Estimated savings: ${formatUsdEstimate(savings)} (pricing snapshot ${DEEPSEEK_PRICING_SNAPSHOT_DATE})`,
    'Recent turns:',
  ]

  if (turns.length === 0) {
    lines.push('- none')
  } else {
    for (const turn of turns) {
      const prefix = turn.prefixHash ? ` prefix=${turn.prefixHash}` : ''
      lines.push(
        `- ${turn.turnId}: hit=${turn.hitTokens} miss=${turn.missTokens} hit_rate=${formatRate(turn.hitRate)}${prefix}`,
      )
    }
  }

  lines.push(
    'Local stats only; /cache clear does not clear DeepSeek remote cache.',
  )
  return lines.join('\n')
}

function normalizeSubcommand(args) {
  const first = String(args || '').trim().split(/\s+/, 1)[0]
  return first || 'inspect'
}

function formatRate(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`
}
