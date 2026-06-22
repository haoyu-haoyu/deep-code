// Pure display formatters — leaf-safe (no Ink). Width-aware truncation lives in ./truncate.ts.

import { getRelativeTimeFormat, getTimeZone } from './intl.js'
// Byte-band formatting lives in a pure leaf (chooses the unit AFTER rounding so
// a just-under-threshold value never renders a nonsensical "1024KB").
import { formatFileSize } from './fileSize.mjs'
import { formatRelativeTimeCore } from './relativeTimeCore.mjs'

export { formatFileSize }

/**
 * Formats milliseconds as seconds with 1 decimal place (e.g. `1234` → `"1.2s"`).
 * Unlike formatDuration, always keeps the decimal — use for sub-minute timings
 * where the fractional second is meaningful (TTFT, hook durations, etc.).
 */
export function formatSecondsShort(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatDuration(
  ms: number,
  options?: { hideTrailingZeros?: boolean; mostSignificantOnly?: boolean },
): string {
  if (ms < 60000) {
    // Special case for 0
    if (ms === 0) {
      return '0s'
    }
    // For durations < 1s, show 1 decimal place (e.g., 0.5s)
    if (ms < 1) {
      const s = (ms / 1000).toFixed(1)
      return `${s}s`
    }
    const s = Math.floor(ms / 1000).toString()
    return `${s}s`
  }

  let days = Math.floor(ms / 86400000)
  let hours = Math.floor((ms % 86400000) / 3600000)
  let minutes = Math.floor((ms % 3600000) / 60000)
  let seconds = Math.round((ms % 60000) / 1000)

  // Handle rounding carry-over (e.g., 59.5s rounds to 60s)
  if (seconds === 60) {
    seconds = 0
    minutes++
  }
  if (minutes === 60) {
    minutes = 0
    hours++
  }
  if (hours === 24) {
    hours = 0
    days++
  }

  const hide = options?.hideTrailingZeros

  if (options?.mostSignificantOnly) {
    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    if (minutes > 0) return `${minutes}m`
    return `${seconds}s`
  }

  if (days > 0) {
    if (hide && hours === 0 && minutes === 0) return `${days}d`
    if (hide && minutes === 0) return `${days}d ${hours}h`
    return `${days}d ${hours}h ${minutes}m`
  }
  if (hours > 0) {
    if (hide && minutes === 0 && seconds === 0) return `${hours}h`
    if (hide && seconds === 0) return `${hours}h ${minutes}m`
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    if (hide && seconds === 0) return `${minutes}m`
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

// `new Intl.NumberFormat` is expensive, so cache formatters for reuse
let numberFormatterForConsistentDecimals: Intl.NumberFormat | null = null
let numberFormatterForInconsistentDecimals: Intl.NumberFormat | null = null
const getNumberFormatter = (
  useConsistentDecimals: boolean,
): Intl.NumberFormat => {
  if (useConsistentDecimals) {
    if (!numberFormatterForConsistentDecimals) {
      numberFormatterForConsistentDecimals = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      })
    }
    return numberFormatterForConsistentDecimals
  } else {
    if (!numberFormatterForInconsistentDecimals) {
      numberFormatterForInconsistentDecimals = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      })
    }
    return numberFormatterForInconsistentDecimals
  }
}

export function formatNumber(number: number): string {
  // Only use minimumFractionDigits for numbers that will be shown in compact notation
  const shouldUseConsistentDecimals = number >= 1000

  return getNumberFormatter(shouldUseConsistentDecimals)
    .format(number) // eg. "1321" => "1.3K", "900" => "900"
    .toLowerCase() // eg. "1.3K" => "1.3k", "1.0K" => "1.0k"
}

export function formatTokens(count: number): string {
  return formatNumber(count).replace('.0', '')
}

type RelativeTimeStyle = 'long' | 'short' | 'narrow'

type RelativeTimeOptions = {
  style?: RelativeTimeStyle
  numeric?: 'always' | 'auto'
}

