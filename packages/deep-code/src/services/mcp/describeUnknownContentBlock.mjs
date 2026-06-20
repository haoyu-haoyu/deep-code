// Placeholder text for an MCP content block whose `type` this client doesn't
// render — a future MCP spec type, or a non-conformant server sending a custom
// type. transformResultContent handles text/image/audio/resource/resource_link;
// its `default` case previously returned [] and SILENTLY DROPPED the block,
// which contradicts the rule the surrounding cases follow ("surface a text
// reference … rather than silently dropping the block"). Surfacing a placeholder
// lets the model learn the block existed instead of losing it without a trace.
//
// @param {unknown} type        the unrecognized content block `type`
// @param {string} serverName
// @returns {string}
export function describeUnknownContentBlock(type, serverName) {
  const t = typeof type === 'string' && type.length > 0 ? type : 'unknown'
  return `[Unsupported content block type "${t}" from MCP server "${serverName}"]`
}
