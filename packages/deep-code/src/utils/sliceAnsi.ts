import { stringWidth } from '../ink/stringWidth.js'
import { getGraphemeSegmenter } from './intl.js'
import sliceAnsiCore from './sliceAnsi.core.mjs'

// Split into grapheme clusters via the memoized segmenter so a straddling text
// token can be cut on a real cell boundary without re-creating an Intl.Segmenter
// per call.
function splitGraphemes(value: string): string[] {
  const out: string[] = []
  for (const { segment } of getGraphemeSegmenter().segment(value)) {
    out.push(segment)
  }
  return out
}

/**
 * Slice a string containing ANSI escape codes, by display cells.
 *
 * Unlike the slice-ansi package, this properly handles OSC 8 hyperlink
 * sequences because @alcalzone/ansi-tokenize tokenizes them correctly, and it
 * cuts INSIDE a wide text run (the vendored tokenizer emits a whole run as one
 * token). See sliceAnsi.core.mjs for the slicing logic.
 */
export default function sliceAnsi(
  str: string,
  start: number,
  end?: number,
): string {
  return sliceAnsiCore(str, start, end, { stringWidth, splitGraphemes })
}
