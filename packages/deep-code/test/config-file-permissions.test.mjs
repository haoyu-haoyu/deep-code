import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SECURE_FILE_MODE,
  SECURE_DIR_MODE,
  isModeTooOpen,
} from '../src/utils/secureFileMode.mjs'
import {
  loadProviderConfigFile,
  saveProviderConfigFile,
} from '../src/services/providers/deepseek-config-store.mjs'

const POSIX = process.platform !== 'win32'

// ── the pure predicate ───────────────────────────────────────────────────────

test('isModeTooOpen flags any group/world bit, ignores file-type + owner bits', () => {
  // owner-only modes are fine (incl. with the regular-file type bits set)
  assert.equal(isModeTooOpen(0o600), false)
  assert.equal(isModeTooOpen(0o100600), false) // st_mode of a 0600 regular file
  assert.equal(isModeTooOpen(SECURE_FILE_MODE), false)
  assert.equal(isModeTooOpen(SECURE_DIR_MODE), false) // 0o700 dir, owner-only
  // any group or other bit → too open
  assert.equal(isModeTooOpen(0o640), true) // group-readable
  assert.equal(isModeTooOpen(0o604), true) // world-readable
  assert.equal(isModeTooOpen(0o644), true)
  assert.equal(isModeTooOpen(0o100644), true) // st_mode of a 0644 regular file
  assert.equal(isModeTooOpen(0o660), true)
  assert.equal(isModeTooOpen(0o777), true)
})

// ── the config-store read-path repair ────────────────────────────────────────

test('loadProviderConfigFile repairs a group/world-readable key file to 0o600', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-perm-'))
  const path = join(dir, 'deepseek-config.json')
  try {
    writeFileSync(
      path,
      JSON.stringify({ activeProvider: 'deepseek', providers: { deepseek: { apiKey: 'sk-secret' } } }),
    )
    chmodSync(path, 0o644) // simulate a loose-umask / restored-backup key file
    assert.equal(isModeTooOpen(statSync(path).mode), true, 'precondition: file starts too open')

    const config = loadProviderConfigFile({ env: { DEEPCODE_CONFIG_FILE: path } })

    // repaired in place to owner-only ...
    assert.equal(statSync(path).mode & 0o777, SECURE_FILE_MODE)
    // ... and the content still loads (repair must not break the read)
    assert.equal(config.providers.deepseek.apiKey, 'sk-secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadProviderConfigFile leaves an already-0o600 key file untouched', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-perm-'))
  const path = join(dir, 'deepseek-config.json')
  try {
    writeFileSync(path, JSON.stringify({ activeProvider: 'deepseek', providers: {} }))
    chmodSync(path, SECURE_FILE_MODE)
    loadProviderConfigFile({ env: { DEEPCODE_CONFIG_FILE: path } })
    assert.equal(statSync(path).mode & 0o777, SECURE_FILE_MODE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── the config-dir is created owner-only ─────────────────────────────────────

test('saveProviderConfigFile creates the config dir without any group/world bit', { skip: !POSIX }, () => {
  const base = mkdtempSync(join(tmpdir(), 'deepcode-perm-'))
  const configDir = join(base, 'nested', '.deepcode') // must be freshly created
  try {
    saveProviderConfigFile(
      { activeProvider: 'deepseek', providers: { deepseek: { apiKey: 'sk-x' } } },
      { env: { DEEPCODE_CONFIG_DIR: configDir } },
    )
    // umask may make it stricter, but never looser in the group/world bits
    assert.equal(isModeTooOpen(statSync(configDir).mode), false)
    // and the file it wrote is owner-only too (pre-existing 0o600 write path)
    assert.equal(statSync(join(configDir, 'deepseek-config.json')).mode & 0o777, SECURE_FILE_MODE)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
