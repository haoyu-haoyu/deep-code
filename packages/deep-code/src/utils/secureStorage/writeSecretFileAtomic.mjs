import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { SECURE_FILE_MODE, SECURE_DIR_MODE } from '../secureFileMode.mjs'

// Atomic, owner-only write for a secret-bearing file (the non-macOS credentials
// store ~/.deepcode/.credentials.json holds MCP OAuth / IdP / plugin secrets).
// Mirrors the deepseek-config-store API-key writer exactly:
//   - the temp file is created at 0o600 from its FIRST byte (mode on writeFileSync)
//     — no chmod-AFTER-write window where the secret would sit world-readable on
//     disk (the prior code wrote with no mode → born 0o644 under a 022 umask →
//     chmod 0o600 only on the next line);
//   - a belt-and-suspenders chmodSync covers any platform/umask that ignored the
//     mode hint (POSIX-only, safe to fail);
//   - rename atomically replaces the target, so a crash mid-write can't corrupt
//     the live secret file (the prior in-place writeFileSync truncated it);
//   - the containing dir is created owner-only (0o700).
// On any error the temp file is removed and the original is left untouched.
//
// Stays synchronous — it backs the sync SecureStorage.update() leaf; the async
// atomicWriteFile is not usable there.
export function writeSecretFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: SECURE_DIR_MODE })
  const tmpPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, data, { encoding: 'utf8', mode: SECURE_FILE_MODE })
    // Hardening for any platform/umask combo that ignored the mode hint above.
    try {
      chmodSync(tmpPath, SECURE_FILE_MODE)
    } catch {
      // POSIX-only; safe to fail (e.g. NTFS).
    }
    renameSync(tmpPath, path)
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // The temp may not exist if writeFileSync failed before creating it.
    }
    throw error
  }
}
