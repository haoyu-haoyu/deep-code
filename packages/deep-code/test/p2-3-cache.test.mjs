import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clear,
  getRecentTurns,
  getSessionTotals,
  recordTurn,
} from '../src/cache/deepseek-cache.mjs'
import {
  formatCacheStatusText,
  formatCompactTokenCount,
} from '../src/components/cacheStatusChipData.mjs'
import { executeCacheCommand } from '../src/commands/cache/cache-command.mjs'
import { createDeepSeekCallModel } from '../src/query/deepseek-call-model.mjs'
import { cacheHitRatio } from '../src/cache/hitRate.mjs'

test('cacheHitRatio is hit/(hit+miss), and 0 (not NaN) when there are no tokens', () => {
  assert.equal(cacheHitRatio(0, 0), 0) // no 0/0 = NaN
  assert.equal(cacheHitRatio(1, 0), 1)
  assert.equal(cacheHitRatio(0, 5), 0)
  assert.equal(cacheHitRatio(3, 1), 0.75)
  assert.equal(cacheHitRatio(1, 3), 0.25)
  // full precision (the telemetry caller rounds separately); 6/7 is the canonical case
  assert.equal(cacheHitRatio(6, 1), 6 / 7)
})

test('recordTurn updates session totals and hit rate', () => {
  clear()

  recordTurn({
    turnId: 'turn-1',
    hit: 3,
    miss: 1,
    prefixHash: 'prefix-a',
    componentHashes: { systemPrompt: 'system-a' },
    timestamp: 100,
  })
  recordTurn({
    turnId: 'turn-2',
    hit: 1,
    miss: 3,
    prefixHash: 'prefix-b',
    componentHashes: { tools: 'tools-b' },
    timestamp: 200,
  })

  assert.deepEqual(getSessionTotals(), {
    totalHit: 4,
    totalMiss: 4,
    hitRate: 0.5,
    turnCount: 2,
  })
  assert.deepEqual(getRecentTurns(1), [
    {
      turnId: 'turn-2',
      hitTokens: 1,
      missTokens: 3,
      hitRate: 0.25,
      prefixHash: 'prefix-b',
      componentHashes: { tools: 'tools-b' },
      timestamp: 200,
    },
  ])
})

test('recordTurn returns zero hit rate for zero-token denominator', () => {
  clear()

  const record = recordTurn({
    turnId: 'turn-empty',
    hit: 0,
    miss: 0,
    timestamp: 300,
  })

  assert.equal(record.hitRate, 0)
  assert.equal(Number.isNaN(record.hitRate), false)
  assert.deepEqual(getSessionTotals(), {
    totalHit: 0,
    totalMiss: 0,
    hitRate: 0,
    turnCount: 1,
  })
})

test('getRecentTurns returns the most recent records capped by count', () => {
  clear()

  for (let index = 1; index <= 12; index += 1) {
    recordTurn({
      turnId: `turn-${index}`,
      hit: index,
      miss: 0,
      timestamp: index,
    })
  }

  assert.deepEqual(
    getRecentTurns(10).map(turn => turn.turnId),
    [
      'turn-3',
      'turn-4',
      'turn-5',
      'turn-6',
      'turn-7',
      'turn-8',
      'turn-9',
      'turn-10',
      'turn-11',
      'turn-12',
    ],
  )
})

test('clear resets live cache session state', () => {
  clear()
  recordTurn({ turnId: 'turn-1', hit: 5, miss: 5 })

  clear()

  assert.deepEqual(getSessionTotals(), {
    totalHit: 0,
    totalMiss: 0,
    hitRate: 0,
    turnCount: 0,
  })
  assert.deepEqual(getRecentTurns(), [])
})

test('recordTurn preserves basic order for concurrent callers', async () => {
  clear()

  await Promise.all([
    Promise.resolve().then(() => recordTurn({ turnId: 'turn-a', hit: 1, miss: 0 })),
    Promise.resolve().then(() => recordTurn({ turnId: 'turn-b', hit: 0, miss: 1 })),
    Promise.resolve().then(() => recordTurn({ turnId: 'turn-c', hit: 1, miss: 1 })),
  ])

  assert.deepEqual(
    getRecentTurns().map(turn => turn.turnId),
    ['turn-a', 'turn-b', 'turn-c'],
  )
})

test('DeepSeek call-model ingests completed cache usage into live store', async () => {
  clear()

  const restoreEnv = setCacheStatsDisabled()
  try {
    const callModel = createDeepSeekCallModel({
      uuid: () => 'cache-live',
      provider: createMockProvider({
        supports: capability =>
          capability === 'cache_breakpoint' ||
          capability === 'stable_prefix_cache',
      }),
    })

    for await (const _event of callModel({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: ['stable system'],
    })) {
      // Consume the stream to completion so ingestion runs.
    }

    assert.deepEqual(getSessionTotals(), {
      totalHit: 7,
      totalMiss: 3,
      hitRate: 0.7,
      turnCount: 1,
    })
    assert.equal(getRecentTurns(1)[0].turnId, 'msg_deepseek_cache-live')
    assert.ok(getRecentTurns(1)[0].prefixHash.length > 0)
  } finally {
    restoreEnv()
  }
})

