// True for a unified-diff hunk BODY line: an added ('+'), removed ('-'), or
// context (' ' — a single leading space) line. parseGitDiff calls this ONLY after
// it has already skipped the file headers ('+++ ' / '--- ' / 'index ' / 'new file'
// / 'Binary files' / '@@ ' …), so a leading '+'/'-' here is a body line, never the
// '+++'/'---' path markers.
//
// A genuine blank context line is ' ' (the space prefix preserved), NEVER ''. git
// diff output ends with a trailing '\n', so splitting the file-diff on '\n' yields
// a trailing '' element. The previous classifier also admitted `line === ''`, which
// pushed that split artifact into the file's LAST hunk (intermediate hunks are cut
// off by the next '@@' header). Both diff renderers then drew it as a phantom blank
// context row numbered `newStart + newLines` — one past the hunk's last covered
// line — which, when the trailing context does not reach EOF, lands on a REAL file
// line and renders it BLANK (shadowing it). Excluding '' drops the artifact while
// keeping every real ' '-prefixed blank context line.
//
// @param {string} line
// @returns {boolean}
export function isUnifiedDiffBodyLine(line) {
  return (
    line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')
  )
}
