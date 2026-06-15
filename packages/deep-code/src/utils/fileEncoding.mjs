// Single source of truth for the byte-level text-encoding decision, shared by
// detectEncodingForResolvedPath (which readSync's a 4 KB head) and the
// readFileInRange fast path (which already holds the whole-file buffer, so it
// detects with zero extra I/O).
//
// DeepCode only distinguishes the two encodings a leading BOM can announce:
//   - UTF-16LE: bytes FF FE
//   - UTF-8   : bytes EF BB BF, and everything else (UTF-8 is an ASCII superset
//               and the safe default for un-marked content)
// The detected encoding is handed to Node's decoder; the resulting leading
// U+FEFF is then dropped by stripLeadingBom (see bom.mjs) for both encodings.
//
// Returns a BufferEncoding string ('utf16le' | 'utf8'). `bytesRead` is the
// number of valid bytes in `buffer` (a partial head or a whole file).
export function detectEncodingFromHeadBytes(buffer, bytesRead) {
  // Empty files default to utf8 (utf16le on a 0-byte file would be pointless and
  // writing emoji/CJK into an empty file must not be mis-encoded).
  if (bytesRead === 0) return 'utf8'
  if (bytesRead >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  // EF BB BF (utf8 BOM) and all un-marked content both decode as utf8.
  return 'utf8'
}
