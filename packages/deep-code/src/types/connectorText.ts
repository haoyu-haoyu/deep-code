export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
  signature?: string
}

export function isConnectorTextBlock(
  block: unknown,
): block is ConnectorTextBlock {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type?: unknown }).type === 'connector_text' &&
    'connector_text' in block &&
    typeof (block as { connector_text?: unknown }).connector_text === 'string'
  )
}
