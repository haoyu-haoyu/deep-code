import { Text } from '../ink.js'
import { formatTurnTokenStatus } from './costStatusData.mjs'

type TurnUsage = {
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
} | null

type Props = {
  usage?: TurnUsage
  model?: string
}

/**
 * Footer chip: the latest turn's input↑ / output↓ tokens, cache hit-rate, and the
 * $ saved by cache hits. Presentational — the data lives in the pure, tested
 * costStatusData core. Renders nothing when there is no usage yet.
 */
export function CostStatusChip({ usage, model }: Props) {
  const text = formatTurnTokenStatus({ usage, model })
  if (!text) return null
  return <Text dimColor>{text}</Text>
}

export default CostStatusChip
