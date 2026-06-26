/**
 * Map one structuredPatch hunk to the snippet section shown in the model-facing
 * `edited_text_file` attachment (getSnippetForTwoFileDiff).
 *
 * The snippet renders the NEW file's view of the change: context (' ') and added
 * ('+') lines are kept, while deleted ('-') lines and the "\ No newline at end of
 * file" metadata lines are dropped, and each kept line's one-char diff marker is
 * stripped. Those kept lines occupy CONSECUTIVE positions in the new file
 * starting at the hunk's newStart (deletions take no new-file line), so the
 * section is numbered from newStart.
 *
 * Previously it numbered from oldStart. For the first hunk oldStart === newStart
 * (nothing before it shifted), so it looked correct — but on any later hunk,
 * after earlier hunks added or removed lines, oldStart !== newStart, and the
 * snippet pointed the model at OLD-file line numbers for new-file content,
 * off by the cumulative line delta.
 *
 * @param {{ oldStart: number, newStart: number, lines: string[] }} hunk
 * @returns {{ startLine: number, content: string }}
 */
export function hunkToSnippetSection(hunk) {
  return {
    startLine: hunk.newStart,
    content: hunk.lines
      // Drop deleted lines AND diff metadata lines ("\ No newline ...").
      .filter(line => !line.startsWith('-') && !line.startsWith('\\'))
      .map(line => line.slice(1))
      .join('\n'),
  }
}
