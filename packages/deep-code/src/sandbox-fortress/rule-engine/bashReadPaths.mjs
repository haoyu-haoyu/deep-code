import { shellWords } from './shellTokenize.mjs'

// Pure, node-testable extraction of the literal file/dir paths a Bash command will READ,
// for the F3 paranoid fs-read floor (effort 'max'). Standalone — nothing imports it until
// the Bash gate wires it in. The compound split (&&, |, ;, subshells) is done by
// splitCommand_DEPRECATED in the adapter; this extracts read-path arguments per subcommand.
//
// BEST-EFFORT BY NATURE (same caveat class as process-exec): we recognize a curated set of
// READER binaries by basename and treat their non-flag arguments as read targets. We do
// NOT catch: wrapped readers (`sudo cat …`, `env X=1 cat …`), exotic/custom readers
// (`python -c "open(...)"`, a user script), `< file` input redirection (the legacy
// splitter mangles leading redirects), `--flag=path` / `key=path` embedded paths, or any
// runtime indirection (`$VAR`, `$(...)`, `eval`). It catches the direct `reader /path`
// exfil form (`cat ~/.aws/credentials`, `grep -r secret ~`, `head /etc/shadow`).

// Curated reader binaries (matched by basename so `/bin/cat`, `cat`, `./cat` all match).
export const READER_BINARIES = new Set([
  // content readers
  'cat', 'tac', 'nl', 'head', 'tail', 'less', 'more', 'bat', 'rev', 'fold', 'expand',
  'unexpand', 'cut', 'paste', 'column', 'wc', 'od', 'xxd', 'hexdump', 'strings',
  'base64', 'base32', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'sed', 'awk', 'gawk',
  'jq', 'yq', 'diff', 'sdiff', 'cmp', 'comm', 'sort', 'uniq',
  'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'shasum', 'cksum', 'b2sum', 'sum',
  'file', 'stat', 'readlink', 'realpath',
  'zcat', 'zgrep', 'gzcat', 'bzcat', 'xzcat',
  // directory readers / listers
  'ls', 'dir', 'vdir', 'find', 'tree', 'du',
])

function basename(p) {
  const s = String(p)
  const slash = s.lastIndexOf('/')
  return slash >= 0 ? s.slice(slash + 1) : s
}

// Leading shell-grammar tokens that splitCommand_DEPRECATED glues onto the first inner
// command and that are NOT the invoked binary: a brace group (`{ cat … ; }` runs cat in
// the CURRENT shell) and the `!` pipeline negation (`! cat …`). Skipping them reveals the
// real reader head; otherwise the head looks like '{' / '!' and the read is missed.
const SKIP_HEAD_TOKENS = new Set(['{', '!'])

/**
 * The literal read-path argument tokens of a command, from the already-split subcommand
 * strings (splitCommand_DEPRECATED output). For each subcommand whose head binary's
 * basename is a known reader, every non-flag argument token is returned (the caller
 * resolves each against cwd and checks the allowlist + fortress). Leading `NAME=value`
 * env assignments are skipped to find the head. Deduped; empties/flags dropped; never
 * throws.
 * @param {string[]} subcommands
 * @param {{readerBinaries?: Set<string>}} [opts]
 * @returns {string[]}
 */
export function extractBashReadPaths(subcommands, opts = {}) {
  if (!Array.isArray(subcommands)) return []
  const readers = opts && opts.readerBinaries instanceof Set ? opts.readerBinaries : READER_BINARIES
  const out = []
  for (const sub of subcommands) {
    if (typeof sub !== 'string') continue
    let words
    try {
      words = shellWords(sub)
    } catch {
      words = []
    }
    // skip leading NAME=value env assignments + brace-group/`!` grammar tokens to reach
    // the real reader head
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || SKIP_HEAD_TOKENS.has(words[i]))) i++
    const head = words[i]
    if (typeof head !== 'string' || head === '') continue
    if (!readers.has(basename(head))) continue
    for (let j = i + 1; j < words.length; j++) {
      const t = words[j]
      if (typeof t !== 'string' || t === '') continue
      if (t.startsWith('-')) continue // a flag/option (incl. `--`, `-`), not a read path
      out.push(t)
    }
  }
  return [...new Set(out)]
}
