/**
 * Derive a 'YYYY-MM-DD' day key from a Date's LOCAL calendar components.
 *
 * /stats buckets a session under the day key of its event timestamp, and the
 * heatmap, streak counter, and "today"/"yesterday" anchors all build LOCAL
 * Date objects (new Date(); setHours(0,0,0,0); setDate(getDate()±1)) and key
 * them through this function. Deriving the key from UTC (date.toISOString())
 * disagreed with those local anchors by the UTC offset: for a user east of UTC,
 * a session at e.g. 10:00 local keyed to the UTC calendar date, which the
 * local-anchored heatmap cell for that day never queried — so today's activity
 * never appeared and the current streak was short by one. Keying by the LOCAL
 * calendar day (matching the anchors and the formatDateKeyLabel render) makes the
 * bucket the user's own calendar day.
 *
 * Throws on an Invalid Date, matching the previous toISOString()-based behavior
 * (callers already guard malformed timestamps before keying).
 *
 * @param {Date} date
 * @returns {string} 'YYYY-MM-DD' in the local timezone
 */
export function toLocalDateKey(date) {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid Date')
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
