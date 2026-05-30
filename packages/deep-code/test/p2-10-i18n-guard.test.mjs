import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Regression guard for the P2.10.b.3 slash-command i18n migration: every slash
// command's user-facing `description` must stay catalog-backed
// (translate('en', 'command.<name>.description')), so a newly-added command
// can't silently reintroduce a hard-coded English description that bypasses the
// i18n catalog. Baseline at introduction: 0 offenders / 53 catalog-backed.

const commandsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'commands',
)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// Command files allowed to keep a raw `description:` literal (genuine
// non-user-facing exceptions). Empty by design — keep it that way.
const ALLOWLIST = new Set([])

test('command-definition descriptions stay catalog-backed (no hard-coded literals)', () => {
  const offenders = []
  for (const file of walk(commandsDir)) {
    const rel = file.slice(commandsDir.length + 1)
    if (ALLOWLIST.has(rel)) continue
    const src = readFileSync(file, 'utf8')
    // Only the command-DEFINITION object (the one annotated `satisfies Command`)
    // carries the user-facing slash-command description. Sub-action / picker /
    // option `description:` fields inside *.tsx implementation files are a
    // separate (deferred) i18n surface and are intentionally out of scope here.
    if (!src.includes('satisfies Command')) continue
    for (const line of src.split('\n')) {
      // A `description:` assigned a raw quoted string literal, not a
      // translate()/getMessage() catalog lookup.
      if (
        /^\s*description:\s*['"]/.test(line) &&
        !/translate\(|getMessage\(/.test(line)
      ) {
        offenders.push(`${rel}: ${line.trim().slice(0, 90)}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Hard-coded slash-command description(s) found. Use ` +
      `translate('en', 'command.<name>.description') and add a catalog key, ` +
      `or add the file to ALLOWLIST if the field is genuinely non-user-facing:\n` +
      offenders.join('\n'),
  )
})

test('the command-description catalog keys exist for catalog-backed commands', () => {
  // Sanity: every translate('en', 'command.X.description') call site references
  // a key that exists in the English catalog (no typo'd keys that would silently
  // fall back to the raw key string).
  const enSource = readFileSync(
    resolve(commandsDir, '..', 'i18n', 'messages', 'en.ts'),
    'utf8',
  )
  const missing = []
  for (const file of walk(commandsDir)) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(
      /translate\('en',\s*'(command\.[A-Za-z0-9.]+)'\)/g,
    )) {
      const key = match[1]
      if (!enSource.includes(`'${key}'`)) {
        missing.push(`${file.slice(commandsDir.length + 1)} → ${key}`)
      }
    }
  }
  assert.deepEqual(missing, [], `Command translate keys missing from en.ts:\n${missing.join('\n')}`)
})
