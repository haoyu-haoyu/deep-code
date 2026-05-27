import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clear,
  getRecentTurns,
  getSessionTotals,
  recordTurn,
} from '../src/cache/deepseek-cache.mjs'
import { createDeepSeekCallModel } from '../src/query/deepseek-call-model.mjs'

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
