// Shared pure shell-word tokenizer for the fortress Bash-command analyses
// (process-exec binary extraction + the paranoid fs-read floor). Standalone + node-
// testable. The compound split (&&, |, ;, subshells) is done by splitCommand_DEPRECATED;
// this splits ONE already-split subcommand into its words.

// Minimal POSIX-ish shell word splitter: split on UNQUOTED whitespace, honoring single
// quotes (literal), double quotes (backslash escapes only \ " $ `), and backslash
// escapes outside quotes. Quotes/escapes are RESOLVED (removed) so each word is the value
// the shell would actually pass — this is what makes `VAR="a b" rm` tokenize to
// ['VAR=a b', 'rm'] and `"./my tool"` to ['./my tool'], and folds `\rm`/`'rm'`/`"rm"` to
// `rm`. Never throws; on an unterminated quote it returns the best-effort word collected
// so far. NOTE: it does NOT interpret bash `$'…'`/`$"…"` (ANSI-C/locale) quoting — a known
// best-effort limit shared by every consumer.
export function shellWords(s) {
  if (typeof s !== 'string') return []
  const words = []
  let cur = ''
  let inWord = false
  let quote = null // "'" | '"' | null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else cur += c
    } else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) {
        cur += s[i + 1]
        i++
      } else cur += c
    } else if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]
      i++
      inWord = true
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (inWord) {
        words.push(cur)
        cur = ''
        inWord = false
      }
    } else {
      cur += c
      inWord = true
    }
  }
  if (inWord || quote !== null) words.push(cur)
  return words
}
