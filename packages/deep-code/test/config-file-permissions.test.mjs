import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, statSync, rmSync, readFileSync, readdirSync } from 'node:fs'
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
import { writeSecretFileAtomic } from '../src/utils/secureStorage/writeSecretFileAtomic.mjs'

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

test('saveProviderConfigFile tightens a PRE-EXISTING group/world-readable config dir', { skip: !POSIX }, () => {
  const configDir = mkdtempSync(join(tmpdir(), 'deepcode-perm-'))
  try {
    chmodSync(configDir, 0o755) // a loose dir created before this hardening / by another tool
    assert.equal(isModeTooOpen(statSync(configDir).mode), true, 'precondition: dir starts too open')
    saveProviderConfigFile(
      { activeProvider: 'deepseek', providers: { deepseek: { apiKey: 'sk-x' } } },
      { env: { DEEPCODE_CONFIG_DIR: configDir } },
    )
    assert.equal(isModeTooOpen(statSync(configDir).mode), false, 'existing dir tightened on save')
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
})

// ── writeSecretFileAtomic: the non-macOS credentials store write ─────────────
// plainTextStorage.update() (the Windows/Linux secure-storage backend) used to
// writeFileSync the credentials blob with NO mode (born 0o644 under a 022 umask)
// then chmod 0o600 on the next line — a world-readable window — and truncated in
// place (a crash mid-write corrupts the live secret). This leaf writes a tmp at
// 0o600 from byte one and renames it over the target, owner-only dir included.

test('writeSecretFileAtomic: a freshly created secret file is 0o600 (never 0o644)', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const path = join(dir, 'nested', '.credentials.json')
    writeSecretFileAtomic(path, '{"mcpOAuth":{}}')
    assert.equal(statSync(path).mode & 0o777, SECURE_FILE_MODE, 'born 0o600')
    assert.equal(isModeTooOpen(statSync(path).mode), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSecretFileAtomic: the containing dir is created owner-only (0o700)', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const sub = join(dir, 'creds')
    writeSecretFileAtomic(join(sub, '.credentials.json'), '{}')
    assert.equal(isModeTooOpen(statSync(sub).mode), false, 'secret dir has no group/world bit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSecretFileAtomic: overwriting an existing file keeps 0o600 and the new content', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const path = join(dir, '.credentials.json')
    writeSecretFileAtomic(path, '{"a":1}')
    writeSecretFileAtomic(path, '{"a":2}')
    assert.equal(statSync(path).mode & 0o777, SECURE_FILE_MODE)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: 2 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSecretFileAtomic: no torn blob and no .tmp survivor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const path = join(dir, '.credentials.json')
    const blob = JSON.stringify({ mcpOAuth: { s: 'x'.repeat(200_000) } })
    writeSecretFileAtomic(path, blob)
    assert.equal(readFileSync(path, 'utf8'), blob, 'full blob, never partial')
    assert.deepEqual(
      readdirSync(dir).filter(f => f.endsWith('.tmp')),
      [],
      'rename consumed the tmp; no leftover',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSecretFileAtomic: a write failure leaves the original target untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const path = join(dir, '.credentials.json')
    writeSecretFileAtomic(path, '{"keep":true}')
    // Force a failure: pass a non-string data that writeFileSync rejects AFTER the
    // tmp dir exists. A symbol throws in the write, exercising the catch+cleanup.
    assert.throws(() => writeSecretFileAtomic(path, Symbol('bad')))
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { keep: true }, 'original intact')
    assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'tmp cleaned up on error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeSecretFileAtomic fuzz: round-trips bytes and stays 0o600 across inputs', { skip: !POSIX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-secret-'))
  try {
    const path = join(dir, '.credentials.json')
    let s = 0x51a7c3e9 >>> 0
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
    for (let i = 0; i < 2000; i++) {
      const obj = { i, k: 'é👤"\\'.repeat((rnd() * 8) | 0), n: (rnd() * 1e9) | 0 }
      const data = JSON.stringify(obj)
      writeSecretFileAtomic(path, data)
      assert.equal(readFileSync(path, 'utf8'), data, `iter ${i} round-trip`)
      assert.equal(statSync(path).mode & 0o777, SECURE_FILE_MODE, `iter ${i} mode`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
