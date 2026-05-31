import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEEPSEEK_BUILTIN_MODELS,
  getDeepSeekModelCatalog,
  resolveModelCatalogEntry,
  sanitizeModelCatalogEntries,
} from '../src/services/providers/model-catalog.mjs'
import {
  getResolvedDeepSeekModelCatalog,
  loadDeepSeekConfigFile,
  saveDeepSeekConfigFile,
} from '../src/services/providers/deepseek-config-store.mjs'

test('built-in catalog is exactly the two real DeepSeek models, frozen', () => {
  assert.deepEqual(
    DEEPSEEK_BUILTIN_MODELS.map(m => m.id),
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
  )
  // The legacy aliases the API silently downgrades to flash must NOT appear.
  const ids = new Set(DEEPSEEK_BUILTIN_MODELS.map(m => m.id))
  for (const alias of ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']) {
    assert.ok(!ids.has(alias), `${alias} must not be a built-in model`)
  }
  assert.ok(Object.isFrozen(DEEPSEEK_BUILTIN_MODELS))
  assert.throws(() => {
    DEEPSEEK_BUILTIN_MODELS[0].id = 'mutated'
  })
})

test('getDeepSeekModelCatalog with no config returns just the built-ins', () => {
  assert.deepEqual(
    getDeepSeekModelCatalog().map(m => m.id),
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
  )
  assert.deepEqual(
    getDeepSeekModelCatalog({ fileConfig: {} }).map(m => m.id),
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
  )
})

test('config-only models are appended after the built-ins in config order', () => {
  const catalog = getDeepSeekModelCatalog({
    fileConfig: {
      models: [
        { id: 'my-finetune', label: 'My Finetune', description: 'Custom' },
        'bare-string-model',
      ],
    },
  })
  assert.deepEqual(catalog.map(m => m.id), [
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'my-finetune',
    'bare-string-model',
  ])
  assert.equal(catalog[2].label, 'My Finetune')
  assert.equal(catalog[2].description, 'Custom')
  // A bare string has an id but no label/description.
  assert.equal(catalog[3].id, 'bare-string-model')
  assert.equal(catalog[3].label, undefined)
})

test('a config entry overrides a built-in label/description but keeps canonical id + position', () => {
  const catalog = getDeepSeekModelCatalog({
    fileConfig: {
      models: [
        { id: 'DeepSeek-V4-Pro', label: 'Pro (renamed)', description: 'mine' },
      ],
    },
  })
  // Still 2 entries (no duplicate), Pro still first.
  assert.deepEqual(catalog.map(m => m.id), ['deepseek-v4-pro', 'deepseek-v4-flash'])
  assert.equal(catalog[0].id, 'deepseek-v4-pro', 'canonical id casing preserved')
  assert.equal(catalog[0].label, 'Pro (renamed)')
  assert.equal(catalog[0].description, 'mine')
})

test('includeBuiltins:false returns only the config models', () => {
  const catalog = getDeepSeekModelCatalog({
    fileConfig: { models: [{ id: 'only-this' }] },
    includeBuiltins: false,
  })
  assert.deepEqual(catalog.map(m => m.id), ['only-this'])
})

test('sanitizeModelCatalogEntries drops junk, trims, de-dupes case-insensitively, caps', () => {
  const entries = sanitizeModelCatalogEntries([
    '  spaced  ',
    { id: '  obj-id  ', label: '  L  ', description: '  D  ' },
    { id: '' }, // empty id -> dropped
    { id: 42 }, // non-string id -> dropped
    null, // -> dropped
    ['nested'], // array -> dropped
    'spaced', // case/whitespace dup of "spaced" -> dropped
    'SPACED', // dup -> dropped
  ])
  assert.deepEqual(entries, [
    { id: 'spaced' },
    { id: 'obj-id', label: 'L', description: 'D' },
  ])

  assert.deepEqual(sanitizeModelCatalogEntries('not-an-array'), [])
  assert.deepEqual(sanitizeModelCatalogEntries(undefined), [])

  const many = Array.from({ length: 100 }, (_, i) => `m${i}`)
  assert.equal(sanitizeModelCatalogEntries(many, { max: 5 }).length, 5)
})

test('resolveModelCatalogEntry: known id resolves, unknown id gets a safe fallback', () => {
  const catalog = getDeepSeekModelCatalog()
  const pro = resolveModelCatalogEntry('DEEPSEEK-V4-PRO', catalog)
  assert.equal(pro.id, 'deepseek-v4-pro')
  assert.match(pro.label, /Pro/)
  assert.ok(pro.description.length > 0)

  const unknown = resolveModelCatalogEntry('mystery-model', catalog)
  assert.deepEqual(unknown, {
    id: 'mystery-model',
    label: 'mystery-model',
    description: 'Custom DeepSeek-compatible model',
  })

  // A config entry without a label/description still resolves with fallbacks.
  const bare = resolveModelCatalogEntry('x', [{ id: 'x' }])
  assert.equal(bare.label, 'x')
  assert.equal(bare.description, 'DeepSeek-compatible model')
})

test('config store round-trips models and getResolvedDeepSeekModelCatalog merges them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-catalog-'))
  const env = { DEEPCODE_CONFIG_FILE: join(dir, 'deepseek-config.json') }
  try {
    saveDeepSeekConfigFile(
      {
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
        models: [
          '  custom-a  ',
          { id: 'custom-b', label: 'Custom B' },
          { id: 'custom-a' }, // duplicate -> dropped on sanitize
          { id: '' }, // junk -> dropped
        ],
      },
      { env },
    )

    const loaded = loadDeepSeekConfigFile({ env })
    assert.deepEqual(loaded.models, [{ id: 'custom-a' }, { id: 'custom-b', label: 'Custom B' }])

    const catalog = getResolvedDeepSeekModelCatalog({ env })
    assert.deepEqual(catalog.map(m => m.id), [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'custom-a',
      'custom-b',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('config store omits the models key entirely when nothing usable is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-catalog-'))
  const env = { DEEPCODE_CONFIG_FILE: join(dir, 'deepseek-config.json') }
  try {
    saveDeepSeekConfigFile({ apiKey: 'sk-test', models: [{ id: '' }, 7] }, { env })
    const loaded = loadDeepSeekConfigFile({ env })
    assert.ok(!('models' in loaded), 'empty/invalid models must not persist as []')
    // Catalog still falls back to built-ins.
    assert.deepEqual(getResolvedDeepSeekModelCatalog({ env }).map(m => m.id), [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
