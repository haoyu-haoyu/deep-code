/**
 * The content to record in readFileState after FileWriteTool writes a file.
 *
 * The file-staleness guard (FileWriteTool / FileEditTool) compares a freshly
 * read file against readFileState.content to decide whether the file changed
 * out from under us. The read path normalizes line endings CRLF -> LF
 * (fileRead.ts, FileEditTool.ts read), so the disk side of that comparison is
 * always LF; readFileState.content must therefore be LF too, or an unmodified
 * file compares unequal. FileEditTool already satisfies this — it records the
 * post-edit content, which was derived from the LF-normalized read.
 *
 * FileWriteTool writes with endings='LF' (a passthrough — the model's explicit
 * line endings are written as-is, so a CRLF write reaches disk as CRLF), then
 * records the SAME raw `content`. If that content carried CRLF, readFileState
 * held a CRLF string while the next read normalized to LF, so the staleness
 * guard falsely raised FILE_UNEXPECTEDLY_MODIFIED and blocked a valid follow-up
 * edit (most reachable on Windows, where CRLF and mtime jitter coincide).
 *
 * Normalize the recorded form to LF so it matches a subsequent read. The bytes
 * on disk are untouched — only the in-memory staleness record is normalized,
 * exactly as the read path already does. A lone CR (old Mac OS 9) is left as-is,
 * matching the read normalization (it only collapses the CRLF pair).
 *
 * @param {string} writtenContent  the content handed to writeTextContent
 * @returns {string} the LF-normalized content to store in readFileState
 */
export function readStateContentForWrite(writtenContent) {
  return writtenContent.replaceAll('\r\n', '\n')
}
