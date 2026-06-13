// Classify a text-file read result for the warning the tool hands back to the
// model when no content was returned.
//
// The mapper used to distinguish "offset past EOF" from "empty file" via
// `totalLines === 0` — but the fast read path (readFileInRange) pushes one empty
// final fragment for a 0-byte file and returns `{content:'', numLines:1,
// totalLines:1}`, so `totalLines` is NEVER 0 for a regular file. The result: the
// dedicated "contents are empty" message was unreachable, and an empty file (or a
// read that selected a single blank line) fell through to the contradictory
// "shorter than the provided offset (N). The file has M lines." message.
//
// The honest discriminator is `numLines` — the number of lines actually selected.
// `numLines === 0` means the offset selected nothing (genuinely past EOF);
// `numLines >= 1` with empty content means the selected lines are empty (an empty
// file, or a blank selected line).
export function classifyTextReadResult({ content, numLines }) {
  if (content) return 'content'
  if (numLines === 0) return 'beyond_eof'
  return 'empty'
}
