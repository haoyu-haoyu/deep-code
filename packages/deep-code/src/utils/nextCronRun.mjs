/**
 * Compute the next Date strictly after `from` that matches the cron fields, in
 * the process's local timezone. Returns null only when no date matches within
 * the search horizon. That horizon spans ~9 years so the longest legitimate gap
 * — a `0 0 29 2 *` leap-day cron across the Gregorian century rule (e.g. Feb 29
 * 2096 → Feb 29 2104, an 8-year gap because 2100 is not a leap year) — still
 * resolves. (Genuinely impossible specs like Feb 31 still return null.)
 *
 * Standard cron semantics: when both dayOfMonth and dayOfWeek are constrained
 * (neither is the full range), a date matches if EITHER matches.
 *
 * DST (the reason this is a per-day candidate search, not a minute-by-minute
 * local-time walk): the previous walk advanced a local Date with
 * setHours/setMinutes and matched on getHours()/getMinutes(). A spring-forward
 * gap makes a wall-clock time (e.g. 02:30 where 02:00→03:00) NOT EXIST, so the
 * hour-set check never matched and a fixed-hour job like `30 2 * * *` was
 * SKIPPED for the whole day. That contradicted the doc's "matches vixie-cron"
 * claim — real vixie-cron runs a skipped job right after the adjustment.
 *
 * Here, each candidate (hour, minute) on a matching day is CONSTRUCTED as a
 * local Date:
 *  - Normal time: the constructed instant is exactly that wall-clock minute.
 *  - Spring-forward gap: JS forward-maps the non-existent time to the first
 *    existing instant (02:30 → 03:30), so the job RUNS (~the DST offset late)
 *    instead of being skipped.
 *  - Fall-back ambiguous time: a single construction yields one instant, so the
 *    job fires ONCE (not twice) for the repeated hour.
 * The chronologically-first candidate strictly after `from` is returned, so a
 * forward-mapped gap candidate is still ordered correctly against other hours.
 *
 * @param {{minute:number[],hour:number[],dayOfMonth:number[],month:number[],dayOfWeek:number[]}} fields
 * @param {Date} from
 * @returns {Date | null}
 */
export function nextCronRun(fields, from) {
  const hourSet = new Set(fields.hour)
  const minuteSet = new Set(fields.minute)
  const domSet = new Set(fields.dayOfMonth)
  const monthSet = new Set(fields.month)
  const dowSet = new Set(fields.dayOfWeek)

  // Is the field wildcarded (full range)?
  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7

  const hours = [...hourSet].sort((a, b) => a - b)
  const minutes = [...minuteSet].sort((a, b) => a - b)
  if (hours.length === 0 || minutes.length === 0) return null

  // Earliest acceptable instant: round `from` up to the next whole minute
  // (strictly after `from`, seconds/millis cleared) — matches the prior walk.
  const startInstant = new Date(from.getTime())
  startInstant.setSeconds(0, 0)
  startInstant.setMinutes(startInstant.getMinutes() + 1)
  const startMs = startInstant.getTime()

  // Anchor each day at noon: noon exists in every standard DST zone (transitions
  // happen near 00:00–03:00), so day.getFullYear/Month/Date stay correct and
  // setDate(+1) advances the calendar date without drifting across a boundary.
  const day = new Date(
    startInstant.getFullYear(),
    startInstant.getMonth(),
    startInstant.getDate(),
    12,
    0,
    0,
    0,
  )

  // ~9 years of calendar days: covers the 8-year leap-day century gap (Feb 29
  // 2096 → 2104) so a `0 0 29 2 *` cron always resolves. Per-day work is cheap
  // (the hour×minute grid is built only on a matching day), so scanning this
  // far for the rare unsatisfied day is negligible.
  const maxDays = 366 * 9
  for (let d = 0; d < maxDays; d++) {
    const month = day.getMonth() + 1
    if (monthSet.has(month)) {
      const dom = day.getDate()
      const dow = day.getDay()
      const dayMatches =
        domWild && dowWild
          ? true
          : domWild
            ? dowSet.has(dow)
            : dowWild
              ? domSet.has(dom)
              : domSet.has(dom) || dowSet.has(dow)

      if (dayMatches) {
        const y = day.getFullYear()
        const mo = day.getMonth()
        const dd = day.getDate()
        let best = null
        for (const h of hours) {
          for (const m of minutes) {
            const candMs = new Date(y, mo, dd, h, m, 0, 0).getTime()
            // Forward-mapped gap candidates can land later than a higher (h, m),
            // so compare by instant rather than trusting (h, m) order.
            if (candMs >= startMs && (best === null || candMs < best)) {
              best = candMs
            }
          }
        }
        if (best !== null) return new Date(best)
      }
    }
    day.setDate(day.getDate() + 1)
  }

  return null
}
