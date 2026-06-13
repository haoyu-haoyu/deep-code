import { mkdirSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import * as lockfile from '../lockfile.js'
import { getSecureStorage } from './index.js'
import { clearKeychainCache } from './macOsKeychainHelpers.js'
import { runMutateSecureStorage } from './mutateSecureStorageCore.mjs'
import type { SecureStorageData } from './types.js'

/**
 * Apply `updater` to the secure-storage credentials blob under a cross-process
 * lock, re-reading the blob INSIDE the lock so a concurrent writer of a
 * different server/IdP entry cannot clobber it (lost update). `updater` receives
 * the freshly-read blob and returns the new blob — use the pure
 * setBlobEntry/deleteBlobEntry helpers so untouched siblings are preserved.
 *
 * Synchronous: storage read/update are sync (plaintext writeFileSync / keychain
 * spawnSync), and a sync lock keeps every existing caller's signature unchanged.
 */
export function mutateSecureStorage(
  updater: (blob: SecureStorageData) => SecureStorageData,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage()
  const claudeDir = getClaudeConfigHomeDir()
  return runMutateSecureStorage(
    {
      lockSync: lockfile.lockSync,
      lockPath: join(claudeDir, '.credentials.lock'),
      ensureDir: () => mkdirSync(claudeDir, { recursive: true }),
      read: () => storage.read(),
      update: (blob: SecureStorageData) => storage.update(blob),
      clearCache: clearKeychainCache,
      log: (msg: string) => logForDebugging(msg),
    },
    updater as (blob: SecureStorageData | null) => SecureStorageData,
  )
}
