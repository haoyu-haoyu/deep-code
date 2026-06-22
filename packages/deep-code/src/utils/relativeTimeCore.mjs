import { subSecondRelativeNarrow } from './relativeTimeDirection.mjs'

// Largest-to-smallest interval table. `shortUnit` is the custom narrow-style
// suffix; `unit` is the Intl.RelativeTimeFormat unit for short/long styles.
const INTERVALS = [
  { unit: 'year', seconds: 31536000, shortUnit: 'y' },
  { unit: 'month', seconds: 2592000, shortUnit: 'mo' },
  { unit: 'week', seconds: 604800, shortUnit: 'w' },
  { unit: 'day', seconds: 86400, shortUnit: 'd' },
  { unit: 'hour', seconds: 3600, shortUnit: 'h' },
  { unit: 'minute', seconds: 60, shortUnit: 'm' },
  { unit: 'second', seconds: 1, shortUnit: 's' },
]

/**
 * Pure core of formatRelativeTime. `getFormat` is injected (the real one is
 * intl.ts's cached getRelativeTimeFormat) so this leaf stays free of the Intl
 * cache and is node-testable.
 *
 * The narrow style uses the custom compact suffixes ("5m ago" / "in 3h"). For
 * 'short' and 'long', the REQUESTED style is forwarded to getFormat — the prior
 * inline version hardcoded 'long', so a requested 'short' style was silently
 * rendered in long form ("5 minutes ago" instead of "5 min. ago") for every
 * interval unit whose English short/long forms differ (minute, hour, month,
 * year, …). Sub-second deltas defer the direction to subSecondRelativeNarrow.
 *
 * @param {number} diffInMs  date.getTime() - now.getTime()
 * @param {'long' | 'short' | 'narrow'} style
 * @param {'always' | 'auto'} numeric
 * @param {(style: 'long' | 'short' | 'narrow', numeric: 'always' | 'auto') => Intl.RelativeTimeFormat} getFormat
 * @returns {string}
 */
export function formatRelativeTimeCore(diffInMs, style, numeric, getFormat) {
  // Truncate towards zero for both positive and negative values.
  const diffInSeconds = Math.trunc(diffInMs / 1000)

  for (const { unit, seconds, shortUnit } of INTERVALS) {
    if (Math.abs(diffInSeconds) >= seconds) {
      const value = Math.trunc(diffInSeconds / seconds)
      if (style === 'narrow') {
        return diffInSeconds < 0
          ? `${Math.abs(value)}${shortUnit} ago`
          : `in ${value}${shortUnit}`
      }
      return getFormat(style, numeric).format(value, unit)
    }
  }

  // Values less than 1 second.
  if (style === 'narrow') {
    return subSecondRelativeNarrow(diffInMs)
  }
  return getFormat(style, numeric).format(0, 'second')
}
