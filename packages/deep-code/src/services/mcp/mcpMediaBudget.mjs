// Per-result MEDIA-block budget for an MCP tool/resource result.
//
// transformMCPResult decodes every block of a server-supplied result.content array
// in parallel: image/audio blocks do Buffer.from(base64) + a full sharp pixel
// decode, and blob resources do Buffer.from + a disk write. The array length and
// each block's payload size are entirely server-controlled. Two axes are bounded
// here so a hostile-but-connected MCP server can't OOM the client or fill its disk:
//
//  (1) COUNT: only the first `maxMedia` media blocks are decoded — the rest degrade
//      to a text placeholder via the existing rejected-block path.
//  (2) PER-BLOCK SIZE: a single block whose decoded byte size exceeds
//      `maxDecodedBytesPerBlock` is rejected too. This matters because the image
//      pixel-bomb gate (exceedsDecodePixelBudget) runs only AFTER the full
//      base64 -> Buffer.from allocation, and audio / non-image blobs have NO gate at
//      all — they go straight to Buffer.from + a disk write. Rejecting from the
//      base64 STRING length (no allocation, no decode, no disk I/O) bounds the peak
//      cost before any of that happens, on BOTH the tool and prompt paths.
//
// Cheap text/structured/resource_link blocks never count toward either axis and are
// always processed (a large text block is bounded downstream by output truncation,
// and never hits Buffer.from / disk here).
//
// Pure value-in/value-out so it is node-testable (client.ts is bun-tainted).
function isMediaBlock(block) {
  if (!block || typeof block !== 'object') return false
  if (block.type === 'image' || block.type === 'audio') return true
  if (block.type === 'resource') {
    const resource = block.resource
    return !!(
      resource &&
      typeof resource === 'object' &&
      typeof resource.blob === 'string'
    )
  }
  return false
}

// Length of the server-supplied base64 payload a media block would feed to
// Buffer.from (image/audio `.data`, or a resource `.blob`). 0 for anything without
// a string payload (so it never trips the size cap).
function mediaBlockBase64Length(block) {
  if (!block || typeof block !== 'object') return 0
  if (block.type === 'image' || block.type === 'audio') {
    return typeof block.data === 'string' ? block.data.length : 0
  }
  if (block.type === 'resource') {
    const resource = block.resource
    if (
      resource &&
      typeof resource === 'object' &&
      typeof resource.blob === 'string'
    ) {
      return resource.blob.length
    }
  }
  return 0
}

// Decoded byte size of a base64 string of length `base64Length` (3 bytes per 4
// chars). Padding makes this a slight over-estimate, which is the safe direction
// for a ceiling. Pure.
export function base64DecodedByteLength(base64Length) {
  if (!base64Length || base64Length < 0) return 0
  return Math.floor((base64Length * 3) / 4)
}

/**
 * Indices of media blocks that must NOT be decoded, mapped to WHY:
 *  - 'count': beyond the per-result media-count budget (`maxMedia`)
 *  - 'size' : a single block whose decoded bytes exceed `maxDecodedBytesPerBlock`
 *
 * Returns a Map so callers can surface an accurate placeholder reason. `.has(i)`
 * works exactly as the old Set did. Non-media blocks are never included.
 *
 * @param {unknown[]} blocks
 * @param {number} maxMedia
 * @param {number} [maxDecodedBytesPerBlock=Infinity]
 * @returns {Map<number, 'count' | 'size'>}
 */
export function overBudgetMediaIndices(
  blocks,
  maxMedia,
  maxDecodedBytesPerBlock = Infinity,
) {
  const over = new Map()
  if (!Array.isArray(blocks)) return over
  let mediaSeen = 0
  for (let i = 0; i < blocks.length; i++) {
    if (!isMediaBlock(blocks[i])) continue
    mediaSeen += 1
    if (mediaSeen > maxMedia) {
      over.set(i, 'count')
      continue
    }
    if (
      base64DecodedByteLength(mediaBlockBase64Length(blocks[i])) >
      maxDecodedBytesPerBlock
    ) {
      over.set(i, 'size')
    }
  }
  return over
}

/**
 * Human/model-facing reason text for a degraded media block, given the reason code
 * from overBudgetMediaIndices. Pure; the caller passes the in-scope limit values.
 *
 * @param {'count' | 'size' | undefined} code
 * @param {number} maxMedia
 * @param {string} maxBytesLabel  pre-formatted byte limit (e.g. "100 MB")
 */
export function mediaBudgetRejectionReason(code, maxMedia, maxBytesLabel) {
  return code === 'size'
    ? `exceeds the per-result media block size limit of ${maxBytesLabel}`
    : `exceeds the per-result media budget of ${maxMedia}`
}
