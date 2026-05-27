import { Text } from '../ink.js'
import { getSessionTotals } from '../cache/deepseek-cache.mjs'
import {
  formatCacheStatusText,
  resolveCurrentCacheStatusProvider,
} from './cacheStatusChipData.mjs'

type CacheStatusProvider = {
  supports?: (capability: string) => boolean
}

type CacheStatusTotals = {
  totalHit: number
  totalMiss: number
  hitRate: number
  turnCount?: number
}

type Props = {
  provider?: CacheStatusProvider
  totals?: CacheStatusTotals
}

export function CacheStatusChip({
  provider = resolveCurrentCacheStatusProvider(),
  totals = getSessionTotals(),
}: Props) {
  const text = formatCacheStatusText({ provider, totals })
  if (!text) return null
  return <Text dimColor>{text}</Text>
}

export default CacheStatusChip
