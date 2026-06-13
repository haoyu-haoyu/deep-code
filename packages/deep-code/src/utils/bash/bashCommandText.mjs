// Permission rules match against a command's `.text`. For a tree-sitter AST
// command, `.text` is the RAW source span — which preserves whitespace that
// the tokenized argv collapses. That divergence breaks prefix/wildcard rule
// matching, which assumes single-ASCII-space separators between tokens:
//
//   `rm\t-rf /x`  → argv ['rm','-rf','/x'] (correct)  but .text keeps the TAB
//   → a `Bash(rm:*)` / `Bash(rm *)` deny rule builds `^rm( .*)?$` / checks
//     `startsWith('rm ')` with a literal SPACE, so the tabbed command does
//     NOT match → the deny rule is silently bypassed.
//
// walkCommand already rebuilds `.text` from argv for two members of this class
// — `$VAR` expansions and newlines (line continuations / heredoc bodies). A
// TAB token separator is the same class and must trigger the same rebuild.
//
// Rebuilding from argv is quote-safe by construction: tree-sitter splits argv
// respecting quotes, so whitespace INSIDE a quoted token stays in that token
// and is re-quoted here — only the inter-token separator is normalized.

// Shell-escape a single argv token (mirrors walkCommand's inline escaper).
export function shellEscapeArg(a) {
  return a === '' || /["'\\ \t\n$`;|&<>(){}*?[\]~#]/.test(a)
    ? `'${a.replace(/'/g, "'\\''")}'`
    : a
}

// Single-ASCII-space-joined, shell-escaped command string built from argv.
export function rebuildCommandText(argv) {
  return argv.map(shellEscapeArg).join(' ')
}

// True when the raw source span carries whitespace/expansions that argv
// collapses, so the raw text is unsafe for separator-sensitive rule matching:
// a `$VAR` expansion, a newline (continuation/heredoc), or a TAB separator.
export function commandTextNeedsRebuild(rawText) {
  return /\$[A-Za-z_]/.test(rawText) || /[\n\t]/.test(rawText)
}

// The matching-safe `.text` for a command node: the argv rebuild when the raw
// span would mislead the matcher, else the raw span unchanged.
export function matchingCommandText(rawText, argv) {
  return commandTextNeedsRebuild(rawText) ? rebuildCommandText(argv) : rawText
}
