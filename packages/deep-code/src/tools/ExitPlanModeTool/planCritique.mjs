// A deterministic, advisory pre-implementation check for an exit-plan-mode plan:
// extract the workspace file paths the plan references (in backticks) and flag any
// that don't exist on disk. Surfaced to the model in the ExitPlanMode tool_result
// so it can catch a hallucinated / typo'd path before acting on the plan.
//
// Deliberately CONSERVATIVE and NEUTRAL:
//  - Only backtick-quoted, whitespace-free tokens that are an actual PATH (contain
//    a `/` separator) with a known source/config/doc extension count as references.
//    A bare `name.ext` is rejected: it is far more often a member expression
//    (`response.json`, `obj.go`, `result.py`) than a file, and a bare file that
//    exists would not be flagged anyway — so this only forgoes flagging a typo'd
//    ROOT file (rare) in exchange for eliminating member-expression noise. Prose,
//    commands (`npm test`), version strings, and URLs are likewise ignored.
//  - A not-found path is reported as "to create, or a typo" — never asserted as an
//    error, because a plan describes FUTURE code (a file it intends to create is
//    legitimately absent). It is advisory; it never blocks plan approval.
//  - SYMBOLS are intentionally NOT checked: a plan routinely names symbols it will
//    create, so a symbol-existence check would false-positive constantly.

// Clear, common file extensions. Excludes ambiguous ones (env, length, map, then,
// prototype, …) that show up as member expressions / prose far more often than as
// files, to keep the check high-signal.
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx',
  'py', 'go', 'rs', 'java', 'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp',
  'cs', 'swift', 'kt', 'css', 'scss', 'less', 'html', 'vue', 'svelte',
  'yml', 'yaml', 'toml', 'sql', 'sh', 'bash', 'proto', 'txt', 'xml', 'graphql',
])

// A whitespace-free path token: optional ./ or ../, slash-separated segments, a
// final name, then a dot + extension. The extension is checked against the set
// above separately (the regex only asserts the shape).
const PATH_SHAPE_RE = /^\.{0,2}\/?(?:[\w@.\-]+\/)*[\w.\-]+\.([A-Za-z][A-Za-z0-9]{0,4})$/
const INLINE_CODE_RE = /`([^`\n]+)`/g

function cleanRef(token) {
  // Strip trailing sentence punctuation, THEN a :line(:col) locator, then any
  // punctuation the locator exposed — so both "`src/a.ts`," and "`src/a.ts:42`."
  // clean to "src/a.ts" (a locator followed by punctuation would otherwise wedge
  // the $-anchored locator strip).
  let t = token.trim().replace(/[),.;:]+$/, '')
  t = t.replace(/:\d+(?::\d+)?$/, '')
  t = t.replace(/[),.;:]+$/, '')
  return t
}

// A token is a file-path reference only if it is an actual PATH: it contains a
// `/` separator AND its first segment is a directory, not a hostname. This rejects
// bare member expressions (no slash) and bare-host URLs (example.com/page.html),
// while allowing dotdirs (.github/…) and ./ ../ prefixes.
function isPathReference(token) {
  const slash = token.indexOf('/')
  if (slash < 0) return false
  const head = token.slice(0, slash)
  // A real first directory segment has no embedded dot (only a leading-dot dir
  // like ".github" or the "." / ".." prefixes); a dotted head is hostname-like.
  if (head.replace(/^\.+/, '').includes('.')) return false
  return true
}

/**
 * Distinct file-path references in a plan, in first-seen order.
 * @param {unknown} planText
 * @returns {string[]}
 */
export function extractPlanFileReferences(planText) {
  if (typeof planText !== 'string' || planText === '') return []
  const refs = []
  const seen = new Set()
  let m
  INLINE_CODE_RE.lastIndex = 0
  while ((m = INLINE_CODE_RE.exec(planText)) !== null) {
    const token = cleanRef(m[1])
    if (token === '' || /\s/.test(token) || seen.has(token)) continue
    const match = PATH_SHAPE_RE.exec(token)
    if (!match) continue
    if (!FILE_EXTENSIONS.has(match[1].toLowerCase())) continue
    if (!isPathReference(token)) continue
    seen.add(token)
    refs.push(token)
  }
  return refs
}

function existsSafe(fileExists, ref) {
  // On any predicate error, treat as existing — never produce a false "missing"
  // flag from an I/O hiccup.
  try {
    return Boolean(fileExists(ref))
  } catch {
    return true
  }
}

/**
 * Build the advisory note for a plan, or null when every referenced path exists
 * (or none were referenced). `fileExists(ref)` reports whether a workspace-relative
 * (or absolute) path exists.
 *
 * @param {unknown} planText
 * @param {(ref: string) => boolean} fileExists
 * @param {{ maxShown?: number }} [opts]
 * @returns {string|null}
 */
export function buildPlanFileReferenceNote(planText, fileExists, { maxShown = 12 } = {}) {
  if (typeof fileExists !== 'function') return null
  const missing = extractPlanFileReferences(planText).filter(ref => !existsSafe(fileExists, ref))
  if (missing.length === 0) return null
  const shown = missing.slice(0, Math.max(1, maxShown))
  const more = missing.length - shown.length
  const list = shown.map(p => `\`${p}\``).join(', ')
  return (
    `Plan reference check (advisory): ${missing.length} path${missing.length === 1 ? '' : 's'} ` +
    `referenced in the plan ${missing.length === 1 ? 'was' : 'were'} not found in the workspace — ` +
    `expected if you intend to CREATE ${missing.length === 1 ? 'it' : 'them'}, otherwise check for a typo: ` +
    `${list}${more > 0 ? ` (+${more} more)` : ''}`
  )
}
