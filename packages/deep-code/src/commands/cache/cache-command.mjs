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
import { getMessage } from '../../i18n/index.js'

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
      value: getMessage('command.cache.unavailable'),
    }
  }

  const subcommand = normalizeSubcommand(args)
  if (HELP_ARGS.has(subcommand)) {
    return {
      kind: 'text',
      value: getMessage('command.cache.usage'),
    }
  }
  if (!SUPPORTED_SUBCOMMANDS.has(subcommand)) {
    return {
      kind: 'text',
      value: getMessage('command.cache.unknownSubcommand', { subcommand }),
    }
  }

  if (subcommand === 'clear') {
    clear()
    return {
      kind: 'text',
      value: getMessage('command.cache.cleared'),
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
    }),
  }
}

export function formatCacheInspectReport({
  totals = getSessionTotals(),
  turns = getRecentTurns(10),
  model = 'deepseek-v4-flash',
} = {}) {
  const hit = totals.totalHit ?? 0
  const miss = totals.totalMiss ?? 0
  const hitRate = formatRate(totals.hitRate)
  const savings = estimateDeepSeekCacheSavingsUsd({ hitTokens: hit, model })
  const lines = [
    getMessage('command.cache.report.title'),
    getMessage('command.cache.report.session', {
      hit,
      miss,
      hitRate,
      turns: totals.turnCount ?? turns.length,
    }),
    getMessage('command.cache.report.compact', {
      hit: formatCompactTokenCount(hit),
      total: formatCompactTokenCount(hit + miss),
    }),
    getMessage('command.cache.report.savings', {
      savings: formatUsdEstimate(savings),
      snapshot: DEEPSEEK_PRICING_SNAPSHOT_DATE,
    }),
    getMessage('command.cache.report.recentTurns'),
  ]

  if (turns.length === 0) {
    lines.push(getMessage('command.cache.report.none'))
  } else {
    for (const turn of turns) {
      const prefix = turn.prefixHash
        ? getMessage('command.cache.report.turnPrefix', { prefix: turn.prefixHash })
        : ''
      lines.push(
        getMessage('command.cache.report.turn', {
          turnId: turn.turnId,
          hit: turn.hitTokens,
          miss: turn.missTokens,
          hitRate: formatRate(turn.hitRate),
          prefix,
        }),
      )
    }
  }

  lines.push(getMessage('command.cache.report.footer'))
  return lines.join('\n')
}

function normalizeSubcommand(args) {
  const first = String(args || '').trim().split(/\s+/, 1)[0]
  return first || 'inspect'
}

function formatRate(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`
}
