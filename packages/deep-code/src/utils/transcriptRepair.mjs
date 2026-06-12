import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs'

const SCAN_CHUNK_BYTES = 4_096

// Repair a crash-truncated transcript tail before anything appends. A crash
// mid-append leaves the file ending without a newline, in one of two shapes:
//
// 1. A COMPLETE JSON record whose trailing '\n' never landed. Readers accept
//    this today (the unterminated last line parses), so the record must be
//    PRESERVED — just terminate it. Truncating here would silently delete a
//    valid entry (e.g. a custom-title/tag record the tail refresh absorbs).
// 2. A genuinely HALF-WRITTEN record. Readers DROP a trailing half-write,
//    but only while it stays trailing: once resume appends after it, the
//    malformed line sits mid-file and fork hard-throws / session list flags
//    the session corrupt, permanently. Newline-terminating it would NOT help
//    (a standalone malformed mid-file line is equally fatal) — truncate to
//    the last complete line, dropping exactly the bytes readers already
//    discard on read.
//
// Returns 'terminated' | 'truncated' | false. Sync on purpose: the resume
// adoption path that calls it is sync, and the repair must land before the
// first append races it.
export function repairTranscriptTail(filePath) {
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

    const tailStart = findLastNewline(fd, size) + 1
    const tail = Buffer.alloc(size - tailStart)
    readSync(fd, tail, 0, tail.length, tailStart)
    if (isCompleteJsonLine(tail)) {
      writeSync(fd, '\n', size)
      return 'terminated'
    }
    ftruncateSync(fd, tailStart)
    return 'truncated'
  } finally {
    closeSync(fd)
  }
}

// Offset of the last 0x0a before EOF, or -1. Chunked backwards scan so a
// multi-megabyte half-written line cannot force a whole-file read.
function findLastNewline(fd, size) {
  const chunk = Buffer.alloc(SCAN_CHUNK_BYTES)
  let scanEnd = size - 1
  while (scanEnd > 0) {
    const scanStart = Math.max(0, scanEnd - SCAN_CHUNK_BYTES)
    const length = scanEnd - scanStart
    readSync(fd, chunk, 0, length, scanStart)
    const offset = chunk.lastIndexOf(0x0a, length - 1)
    if (offset !== -1) return scanStart + offset
    scanEnd = scanStart
  }
  return -1
}

function isCompleteJsonLine(tail) {
  const text = tail.toString('utf8').trim()
  if (text.length === 0) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
