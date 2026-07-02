import { isUnifiedDiffBodyLine } from './isUnifiedDiffBodyLine.mjs'

// StructuredPatchHunk header: @@ -oldStart,oldLines +newStart,newLines @@
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// Parse ONE file's unified-diff lines into hunks. `lines` is a single file's
// diff split on '\n' (parseGitDiff splits the whole output on "diff --git "
// first, so headers for a different file never appear here). Index 0 is the
// residual of that split, so scanning starts at 1.
//
// Ordering is load-bearing: once we are INSIDE a hunk (currentHunk set), a line
// led by '+' / '-' / ' ' is UNAMBIGUOUSLY a body line — git never emits a
// '--- '/'+++ ' file header mid-hunk in a non-combined diff (combined diffs are
// excluded upstream), and those file headers only appear BEFORE the first '@@'.
// So the body-line check must run BEFORE the metadata-skip. Previously the skip
// ran first and unconditionally, so a REMOVED line whose content begins with
// '--' (diff line '---…', e.g. deleting a YAML/Markdown '---' separator or a
// '--flag') matched startsWith('---') and an ADDED line beginning with '++'
// ('+++…', e.g. a '++counter' or C++ '++x') matched startsWith('+++') — both
// were dropped as if they were file headers. The change then vanished from the
// rendered diff AND every following line was mis-numbered (the line-number
// counter only advances on lines that survive). The metadata-skip is retained
// for the pre-hunk region (currentHunk still null there).
//
// `'' + line` forces a flat string copy so V8 doesn't retain the whole parent
// diff (~MBs) via a sliced-string reference held by a single kept line.
//
// @param {string[]} lines one file's diff, split on '\n'
// @param {number} maxLinesPerFile cap on body lines retained per file
// @returns {{oldStart:number,oldLines:number,newStart:number,newLines:number,lines:string[]}[]}
export function parseGitDiffHunks(lines, maxLinesPerFile) {
  const fileHunks = []
  let currentHunk = null
  let lineCount = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''

    const hunkMatch = line.match(HUNK_HEADER)
    if (hunkMatch) {
      if (currentHunk) {
        fileHunks.push(currentHunk)
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1] ?? '0', 10),
        oldLines: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: parseInt(hunkMatch[3] ?? '0', 10),
        newLines: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      }
      continue
    }

    // Inside a hunk, a '+'/'-'/' '-led line is a body line — capture it before
    // the metadata-skip so a '---…'/'+++…' body line isn't mistaken for a header.
    // A genuine blank context line is ' ' (space-prefixed), NEVER the trailing ''
    // that splitting git's final newline yields — isUnifiedDiffBodyLine excludes ''.
    if (currentHunk && isUnifiedDiffBodyLine(line)) {
      if (lineCount >= maxLinesPerFile) {
        continue
      }
      currentHunk.lines.push('' + line)
      lineCount++
      continue
    }

    // Pre-hunk file headers / binary markers / mode lines.
    if (
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('Binary files')
    ) {
      continue
    }
  }

  if (currentHunk) {
    fileHunks.push(currentHunk)
  }

  return fileHunks
}
