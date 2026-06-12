import { closeSync, fstatSync, ftruncateSync, openSync, readSync } from 'node:fs'

const SCAN_CHUNK_BYTES = 4_096

// Drop a crash-truncated trailing partial line before anything appends to the
// transcript. Every transcript reader already DROPS a trailing half-write (the
// CLI was killed mid-append) — but only while it stays trailing: the moment a
// resume appends new entries after it, the partial line sits mid-file and the
// readers treat it as real corruption (`session fork` hard-throws, `session
// list` flags the session corrupt, permanently). Merely newline-terminating it
// is not enough — that just turns glue-corruption into a standalone malformed
// mid-file line, which is equally fatal. Truncating to the last complete line
// makes the on-disk bytes match what every reader already presents; the only
// bytes lost are a half-written entry no reader would ever parse.
//
// Returns true when bytes were dropped. Sync on purpose: the resume adoption
// path that calls it is sync, and the repair must land before the first
// append races it.
export function dropTruncatedTail(filePath) {
  let fd
  try {
    fd = openSync(filePath, 'r+')
  } catch {
    // missing or unreadable file — nothing to repair, the writer will create it
    return false
  }
  try {
    const { size } = fstatSync(fd)
    if (size === 0) return false
    const lastByte = Buffer.alloc(1)
    readSync(fd, lastByte, 0, 1, size - 1)
    if (lastByte[0] === 0x0a) return false

    // Scan backwards for the last newline; everything after it is the
    // half-written entry.
    const chunk = Buffer.alloc(SCAN_CHUNK_BYTES)
    let scanEnd = size - 1
    while (scanEnd > 0) {
      const scanStart = Math.max(0, scanEnd - SCAN_CHUNK_BYTES)
      const length = scanEnd - scanStart
      readSync(fd, chunk, 0, length, scanStart)
      const offset = chunk.lastIndexOf(0x0a, length - 1)
      if (offset !== -1) {
        ftruncateSync(fd, scanStart + offset + 1)
        return true
      }
      scanEnd = scanStart
    }
    // No newline anywhere: the whole file is one half-written line.
    ftruncateSync(fd, 0)
    return true
  } finally {
    closeSync(fd)
  }
}
