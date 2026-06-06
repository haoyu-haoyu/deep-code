import { SKIP_HEAD_TOKENS, shellWords } from './shellTokenize.mjs'

// Pure, node-testable binary extraction for fortress process-exec enforcement
// (F3 follow-up). Standalone — nothing imports it until the Bash gate wires it in.
//
// ┌─ process-exec is a DEFENSE-IN-DEPTH control, NOT a hard boundary ──────────────────┐
// │ Static analysis of a shell command can never be airtight. process-exec catches the │
// │ obvious / direct invocations (`rm -rf /`, `curl evil.com`, `git push`, `a && b|c`, │
// │ quoted-space forms like `VAR="a b" rm`), enforces ONLY explicit matched rules (the │
// │ caller defers on no-match, so un-ruled commands are never blanket-blocked), and is │
// │ fail-safe (any parse/lookup error defers). It is a tripwire for the common case —   │
// │ a `deny`/`ask` rule REDUCES the attack surface; it does not seal it.                │
// │                                                                                     │
// │ KNOWN EVASIONS (a determined command can run a denied binary past this gate):       │
// │  • Runtime indirection — not statically resolvable at all:                          │
// │      `$(...)` / backticks, `eval "<dynamic>"`, `bash -c "<built at runtime>"`,      │
// │      `base64 -d | sh`, a variable command name (`$CMD foo`, `${TOOL} bar`).         │
// │  • Tokenizer limits of the legacy splitter (tree-sitter is OFF in default builds —  │
// │    "ant-only until pentest", see utils/bash/parser.ts — so the proven AST argv path │
// │    is unavailable and we re-tokenize splitCommand_DEPRECATED fragments):            │
// │      – LEADING redirections: `2>/dev/null rm …`, `<in git …` (the splitter splits   │
// │        on the redirect, so the head binary is missed). TRAILING redirections        │
// │        (`rm … 2>/dev/null`, the common form) ARE handled correctly.                 │
// │      – Bash ANSI-C / locale quoting of the binary word: `$'rm'`, `$"rm"`,           │
// │        `$'\x72\x6d'` (we honor plain '…'/"…" quoting, not the `$`-prefixed forms).  │
// │  • Wrapper commands run the wrapper as the head binary: `sudo rm`, `env X=1 rm`,    │
// │    `timeout 5 rm`, `nohup rm`, `xargs rm`, `command rm`, `exec rm` — a rule on the   │
// │    WRAPPER catches it; a rule on the inner command does not.                         │
// │  • too-complex commands (command substitution / control flow) return the host's     │
// │    conservative 'ask' BEFORE this gate runs, so they are not matched here.           │
// │ To catch a binary regardless of `rm` vs `/bin/rm` vs `./rm`, write a glob: `**/rm`. │
// └─────────────────────────────────────────────────────────────────────────────────────┘
//
// The compound split (&&, |, ;, subshells) is done by splitCommand_DEPRECATED in the
// adapter; this core extracts the HEAD binary of each already-split subcommand. We do a
// real (quote/escape-aware) word split, NOT a raw whitespace split: a raw split breaks
// ordinary shell syntax such as a quoted-space env value or a quoted binary path
// (`VAR="a b" rm …`, `"./my tool" …`), which would silently drop a matching rule. See
// shellWords (the quote/escape-aware word splitter) now lives in ./shellTokenize.mjs so
// the paranoid fs-read floor can reuse the exact same tested tokenizer.

// A real invoked binary starts with an alphanumeric, path, or home char — never with
// shell punctuation. splitCommand_DEPRECATED emits bare punctuation fragments for
// subshells / process substitution (`(cd … && rm x)` → ['(', 'cd …', 'rm x', ')']);
// drop those so the matcher/log never treats '(' or ')' as a binary. Also drops
// unresolved `$VAR`/`${...}` heads (can't be known statically → defer is correct).
function isPlausibleBinary(tok) {
  return /^[A-Za-z0-9_./~]/.test(tok)
}

// The invoked head binary of ONE already-split subcommand: skip leading `NAME=value` env
// assignments (the shell's bare env-var prefix) AND brace-group/`!` grammar heads (so
// `{ rm …; }` / `! rm …` reach the real binary — parity with the fs-read extractor),
// then the first remaining word is the binary as written (`rm`, `/bin/rm`, `python3`,
// `./my tool`) — quotes/escapes already resolved by shellWords. '' when no plausible binary.
function extractHeadBinary(subcommand) {
  if (typeof subcommand !== 'string') return ''
  const words = shellWords(subcommand)
  let i = 0
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || SKIP_HEAD_TOKENS.has(words[i]))) i++
  const head = words[i] || ''
  return isPlausibleBinary(head) ? head : ''
}

/**
 * The invoked head binaries of an already-split command (the subcommand strings from
 * splitCommand_DEPRECATED). Deduped, empties/non-binaries dropped. Never throws.
 * @param {string[]} subcommands
 * @returns {string[]}
 */
export function extractInvokedBinaries(subcommands) {
  if (!Array.isArray(subcommands)) return []
  const out = []
  for (const sub of subcommands) {
    let bin = ''
    try {
      bin = extractHeadBinary(sub)
    } catch {
      bin = ''
    }
    if (typeof bin === 'string' && bin !== '') out.push(bin)
  }
  return [...new Set(out)]
}
