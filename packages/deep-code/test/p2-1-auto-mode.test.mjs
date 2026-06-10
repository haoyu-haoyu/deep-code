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
const agentModelSource = join(packageRoot, 'src/utils/model/agent.ts')
const spawnMultiAgentSource = join(packageRoot, 'src/tools/shared/spawnMultiAgent.ts')
const footerLeftSource = join(packageRoot, 'src/components/PromptInput/PromptInputFooterLeftSide.tsx')
const mainSource = join(packageRoot, 'src/main.tsx')
const modelOptionsSource = join(packageRoot, 'src/utils/model/modelOptions.ts')
const modelCommandSource = join(packageRoot, 'src/commands/model/model.tsx')
const deepSeekProviderSource = join(packageRoot, 'src/services/providers/deepseek.mjs')
const messageSendSource = join(packageRoot, 'src/services/runtime/messageSend.ts')

async function loadRouterModule() {
  return await loadBuiltModule(routerSource, 'router.mjs')
}

async function loadBuiltModule(source, outfileName) {
  const outdir = await mkdtemp(join(tmpdir(), 'deepcode-auto-router-'))
  const outfile = join(outdir, outfileName)
  const result = spawnSync(
    'bun',
    [
      'build',
      source,
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
    `failed to bundle ${source}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
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

test('routeTurn keeps concurrent decisions isolated', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      const call = calls
      if (call === 1) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      return createJsonResponse(
        call === 1
          ? { model: 'flash', thinking: 'off' }
          : { model: 'pro', thinking: 'max' },
      )
    }

    const [first, second] = await Promise.all([
      routeTurn(
        [{ role: 'user', content: 'What is JSON?' }],
        new AbortController().signal,
      ),
      routeTurn(
        [{ role: 'user', content: 'Refactor the runtime and tests.' }],
        new AbortController().signal,
      ),
    ])

    assert.equal(calls, 2)
    assert.deepEqual(first, {
      model: 'flash',
      thinking: 'off',
      source: 'router',
    })
    assert.deepEqual(second, {
      model: 'pro',
      thinking: 'max',
      source: 'router',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('routeTurn falls back when aborted during routing', async () => {
  const { routeTurn } = await loadRouterModule()
  const originalFetch = globalThis.fetch
  try {
    let fetchCalled = false
    const controller = new AbortController()
    globalThis.fetch = async () => {
      fetchCalled = true
      controller.abort()
      throw new Error('aborted during routing')
    }

    const decision = await routeTurn(
      [{ role: 'user', content: 'What is JSON?' }],
      controller.signal,
    )

    assert.equal(fetchCalled, true)
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

test('sub-agent model resolution inherits auto when no model is assigned', async () => {
  const source = await readFile(agentModelSource, 'utf8')

  assert.match(source, /isAutoModelSetting/)
  assert.match(
    source,
    /if \(agentModel === undefined && isAutoModelSetting\(parentModel\)\) \{\s*return parentModel\s*\}/s,
  )
  assert.match(source, /if \(agentModelWithExp === 'inherit'\)[\s\S]*mainLoopModel: parentModel/)
})

test('sub-agent explicit model override wins over parent auto', async () => {
  const source = await readFile(agentModelSource, 'utf8')
  const toolSpecifiedIndex = source.indexOf('if (toolSpecifiedModel)')
  const autoInheritIndex = source.indexOf(
    'if (agentModel === undefined && isAutoModelSetting(parentModel))',
  )
  const fallbackIndex = source.indexOf('const agentModelWithExp =')

  assert.ok(toolSpecifiedIndex >= 0, 'tool-specified model branch exists')
  assert.ok(autoInheritIndex >= 0, 'auto inheritance branch exists')
  assert.ok(fallbackIndex >= 0, 'fallback model branch exists')
  assert.ok(
    toolSpecifiedIndex < autoInheritIndex,
    'explicit tool model is evaluated before auto inheritance',
  )
  assert.ok(
    autoInheritIndex < fallbackIndex,
    'auto inheritance is evaluated before default fallback',
  )
  assert.match(
    source,
    /const model = parseUserSpecifiedModel\(toolSpecifiedModel\)\s*return applyParentRegionPrefix\(model, toolSpecifiedModel\)/,
  )
  assert.match(
    source,
    /const model = parseUserSpecifiedModel\(agentModelWithExp\)\s*return applyParentRegionPrefix\(model, agentModelWithExp\)/,
  )
})

test('multi-agent teammates inherit auto before default fallback', async () => {
  const source = await readFile(spawnMultiAgentSource, 'utf8')

  assert.match(source, /leaderModel === 'auto'/)
  assert.match(source, /return inputModel \?\? getDefaultTeammateModel\(leaderModel\)/)
})

test('TUI footer displays auto route metadata only for auto sessions', async () => {
  const source = await readFile(footerLeftSource, 'utf8')

  assert.match(source, /activeModelSetting === 'auto'/)
  // The footer auto-route label migrated to the catalog
  // (promptInput.footer.autoRoute); the footer now renders the key with the
  // model/thinking params.
  assert.match(source, /promptInput\.footer\.autoRoute/)
  assert.match(source, /autoRouteDecision\.model/)
  const enCatalog = await readFile(
    join(packageRoot, 'src/i18n/messages/en.ts'),
    'utf8',
  )
  assert.match(
    enCatalog,
    /'promptInput\.footer\.autoRoute':\s*'auto -> \{model\}\/\{thinking\}'/,
  )
})

test('CLI help advertises --model auto', async () => {
  const source = await readFile(mainSource, 'utf8')

  assert.match(source, /--model <model>/)
  assert.match(source, /--model auto/)
})

test('/model options include auto routing', async () => {
  const source = await readFile(modelOptionsSource, 'utf8')

  assert.match(source, /value:\s*AUTO_MODEL_SETTING/)
  // The picker labels/descriptions migrated to the i18n catalog (model.deepseek.*); the
  // Auto option now renders the keys, with the English values living in en.ts.
  assert.match(source, /getMessage\('model\.deepseek\.auto\.label'\)/)
  assert.match(source, /getMessage\('model\.deepseek\.auto\.description'\)/)
  const enCatalog = await readFile(
    join(packageRoot, 'src/i18n/messages/en.ts'),
    'utf8',
  )
  assert.match(enCatalog, /'model\.deepseek\.auto\.label':\s*'Auto'/)
  assert.match(enCatalog, /'model\.deepseek\.auto\.description':\s*'Route each turn/)
})

test('the DeepSeek custom-model picker option sets an English descriptionForModel (no locale leak)', async () => {
  // The custom (non-catalog) model append feeds the model-facing ConfigTool prompt via its
  // `descriptionForModel ?? description` fallback. Since `description` is now localized, the
  // push MUST set an English `descriptionForModel` or the model's input (and cache prefix)
  // would shift by UI locale.
  const source = await readFile(modelOptionsSource, 'utf8')
  assert.match(
    source,
    /value:\s*customModel,[\s\S]*?descriptionForModel:\s*`\$\{getDeepSeekModelLabel\(customModel\)\} \(\$\{customModel\}\)`/,
  )
})

test('/model auto is accepted without remote validation', async () => {
  const source = await readFile(modelCommandSource, 'utf8')

  assert.match(source, /isAutoModelSetting\(model\)/)
  // "Auto routing enabled" migrated to the i18n catalog
  // (command.model.autoRoutingEnabled); model.tsx now renders the key.
  assert.match(source, /command\.model\.autoRoutingEnabled/)
  const enCatalog = await readFile(
    join(packageRoot, 'src/i18n/messages/en.ts'),
    'utf8',
  )
  assert.match(
    enCatalog,
    /'command\.model\.autoRoutingEnabled':\s*'Auto routing enabled'/,
  )
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
