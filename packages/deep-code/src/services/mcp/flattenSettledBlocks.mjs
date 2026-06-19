// Flatten the per-block transform outcomes of an MCP tool result.
//
// Each content block is transformed independently (Promise.allSettled in the
// caller), so a single block that throws — e.g. a corrupt/empty/oversized image
// the resizer rejects, or an audio block missing its data — degrades to a text
// placeholder instead of rejecting the WHOLE result via Promise.all and
// discarding every valid sibling block (the text answer the model actually
// needs). Pure & node-testable; the .ts caller owns the async transform + logging.

/**
 * @param {ReadonlyArray<{status:'fulfilled',value:any[]}|{status:'rejected',reason:unknown}>} settled
 *   the Promise.allSettled outcomes, one per input block, in order
 * @param {readonly unknown[]} blocks the original content blocks (for the type label)
 * @param {string} serverName for the placeholder text
 * @returns {{ content: any[], rejected: Array<{ blockType: string, reason: string }> }}
 *   the flattened content (valid blocks + a text placeholder per failure), and the
 *   per-failure details for the caller to log.
 */
export function flattenSettledBlocks(settled, blocks, serverName) {
  const content = []
  const rejected = []
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome && outcome.status === 'fulfilled') {
      for (const block of outcome.value) content.push(block)
      continue
    }
    const raw = blocks[i]
    const blockType =
      raw && typeof raw === 'object' && 'type' in raw
        ? String(raw.type)
        : 'block'
    const reasonValue = outcome ? outcome.reason : undefined
    const reason =
      reasonValue instanceof Error ? reasonValue.message : String(reasonValue)
    rejected.push({ blockType, reason })
    content.push({
      type: 'text',
      text: `[${blockType} block from ${serverName} could not be rendered: ${reason}]`,
    })
  }
  return { content, rejected }
}
