/**
 * Format a YYYY-MM-DD day key for display, parsing it as a LOCAL calendar date.
 *
 * `new Date('2026-06-23')` parses a bare date-only string as UTC midnight, so
 * toLocaleDateString() in a negative-UTC-offset timezone (the Americas) renders
 * the PREVIOUS day — the label then disagrees with the day key it represents.
 * Splitting the components into a local Date (`new Date(y, m-1, d)`) pins the
 * label to the key's own calendar day in every timezone. Mirrors the idiom in
 * mcp/ElicitationDialog.tsx.
 *
 * Any input that is not a 3-part all-digits key falls back to plain Date parsing,
 * so a non-numeric string behaves exactly as before (an unparseable string still
 * renders "Invalid Date"). Real keys always come from toISOString(), so they are
 * well-formed; an out-of-range all-digit triple would roll over rather than be
 * rejected, but that input cannot occur here.
 *
 * @param {string} dateKey  a YYYY-MM-DD day key
 * @param {Intl.DateTimeFormatOptions} [options]  toLocaleDateString options
 * @returns {string}
 */
export function formatDateKeyLabel(
  dateKey,
  options = { month: 'short', day: 'numeric' },
) {
  return parseLocalDateKey(dateKey).toLocaleDateString('en-US', options)
}

function parseLocalDateKey(dateKey) {
  const parts = String(dateKey ?? '').split('-')
  if (parts.length === 3 && parts.every(part => /^\d+$/.test(part))) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  }
  return new Date(dateKey)
}
