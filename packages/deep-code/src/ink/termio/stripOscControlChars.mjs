// Strip terminal CONTROL characters — C0 (0x00–0x1F), DEL (0x7F), C1 (0x80–0x9F) —
// from a string that will be interpolated into a terminal escape sequence (an OSC 8
// hyperlink URL, and — reused — an OSC notification/title payload).
//
// Why: the OSC tokenizer terminates an OSC string only on BEL (0x07) or ST (ESC
// '\'); a BARE inner ESC (e.g. ESC '[' = CSI) is ABSORBED into the OSC body (the
// tokenizeCore 'osc' state's `else: i++`). So untrusted content — a Bash/MCP/tool
// result, opened-repo file content, a malicious filename — that embeds
// `<benign> ESC [ 2J … BEL` inside an OSC 8 URL survives parsing (the cell-grid text
// neutralization is bypassed because the URL is a separate cell PROPERTY re-emitted
// raw) and reaches the terminal, which aborts the OSC at the embedded ESC and
// EXECUTES the trailing CSI/OSC: clear the screen, reposition the cursor to forge an
// "approved" line or hide a destructive command, set the scroll region, or write the
// clipboard via OSC 52. Stripping the control bytes before the URL is emitted closes
// the break-out.
//
// No false positives: a legitimate URL never contains raw control bytes — pathToFileURL
// percent-encodes them and http(s) URLs are control-free — and a percent-encoded %1B
// is the inert characters '%','1','B', left intact. SGR color and the (grid-protected)
// link display TEXT are untouched; only the URL field is sanitized.
//
// Pure value-in/value-out so it is node-testable (the OSC emitters are render-internal).
// Implemented as a code-point scan (not a regex literal) to keep raw control bytes out
// of the source file.
function isTerminalControl(codePoint) {
  return (
    codePoint <= 0x1f || // C0 (incl. ESC 0x1b, BEL 0x07)
    codePoint === 0x7f || // DEL
    (codePoint >= 0x80 && codePoint <= 0x9f) // C1
  )
}

export function stripOscControlChars(value) {
  if (typeof value !== 'string') return value
  let out = ''
  for (const ch of value) {
    if (!isTerminalControl(ch.codePointAt(0))) out += ch
  }
  return out
}