test('non-DeepSeek provider capability makes cache ingestion a no-op', async () => {
  clear()

  const restoreEnv = setCacheStatsDisabled()
  try {
    const callModel = createDeepSeekCallModel({
      uuid: () => 'no-cache',
      provider: createMockProvider({
        supports: () => false,
      }),
    })

    for await (const _event of callModel({
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      // Consume the stream to completion so the gated path is exercised.
    }

    assert.deepEqual(getSessionTotals(), {
      totalHit: 0,
      totalMiss: 0,
      hitRate: 0,
      turnCount: 0,
    })
    assert.deepEqual(getRecentTurns(), [])
  } finally {
    restoreEnv()
  }
})

test('CacheStatusChip formats cache hit text with compact tokens', () => {
  assert.equal(
    formatCacheStatusText({
      provider: createCapabilityProvider(true),
      totals: {
        totalHit: 12_300,
        totalMiss: 1_800,
        hitRate: 12_300 / 14_100,
        turnCount: 3,
      },
    }),
    'cache: 87% hit (12.3k / 14.1k)',
  )
})

test('CacheStatusChip hides when cache totals are empty', () => {
  assert.equal(
    formatCacheStatusText({
      provider: createCapabilityProvider(true),
      totals: {
        totalHit: 0,
        totalMiss: 0,
        hitRate: 0,
        turnCount: 0,
      },
    }),
    null,
  )
})

test('CacheStatusChip hides when provider lacks cache capability', () => {
  assert.equal(
    formatCacheStatusText({
      provider: createCapabilityProvider(false),
      totals: {
        totalHit: 12_300,
        totalMiss: 1_800,
        hitRate: 12_300 / 14_100,
        turnCount: 3,
      },
    }),
    null,
  )
})

test('formatCompactTokenCount uses k and M suffixes', () => {
  assert.equal(formatCompactTokenCount(1_234), '1.2k')
  assert.equal(formatCompactTokenCount(1_234_567), '1.2M')
})

test('/cache inspect reports recent turns and session totals', async () => {
  clear()
  recordTurn({
    turnId: 'turn-inspect',
    hit: 8,
    miss: 2,
    prefixHash: 'prefix-inspect',
    componentHashes: { systemPrompt: 'system-hash' },
    timestamp: 400,
  })

  const result = await executeCacheCommand('inspect', {
    provider: createCapabilityProvider(true),
  })

  assert.equal(result.kind, 'inspect')
  assert.match(result.report, /DeepSeek cache/)
  assert.match(result.report, /Session: hit=8 miss=2 hit_rate=80\.0% turns=1/)
  assert.match(result.report, /turn-inspect: hit=8 miss=2 hit_rate=80\.0% prefix=prefix-inspect/)
  assert.match(result.report, /Estimated savings:/)
  assert.match(result.report, /pricing snapshot 2026-05-27/)
})

test('/cache warmup calls warmDeepSeekCache and formats the result', async () => {
  let warmupArgs
  const provider = createCapabilityProvider(true)

  const result = await executeCacheCommand('warmup', {
    cwd: '/tmp/deepcode-cache-test',
    env: { DEEPCODE_PROVIDER: 'deepseek' },
    provider,
    context: {
      options: {
        tools: [{ name: 'Read' }],
      },
    },
    warmup: async args => {
      warmupArgs = args
      return { prefixHash: 'warm-prefix' }
    },
    formatWarmup: result => `formatted warmup ${result.prefixHash}`,
  })

  assert.equal(result.kind, 'text')
  assert.equal(result.value, 'formatted warmup warm-prefix')
  assert.equal(warmupArgs.cwd, '/tmp/deepcode-cache-test')
  assert.equal(warmupArgs.provider, provider)
  assert.deepEqual(warmupArgs.tools, [{ name: 'Read' }])
})

test('/cache clear resets local store and does not claim remote cache clearing', async () => {
  clear()
  recordTurn({ turnId: 'turn-clear', hit: 9, miss: 1 })

  const result = await executeCacheCommand('clear', {
    provider: createCapabilityProvider(true),
  })

  assert.equal(result.kind, 'text')
  assert.match(result.value, /Local DeepSeek cache visualization state cleared/)
  assert.match(result.value, /does not clear DeepSeek remote cache/)
  assert.deepEqual(getSessionTotals(), {
    totalHit: 0,
    totalMiss: 0,
    hitRate: 0,
    turnCount: 0,
  })
})

test('/cache is unavailable when provider lacks cache capability', async () => {
  const result = await executeCacheCommand('inspect', {
    provider: createCapabilityProvider(false),
  })

  assert.deepEqual(result, {
    kind: 'text',
    value: 'Cache visualization unavailable for current provider',
  })
})

function createMockProvider({ supports }) {
  return {
    supports,
    streamQuery() {
      return (async function* stream() {
        yield { type: 'content_delta', text: 'ok' }
        yield { type: 'finish', finishReason: 'stop' }
        yield {
          type: 'usage',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 1,
            total_tokens: 11,
            prompt_cache_hit_tokens: 7,
            prompt_cache_miss_tokens: 3,
          },
        }
      })()
    },
  }
}

function createCapabilityProvider(supportsCache) {
  return {
    supports: capability => supportsCache && capability === 'cache_breakpoint',
  }
}

function setCacheStatsDisabled() {
  const previous = process.env.DEEPCODE_CACHE_STATS_PATH
  process.env.DEEPCODE_CACHE_STATS_PATH = 'disabled'
  return () => {
    if (previous === undefined) {
      delete process.env.DEEPCODE_CACHE_STATS_PATH
    } else {
      process.env.DEEPCODE_CACHE_STATS_PATH = previous
    }
  }
}
