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
