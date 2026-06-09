import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  open,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Crash-safe, durable file write: stream the data into a sibling temp file, fsync it, then
// atomically rename it onto the target (and fsync the directory so the rename survives a
// power loss). A killed process / interrupted write / ENOSPC leaves the ORIGINAL file fully
// intact — unlike a direct writeFile(target), which opens the target with O_TRUNC and
// overwrites it in place, so an interrupted write corrupts the user's existing file.
//
// Behavior is kept identical to the in-place write it replaces:
//   - A SYMLINK target is followed (realpath for a resolvable link, readlink for a dangling
//     one) so the link's target is updated/created and the symlink itself is preserved — not
//     replaced — matching writeFile's symlink-following.
//   - An existing file's MODE is preserved (rename installs a new inode, so the old permission
//     bits are chmod'd onto the temp first); a brand-new file keeps the platform default
//     (umask-masked 0o666), identical to the prior direct write.
//   - A non-writable existing file still fails with EACCES — rename is gated on the PARENT
//     directory's permission, not the target's, so without this check a read-only file that
//     the old write rejected would be silently replaced.
//   - A missing parent directory still throws ENOENT (the directory is not created).
//
// Inherent tradeoff of atomic replacement (shared by every tmp+rename writer): a NEW inode is
// installed, so a hardlink to the old file is broken and owner/group/ACLs/xattrs are not
// carried over — only the mode bits are. On any error the temp is removed (best-effort) and
// the original error is rethrown.
export async function atomicWriteFile(filePath, data) {
  let target = filePath
  let existingMode
  try {
    target = await realpath(filePath) // follow symlinks → write through to the real file
    existingMode = (await stat(target)).mode
    await access(target, fsConstants.W_OK) // preserve the old EACCES on a read-only target
  } catch (error) {
    if (error?.code === 'EACCES') throw error
    existingMode = undefined
    // realpath failed: either a brand-new file (nothing at the path) or a DANGLING symlink
    // (the link exists but its target does not yet). For a dangling link, follow it one level
    // so we create the link's target and preserve the link itself — matching the old write-
    // through; otherwise write a new file at the lexical path with the default mode.
    try {
      const linkDest = await readlink(filePath)
      target = resolve(dirname(filePath), linkDest)
    } catch {
      target = filePath
    }
  }

  const tmpPath = `${target}.${randomUUID()}.tmp`
  try {
    const handle = await open(tmpPath, 'wx')
    try {
      await handle.writeFile(data)
      await handle.sync() // flush the data to disk before it becomes the target
    } finally {
      await handle.close()
    }
    if (existingMode !== undefined) await chmod(tmpPath, existingMode)
    await rename(tmpPath, target)
    await fsyncDir(dirname(target)) // make the rename itself durable (best-effort)
  } catch (error) {
    try {
      await unlink(tmpPath)
    } catch {
      // the temp may never have been created (e.g. ENOENT parent) — ignore
    }
    throw error
  }
}

// fsync a directory so a contained rename survives a crash. Best-effort: some platforms
// (notably Windows) cannot open a directory as a handle — there the rename is still atomic,
// just not flushed.
async function fsyncDir(dir) {
  let handle
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  } catch {
    // unsupported on this platform — leave durability to the OS
  } finally {
    await handle?.close()
  }
}
