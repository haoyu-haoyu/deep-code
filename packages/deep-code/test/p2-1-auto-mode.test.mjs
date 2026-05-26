import nodeTest from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const test = typeof globalThis.test === 'function' ? globalThis.test : nodeTest
const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const routerSource = join(packageRoot, 'src/services/autoMode/router.ts')
const mainSource = join(packageRoot, 'src/main.tsx')
const modelOptionsSource = join(packageRoot, 'src/utils/model/modelOptions.ts')
const modelCommandSource = join(packageRoot, 'src/commands/model/model.tsx')
const deepSeekProviderSource = join(packageRoot, 'src/services/providers/deepseek.mjs')
const messageSendSource = join(packageRoot, 'src/services/runtime/messageSend.ts')

async function loadRouterModule() {
  const outdir = await mkdtemp(join(tmpdir(), 'deepcode-auto-router-'))
  const outfile = join(outdir, 'router.mjs')
  const result = spawnSync(
    'bun',
    [
      'build',
      routerSource,
      '--target=node',
      '--format=esm',
      '--outfile',
      outfile,
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  )
  assert.equal(
    result.status,
    0,
    `failed to bundle router.ts\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return await import(pathToFileURL(outfile).href)
}

function createJsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(payload),
            },
          },
        ],
      }
    },
  }
}

function createTextResponse(text) {
  return {
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: text,
            },
          },
        ],
      }
    },
  }
}

test('fallbackHeuristic routes short factual requests to flash/off', async () => {
  const { fallbackHeuristic } = await loadRouterModule()
  assert.deepEqual(fallbackHeuristic('What is JSON?'), {
    model: 'flash',
    thinking: 'off',
    source: 'heuristic',
    reason: 'short_factual',
  })
})

test('fallbackHeuristic routes single-file edits to pro/high', async () => {
  const { fallbackHeuristic } = await loadRouterModule()
  assert.deepEqual(
    fallbackHeuristic('Edit src/app.ts to add validation for empty input.'),
    {
      model: 'pro',
      thinking: 'high',
      source: 'heuristic',
      reason: 'single_file_edit',
    },
  )
})

test('fallbackHeuristic routes multi-file refactors to pro/max', async () => {
  const { fallbackHeuristic } = await loadRouterModule()
  assert.deepEqual(
    fallbackHeuristic('Refactor the auth, routing, and settings modules and update tests.'),
    {
      model: 'pro',
      thinking: 'max',
      source: 'heuristic',
      reason: 'complex_change',
    },
  )
})

test('fallbackHeuristic routes speed requests to flash/off', async () => {
  const { fallbackHeuristic } = await loadRouterModule()
  assert.deepEqual(fallbackHeuristic('Quickly summarize the last error.'), {
    model: 'flash',
    thinking: 'off',
    source: 'heuristic',
    reason: 'speed_requested',
  })
})

test('fallbackHeuristic routes architecture requests to pro/max', async () => {
  const { fallbackHeuristic } = await loadRouterModule()
  assert.deepEqual(
    fallbackHeuristic('Design the architecture for a safe plugin runtime.'),
    {
      model: 'pro',
      thinking: 'max',
      source: 'heuristic',
      reason: 'deep_reasoning_requested',
    },
  )
})

test('routeTurn accepts flash/off router responses', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => createJsonResponse({ model: 'flash', thinking: 'off' })

    const decision = await routeTurn(
      [{ role: 'user', content: 'What is JSON?' }],
      new AbortController().signal,
    )

    assert.deepEqual(decision, {
      model: 'flash',
      thinking: 'off',
      source: 'router',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn accepts pro/max router responses', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => createJsonResponse({ model: 'pro', thinking: 'max' })
    const decision = await routeTurn(
      [{ role: 'user', content: 'Refactor the runtime and tests.' }],
      new AbortController().signal,
    )

    assert.deepEqual(decision, {
      model: 'pro',
      thinking: 'max',
      source: 'router',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn falls back when fetch throws', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error('network down')
    }

    const decision = await routeTurn(
      [{ role: 'user', content: 'What is JSON?' }],
      new AbortController().signal,
    )

    assert.deepEqual(decision, {
      model: 'flash',
      thinking: 'off',
      source: 'heuristic',
      reason: 'short_factual',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn falls back on malformed JSON', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => createTextResponse('not json')

    const decision = await routeTurn(
      [{ role: 'user', content: 'Quickly summarize this error.' }],
      new AbortController().signal,
    )

    assert.deepEqual(decision, {
      model: 'flash',
      thinking: 'off',
      source: 'heuristic',
      reason: 'speed_requested',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn falls back on unknown router values', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => createJsonResponse({ model: 'x', thinking: 'off' })

    const decision = await routeTurn(
      [{ role: 'user', content: 'Design the architecture for routing.' }],
      new AbortController().signal,
    )

    assert.deepEqual(decision, {
      model: 'pro',
      thinking: 'max',
      source: 'heuristic',
      reason: 'deep_reasoning_requested',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn falls back without fetch when signal is already aborted', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    let fetchCalled = false
    globalThis.fetch = async () => {
      fetchCalled = true
      return createJsonResponse({ model: 'flash', thinking: 'off' })
    }
    const controller = new AbortController()
    controller.abort()

    const decision = await routeTurn(
      [{ role: 'user', content: 'What is JSON?' }],
      controller.signal,
    )

    assert.equal(fetchCalled, false)
    assert.deepEqual(decision, {
      model: 'flash',
      thinking: 'off',
      source: 'heuristic',
      reason: 'short_factual',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CLI help advertises --model auto', async () => {
  const source = await readFile(mainSource, 'utf8')

  assert.match(source, /--model <model>/)
  assert.match(source, /--model auto/)
})

test('/model options include auto routing', async () => {
  const source = await readFile(modelOptionsSource, 'utf8')

  assert.match(source, /value:\s*AUTO_MODEL_SETTING/)
  assert.match(source, /label:\s*'Auto'/)
  assert.match(source, /Route each turn/)
})

test('/model auto is accepted without remote validation', async () => {
  const source = await readFile(modelCommandSource, 'utf8')

  assert.match(source, /isAutoModelSetting\(model\)/)
  assert.match(source, /Auto routing enabled/)
})

test('DeepSeek provider exposes a lightweight router request helper', async () => {
  const source = await readFile(deepSeekProviderSource, 'utf8')

  assert.match(source, /export async function buildDeepSeekRouterRequest/)
  assert.match(source, /DEFAULT_DEEPSEEK_SMALL_MODEL/)
  assert.match(source, /responseFormat:\s*\{\s*type:\s*'json_object'\s*\}/s)
})

test('runtime hook stores auto route metadata for TUI consumers', async () => {
  const source = await readFile(messageSendSource, 'utf8')

  assert.match(source, /routeTurn/)
  assert.match(source, /autoRouteDecision/)
  assert.match(source, /AUTO_MODEL_SETTING/)
})
