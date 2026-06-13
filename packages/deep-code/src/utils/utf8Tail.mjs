import { open } from 'node:fs/promises'

/**
 * Decode a UTF-8 buffer slice while skipping leading continuation
 * bytes. Used when a slice point may have landed mid-codepoint (e.g.
 * a tail-of-file read whose start position is not codepoint-aligned).
 * The skipped bytes were always part of a codepoint that started
 * before the slice; treating the slice as starting at the next valid
 * codepoint is the lossless interpretation.
 *
 * Pure JS / no `src/*` imports so this module is loadable directly
 * by `node --test` without the Bun-build harness.
 */
export function decodeUtf8AtBoundary(buffer, start = 0, end = buffer.length) {
  let s = start
  while (s < end && (buffer[s] & 0xc0) === 0x80) {
    s++
  }
  return buffer.toString('utf8', s, end)
}

/**
 * Given a buffer and a candidate end `length`, return the largest end `<= length`
 * that falls on a complete UTF-8 codepoint boundary — i.e. trim a trailing
 * multibyte codepoint that was cut off by a byte-count cap.
 *
 * This is the TAIL mirror of {@link decodeUtf8AtBoundary} (which skips a partial
 * codepoint at the HEAD). A byte-capped read (e.g. the first N bytes of a long
 * command's output) can land mid-codepoint, and `Buffer.toString('utf8')` would
 * emit a U+FFFD replacement char for the dangling bytes. Trimming to this boundary
 * — AND reporting the trimmed length as bytesRead — lets a byte-offset delta reader
 * resume exactly on the boundary so the next read starts on a clean lead byte.
 *
 * Only apply when more bytes follow in the file; a genuinely truncated final
 * codepoint at EOF must NOT be trimmed away (it is real, if invalid, data).
 *
 * Pure JS / no `src/*` imports so this module is loadable directly by `node --test`.
 */
export function trimTrailingPartialUtf8(buffer, length) {
  const end = Math.max(0, Math.min(length, buffer.length))
  if (end === 0) return 0
  // Walk back over trailing continuation bytes (10xxxxxx) to the lead byte of the
  // final codepoint.
  let i = end - 1
  while (i >= 0 && (buffer[i] & 0xc0) === 0x80) {
    i--
  }
  // All bytes were continuation bytes: the lead is before the slice (a head-boundary
  // case the caller handles separately) — nothing to trim at the tail.
  if (i < 0) return end
  const lead = buffer[i]
  let expected
  if ((lead & 0x80) === 0x00) expected = 1
  else if ((lead & 0xe0) === 0xc0) expected = 2
  else if ((lead & 0xf0) === 0xe0) expected = 3
  else if ((lead & 0xf8) === 0xf0) expected = 4
  // Not a valid lead byte (continuation byte impossible here, or 0xF8-0xFF): treat
  // as a single byte so we never trim valid data preceding it.
  else expected = 1
  // The final codepoint extends past the slice end → it was truncated; drop it.
  return i + expected > end ? i : end
}

/**
 * Read the last `maxBytes` of a file, returning the raw `Buffer` so
 * callers can do byte-correct slicing (UTF-8 boundary alignment,
 * byte-length deltas) without re-encoding an already-decoded string.
 *
 * The decoded `tailFile()` in fsOperations is lossy at the head
 * boundary: when the last `maxBytes` of a file begin mid-codepoint,
 * `Buffer.toString('utf8')` inserts U+FFFD replacement characters
 * whose 3-byte UTF-8 encoding differs from the original bytes.
 * Re-encoding that string back to a Buffer (e.g. for byte-aligned
 * slicing) gives the wrong byte positions. Callers that need
 * byte-accurate behavior should use this function and decode at safe
 * boundaries themselves via {@link decodeUtf8AtBoundary}.
 */
export async function tailFileRaw(path, maxBytes) {
  const fh = await open(path, 'r')
  try {
    const size = (await fh.stat()).size
    if (size === 0) {
      return { buffer: Buffer.alloc(0), bytesRead: 0, bytesTotal: 0 }
    }
    const offset = Math.max(0, size - maxBytes)
    const bytesToRead = size - offset
    const buffer = Buffer.allocUnsafe(bytesToRead)

    let totalRead = 0
    while (totalRead < bytesToRead) {
      const { bytesRead } = await fh.read(
        buffer,
        totalRead,
        bytesToRead - totalRead,
        offset + totalRead,
      )
      if (bytesRead === 0) {
        break
      }
      totalRead += bytesRead
    }

    return {
      buffer: buffer.subarray(0, totalRead),
      bytesRead: totalRead,
      bytesTotal: size,
    }
  } finally {
    await fh.close()
  }
}
