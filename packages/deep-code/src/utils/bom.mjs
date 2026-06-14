// Single source of truth for leading byte-order-mark (BOM) handling, shared by
// the file read, staleness-comparison, and write paths so they all agree on
// exactly what "the BOM" is.
//
// Once a file buffer is decoded to a JS string with its detected encoding, the
// BOM is a single leading U+FEFF code point for BOTH supported encodings: UTF-8
// (bytes EF BB BF) and UTF-16LE (bytes FF FE). So leading-BOM handling is one
// string-level operation regardless of the on-disk encoding.

const BOM = '\uFEFF'

/**
 * Remove a single leading BOM (U+FEFF) if present; otherwise return the string
 * unchanged. Idempotent and safe on the empty string ('' has no char at 0).
 *
 * Used to normalize the two read paths before a content-equality check: the
 * range reader (readFileInRange) strips the BOM, while the whole-file readers
 * (readFileSyncWithMetadata / readFileBytes.toString) keep it, so a comparison
 * between them must strip both sides or an unmodified BOM file is falsely
 * flagged as changed.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripLeadingBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Ensure a non-empty string starts with a BOM (U+FEFF). Idempotent: a string
 * that already begins with the BOM is returned unchanged; the empty string is
 * left empty (so an emptied file isn't materialized as a 2-byte BOM-only file).
 *
 * Used when writing a UTF-16LE file: its encoding is auto-detected on the next
 * read solely by the leading BOM bytes (FF FE), and Node's utf16le encoder does
 * NOT emit them. Without re-adding the marker, an overwritten UTF-16LE file is
 * re-detected as UTF-8 on the next read and decoded into interleaved-null
 * garbage.
 *
 * @param {string} text
 * @returns {string}
 */
export function ensureLeadingBom(text) {
  if (text.length === 0) return text
  return text.charCodeAt(0) === 0xfeff ? text : BOM + text
}
