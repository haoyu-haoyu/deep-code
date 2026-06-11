/**
 * Format a byte count as a human-readable KB/MB/GB string.
 *
 * The unit is chosen AFTER the 1-decimal rounding, not before. Picking the band
 * from the raw value and only then `toFixed(1)`-rounding lets a value just under
 * a threshold round up into a nonsensical label: 1 MiB − 1 byte (1048575) is
 * 1023.999… KB, which passes the `< 1024 KB` band test and then rounds to
 * "1024.0" → "1024KB" (KB never exceeds 1024). Promote to the next unit whenever
 * the rounded mantissa reaches 1024, so 1048575 → "1MB" and 1073741823 → "1GB".
 *
 * @example formatFileSize(1536) // "1.5KB"
 * @example formatFileSize(1048575) // "1MB"
 * @param {number} sizeInBytes
 * @returns {string}
 */
export function formatFileSize(sizeInBytes) {
  if (sizeInBytes / 1024 < 1) {
    return `${sizeInBytes} bytes`
  }
  const units = ['KB', 'MB', 'GB']
  let value = sizeInBytes / 1024
  let unitIndex = 0
  // Round at the current unit; if rounding pushes the mantissa to a full 1024,
  // carry up to the next unit (unless already at the largest).
  while (unitIndex < units.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1).replace(/\.0$/, '')}${units[unitIndex]}`
}
