/**
 * Advance a 'YYYY-MM-DD' day key by exactly one calendar day, in UTC.
 *
 * The stats cache stores day keys as UTC calendar dates (toDateString =
 * date.toISOString().split('T')[0]) and walks forward from cache.lastComputedDate
 * with this function. The previous implementation parsed the key as a UTC instant
 * (`new Date('YYYY-MM-DD')` is UTC midnight) but incremented it with the LOCAL
 * setDate/getDate, then re-serialized in UTC. On a DST spring-forward day the
 * lost local hour meant a +1 LOCAL-day step landed back inside the SAME UTC date,
 * so getNextDay returned its own input — the incremental cache update then
 * re-processed that day and permanently DOUBLE-COUNTED its activity after the
 * merge (e.g. getNextDay('2026-03-08') === '2026-03-08' under America/Los_Angeles).
 *
 * Parsing, incrementing, and serializing entirely in UTC makes the step immune to
 * any DST transition (and is identical to the old behavior on every non-DST day
 * in every timezone, since the old code's constant UTC offset cancelled out
 * there). Date.UTC normalizes month/year overflow, so 12-31 -> next year-01-01.
 *
 * @param {string} dateStr  a 'YYYY-MM-DD' day key
 * @returns {string} the next day's 'YYYY-MM-DD' key
 */
export function getNextDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const parts = next.toISOString().split('T')
  const result = parts[0]
  if (!result) {
    throw new Error('Invalid date string')
  }
  return result
}
