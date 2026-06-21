// Per-result MEDIA-block budget for an MCP tool/resource result.
//
// transformMCPResult decodes every block of a server-supplied result.content array
// in parallel: image/audio blocks do Buffer.from(base64) + a full sharp pixel
// decode, and blob resources do Buffer.from + a disk write. The array length is
// entirely server-controlled and there was NO count cap and NO concurrency limit
// (an unbounded Promise.allSettled over blocks.map), so a hostile-but-connected MCP
// server returning hundreds of media blocks (each tiny on the wire but huge once
// decoded) could spike client RSS to multi-GB and OOM-crash the CLI — before any
// downstream truncation runs. API_MAX_MEDIA_PER_REQUEST (the Anthropic API's own
// per-request media ceiling) was defined but never enforced.
//
// This computes which block INDICES exceed the per-result media budget so the caller
// can skip their decode (degrading them to a text placeholder via the existing
// rejected-block path). Counts ONLY media blocks (image / audio / blob-bearing
// resource) in order — the first `maxMedia` are allowed, the rest are over budget;
// cheap text/structured/resource_link blocks never count and are always processed.
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

export function overBudgetMediaIndices(blocks, maxMedia) {
  const over = new Set()
  if (!Array.isArray(blocks)) return over
  let mediaSeen = 0
  for (let i = 0; i < blocks.length; i++) {
    if (!isMediaBlock(blocks[i])) continue
    mediaSeen += 1
    if (mediaSeen > maxMedia) over.add(i)
  }
  return over
}