export function formatRelativeTime(
  date: Date,
  options: RelativeTimeOptions & { now?: Date } = {},
): string {
  const { style = 'narrow', numeric = 'always', now = new Date() } = options
  // The interval table + narrow/short/long + sub-second logic live in the pure,
  // node-testable relativeTimeCore leaf; getRelativeTimeFormat (the cached Intl
  // formatter) is injected so the leaf stays free of the intl.ts cache.
  return formatRelativeTimeCore(
    date.getTime() - now.getTime(),
    style,
    numeric,
    getRelativeTimeFormat,
  )
}

export function formatRelativeTimeAgo(
  date: Date,
  options: RelativeTimeOptions & { now?: Date } = {},
): string {
  const { now = new Date(), ...restOptions } = options
  if (date > now) {
    // For future dates, just return the relative time without "ago"
    return formatRelativeTime(date, { ...restOptions, now })
  }

  // For past dates, force numeric: 'always' to ensure we get "X units ago"
  return formatRelativeTime(date, { ...restOptions, numeric: 'always', now })
}

/**
 * Formats log metadata for display (time, size or message count, branch, tag, PR)
 */
export function formatLogMetadata(log: {
  modified: Date
  messageCount: number
  fileSize?: number
  gitBranch?: string
  tag?: string
  agentSetting?: string
  prNumber?: number
  prRepository?: string
}): string {
  const sizeOrCount =
    log.fileSize !== undefined
      ? formatFileSize(log.fileSize)
      : `${log.messageCount} messages`
  const parts = [
    formatRelativeTimeAgo(log.modified, { style: 'short' }),
    ...(log.gitBranch ? [log.gitBranch] : []),
    sizeOrCount,
  ]
  if (log.tag) {
    parts.push(`#${log.tag}`)
  }
  if (log.agentSetting) {
    parts.push(`@${log.agentSetting}`)
  }
  if (log.prNumber) {
    parts.push(
      log.prRepository
        ? `${log.prRepository}#${log.prNumber}`
        : `#${log.prNumber}`,
    )
  }
  return parts.join(' · ')
}

export function formatResetTime(
  timestampInSeconds: number | undefined,
  showTimezone: boolean = false,
  showTime: boolean = true,
): string | undefined {
  if (!timestampInSeconds) return undefined

  const date = new Date(timestampInSeconds * 1000)
  const now = new Date()
  const minutes = date.getMinutes()

  // Calculate hours until reset
  const hoursUntilReset = (date.getTime() - now.getTime()) / (1000 * 60 * 60)

  // If reset is more than 24 hours away, show the date as well
  if (hoursUntilReset > 24) {
    // Show date and time for resets more than a day away
    const dateOptions: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: showTime ? 'numeric' : undefined,
      minute: !showTime || minutes === 0 ? undefined : '2-digit',
      hour12: showTime ? true : undefined,
    }

    // Add year if it's not the current year
    if (date.getFullYear() !== now.getFullYear()) {
      dateOptions.year = 'numeric'
    }

    const dateString = date.toLocaleString('en-US', dateOptions)

    // Remove the space before AM/PM and make it lowercase
    return (
      dateString.replace(/ ([AP]M)/i, (_match, ampm) => ampm.toLowerCase()) +
      (showTimezone ? ` (${getTimeZone()})` : '')
    )
  }

  // For resets within 24 hours, show just the time (existing behavior)
  const timeString = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: minutes === 0 ? undefined : '2-digit',
    hour12: true,
  })

  // Remove the space before AM/PM and make it lowercase, then add timezone
  return (
    timeString.replace(/ ([AP]M)/i, (_match, ampm) => ampm.toLowerCase()) +
    (showTimezone ? ` (${getTimeZone()})` : '')
  )
}

export function formatResetText(
  resetsAt: string,
  showTimezone: boolean = false,
  showTime: boolean = true,
): string {
  const dt = new Date(resetsAt)
  return `${formatResetTime(Math.floor(dt.getTime() / 1000), showTimezone, showTime)}`
}

// Back-compat: truncate helpers moved to ./truncate.ts (needs ink/stringWidth)
export {
  truncate,
  truncatePathMiddle,
  truncateStartToWidth,
  truncateToWidth,
  truncateToWidthNoEllipsis,
  wrapText,
} from './truncate.js'
