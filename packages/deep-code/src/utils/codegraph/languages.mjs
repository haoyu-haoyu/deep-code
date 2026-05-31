// Heuristic, dependency-free source extractors for the codegraph.
//
// There is no AST/parser in this repo (no tree-sitter/babel/tsc), and the
// standalone binary stubs native modules — so the codegraph indexes with
// line-oriented regexes over masked source. This is high-recall and
// good-enough-precision for the agent queries it powers (list_symbols,
// find_definition, import_graph), but it is NOT a binding/scope resolver:
// callers must treat declarations as CANDIDATES, never resolved bindings.
//
// Precision comes from a pre-pass that masks comments and string literals
// (replacing their bodies with spaces while preserving newlines and length),
// so declaration/import regexes never match text inside a comment or string.
//
// Pure (no I/O, no deps beyond JS built-ins) → fully unit-testable.

/**
 * @typedef {Object} SymbolRecord
 * @property {string} name
 * @property {'function'|'class'|'const'|'let'|'var'|'interface'|'type'|'enum'|'namespace'|'method'|'def'} kind
 * @property {number} line   1-based line number of the declaration
 * @property {boolean} exported
 * @property {string} scope  enclosing symbol name, or '' at top level
 */

/**
 * @typedef {Object} ImportRecord
 * @property {string} module  the imported module specifier (verbatim)
 * @property {number} line    1-based line number
 * @property {'import'|'require'|'export-from'|'dynamic-import'} kind
 */

const JS_TS_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
])
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi'])

/** Lowercased file extension including the dot, or '' if none. */
export function extensionOf(path) {
  const base = String(path).split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

export function languageForPath(path) {
  const ext = extensionOf(path)
  if (JS_TS_EXTENSIONS.has(ext)) return 'jsts'
  if (PYTHON_EXTENSIONS.has(ext)) return 'python'
  return null
}

/**
 * Dispatch to the extractor for a path's language.
 * @returns {{ symbols: SymbolRecord[], imports: ImportRecord[] } | null} null for unsupported languages
 */
export function extractFile(path, text) {
  const language = languageForPath(path)
  if (language === 'jsts') return extractJsTs(text)
  if (language === 'python') return extractPython(text)
  return null
}

// ---------------------------------------------------------------------------
// Masking: blank out comment and string bodies, preserving newlines + length.
// ---------------------------------------------------------------------------

/**
 * Replace the BODIES of JS/TS comments and string/template literals with spaces
 * (delimiters kept, newlines preserved, total length unchanged) so downstream
 * line regexes never match inside them.
 */
// A `/` starts a regex (not division) when the previous significant code char
// is one of these (or start-of-input). Masking regex bodies matters because an
// unbalanced brace in a regex (e.g. `/[}]/`) would otherwise corrupt brace-depth
// scope tracking and drop later class members.
const REGEX_PREV = new Set([
  '', '(', '{', '[', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '^', '~', '<', '>',
])

export function maskJsTs(text) {
  const out = new Array(text.length)
  let state = 'code' // code | line | block | sq | dq | tpl | regex
  let prevSig = '' // last significant code char, to disambiguate `/`
  let inClass = false // inside a regex [...] character class
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    const keep = c === '\n' ? '\n' : ' '
    switch (state) {
      case 'code':
        if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; }
        else if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; }
        else if (c === '/' && REGEX_PREV.has(prevSig)) { state = 'regex'; inClass = false; out[i] = c; prevSig = '/'; }
        else if (c === "'") { state = 'sq'; out[i] = c; }
        else if (c === '"') { state = 'dq'; out[i] = c; }
        else if (c === '`') { state = 'tpl'; out[i] = c; }
        else {
          out[i] = c
          if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') prevSig = c
        }
        break
      case 'line':
        out[i] = keep
        if (c === '\n') state = 'code'
        break
      case 'block':
        out[i] = keep
        if (c === '*' && n === '/') { out[i + 1] = ' '; i++; state = 'code'; }
        break
      case 'regex':
        // Regexes can't span newlines; bail on one (likely a stray `/` division).
        if (c === '\n') { out[i] = '\n'; state = 'code'; prevSig = ''; }
        else if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++; } }
        else if (c === '[') { inClass = true; out[i] = ' '; }
        else if (c === ']') { inClass = false; out[i] = ' '; }
        else if (c === '/' && !inClass) { out[i] = c; state = 'code'; prevSig = '/'; }
        else out[i] = keep
        break
      case 'sq':
      case 'dq':
      case 'tpl': {
        const quote = state === 'sq' ? "'" : state === 'dq' ? '"' : '`'
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++; } }
        else if (c === quote) { out[i] = c; state = 'code'; prevSig = quote; }
        else out[i] = keep
        break
      }
    }
  }
  return out.join('')
}

/**
 * Replace the bodies of Python comments and string literals (including triple
 * quoted) with spaces, preserving newlines + length.
 */
export function maskPython(text) {
  const out = new Array(text.length)
  let state = 'code' // code | comment | sq | dq | tsq | tdq
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const keep = c === '\n' ? '\n' : ' '
    const triple = text.slice(i, i + 3)
    switch (state) {
      case 'code':
        if (c === '#') { state = 'comment'; out[i] = ' '; }
        else if (triple === "'''") { state = 'tsq'; out[i] = c; out[i + 1] = text[i + 1]; out[i + 2] = text[i + 2]; i += 2; }
        else if (triple === '"""') { state = 'tdq'; out[i] = c; out[i + 1] = text[i + 1]; out[i + 2] = text[i + 2]; i += 2; }
        else if (c === "'") { state = 'sq'; out[i] = c; }
        else if (c === '"') { state = 'dq'; out[i] = c; }
        else out[i] = c
        break
      case 'comment':
        out[i] = keep
        if (c === '\n') state = 'code'
        break
      case 'sq':
      case 'dq': {
        const quote = state === 'sq' ? "'" : '"'
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++; } }
        else if (c === quote || c === '\n') { out[i] = c; state = 'code'; }
        else out[i] = keep
        break
      }
      case 'tsq':
      case 'tdq': {
        const close = state === 'tsq' ? "'''" : '"""'
        if (triple === close) { out[i] = c; out[i + 1] = text[i + 1]; out[i + 2] = text[i + 2]; i += 2; state = 'code'; }
        else out[i] = keep
        break
      }
    }
  }
  return out.join('')
}

// ---------------------------------------------------------------------------
// JS / TS extractor
// ---------------------------------------------------------------------------

const ID = '[A-Za-z_$][\\w$]*'

// `exported` is derived from a leading `export` on the line (EXPORT_PREFIX),
// so each rule only carries the regex + how to read kind/name. Rules are tried
// in order; first match wins. `const enum` is handled before const/let/var so
// the enum name is captured (not the keyword). `abstract` is allowed before
// class so abstract classes — and their methods — are not dropped.
const EXPORT_PREFIX = /^\s*export\s/
const JS_DECL_RES = [
  // export default [async] [abstract] function/class Foo  (named default export)
  { re: new RegExp(`^\\s*export\\s+default\\s+(?:async\\s+)?(?:abstract\\s+)?(function\\*?|class)\\s+(${ID})`), kindFrom: 1, nameFrom: 2 },
  // [export] const enum Foo  (TS const enum — before the const/let/var rule)
  { re: new RegExp(`^\\s*(?:export\\s+)?const\\s+enum\\s+(${ID})`), kind: 'enum', nameFrom: 1 },
  // [export] [async] [abstract] function/class/interface/type/enum/namespace Foo
  { re: new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?(?:abstract\\s+)?(function\\*?|class|interface|type|enum|namespace)\\s+(${ID})`), kindFrom: 1, nameFrom: 2 },
  // [export] const/let/var Foo
  { re: new RegExp(`^\\s*(?:export\\s+)?(const|let|var)\\s+(${ID})`), kindFrom: 1, nameFrom: 2 },
]

const JS_IMPORT_RES = [
  // static import — but NOT import(...) (dynamic) which the (?!\s*\() rejects.
  { re: /^\s*import\b(?!\s*\()[^'"]*['"]([^'"]+)['"]/, kind: 'import' },
  { re: /^\s*export\b[^'"]*\bfrom\s*['"]([^'"]+)['"]/, kind: 'export-from' },
  { re: /(?:^|[^.\w])require\s*\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'require' },
  { re: /(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'dynamic-import' },
]

// Opens a multi-line static import (`import {` / `import foo` with the module
// on a later line). Excludes import.meta and import(...) via the lookahead.
const JS_IMPORT_OPEN = /^\s*import\b(?!\s*[.(])/
// Resolves a multi-line import's tail: `} from 'x'` / `from 'x'`.
const JS_FROM_CLAUSE = /\bfrom\s+['"]([^'"]+)['"]/

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'class',
  'else', 'do', 'try', 'with', 'await', 'yield', 'typeof', 'new', 'in', 'of',
  'case', 'const', 'let', 'var', 'export', 'import', 'default', 'super',
])

function normalizeKind(raw) {
  if (raw.startsWith('function')) return 'function'
  return raw
}

export function extractJsTs(text) {
  const masked = maskJsTs(text)
  const lines = masked.split('\n')
  const origLines = text.split('\n')
  /** @type {SymbolRecord[]} */
  const symbols = []
  /** @type {ImportRecord[]} */
  const imports = []

  let depth = 0
  // Stack of class scopes for method attribution: { name, depth }
  const classStack = []
  // A multi-line static import opened but not yet resolved: { line, openedAt }.
  let pendingImport = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const enclosing = classStack.length ? classStack[classStack.length - 1].name : ''

    // Resolve a pending multi-line import on its `from 'x'` tail. Detect on the
    // masked line; extract the specifier from the original (the masker blanks
    // the string body). Abandon if a new statement starts first, or it runs on.
    if (pendingImport) {
      if (JS_FROM_CLAUSE.test(line)) {
        const m = origLines[i].match(JS_FROM_CLAUSE)
        if (m) imports.push({ module: m[1], line: pendingImport.line, kind: 'import' })
        pendingImport = null
      } else if (
        JS_IMPORT_OPEN.test(line) ||
        i - pendingImport.openedAt > 20 ||
        JS_DECL_RES.some(s => s.re.test(line))
      ) {
        pendingImport = null
      }
    }

    // Imports (single-line): DETECT on the masked line (so a commented-out
    // import is ignored) but EXTRACT the specifier from the original line.
    let importedThisLine = false
    if (!pendingImport) {
      for (const { re, kind } of JS_IMPORT_RES) {
        if (re.test(line)) {
          const m = origLines[i].match(re)
          if (m) { imports.push({ module: m[1], line: lineNo, kind }); importedThisLine = true }
        }
      }
      // Open a multi-line static import (module specifier on a later line).
      if (!importedThisLine && JS_IMPORT_OPEN.test(line) && !/['"]/.test(line)) {
        pendingImport = { line: lineNo, openedAt: i }
      }
    }

    // Declarations (exported = leading `export` on the line).
    let matchedDecl = null
    const exported = EXPORT_PREFIX.test(line)
    for (const spec of JS_DECL_RES) {
      const m = line.match(spec.re)
      if (m) {
        const kind = spec.kind ?? normalizeKind(m[spec.kindFrom])
        const name = m[spec.nameFrom]
        symbols.push({ name, kind, line: lineNo, exported, scope: enclosing })
        matchedDecl = { kind, name }
        break
      }
    }

    // Class methods: a method-like line directly inside a class body — either a
    // `name(...)` / `name<...>` member, or a `name = (...) =>` field arrow.
    if (!matchedDecl && classStack.length && depth === classStack[classStack.length - 1].depth + 1) {
      const member = line.match(new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|readonly\\s+|static\\s+|abstract\\s+|override\\s+|declare\\s+|accessor\\s+|async\\s+|get\\s+|set\\s+|\\*\\s*)*(${ID})\\s*[(<]`))
      const fieldArrow = line.match(new RegExp(`^\\s*(?:public\\s+|private\\s+|protected\\s+|readonly\\s+|static\\s+)*(${ID})\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${ID})\\s*=>`))
      const mm = member ?? fieldArrow
      if (mm && !JS_KEYWORDS.has(mm[1])) {
        symbols.push({ name: mm[1], kind: 'method', line: lineNo, exported: false, scope: enclosing })
      }
    }

    // Update brace depth and class scope stack using this line's net braces.
    const opens = countChar(line, '{')
    const closes = countChar(line, '}')
    if (matchedDecl?.kind === 'class' && opens > closes) {
      classStack.push({ name: matchedDecl.name, depth })
    }
    depth += opens - closes
    if (depth < 0) depth = 0
    while (classStack.length && depth <= classStack[classStack.length - 1].depth) {
      classStack.pop()
    }
  }

  return { symbols, imports }
}

function countChar(s, ch) {
  let count = 0
  for (let i = 0; i < s.length; i++) if (s[i] === ch) count++
  return count
}

// ---------------------------------------------------------------------------
// Python extractor (scope by indentation)
// ---------------------------------------------------------------------------

const PY_DECL_RE = new RegExp(`^(\\s*)(?:(async)\\s+)?(def|class)\\s+(${ID})`)
const PY_FROM_RE = /^\s*from\s+([.\w]+)\s+import\b/
const PY_IMPORT_RE = /^\s*import\s+(.+)$/

export function extractPython(text) {
  const masked = maskPython(text)
  const lines = masked.split('\n')
  /** @type {SymbolRecord[]} */
  const symbols = []
  /** @type {ImportRecord[]} */
  const imports = []

  // Stack of enclosing def/class scopes: { name, indent }
  const scopeStack = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    if (line.trim() === '') continue

    const fromM = line.match(PY_FROM_RE)
    if (fromM) {
      imports.push({ module: fromM[1], line: lineNo, kind: 'import' })
    } else {
      const importM = line.match(PY_IMPORT_RE)
      if (importM) {
        // `import a, b.c, d as e` -> a, b.c, d (strip aliases, split on commas)
        for (const part of importM[1].split(',')) {
          const mod = part.trim().split(/\s+as\s+/)[0].trim()
          if (/^[.\w]+$/.test(mod)) imports.push({ module: mod, line: lineNo, kind: 'import' })
        }
      }
    }

    const m = line.match(PY_DECL_RE)
    if (m) {
      const indent = m[1].length
      const kind = m[3] === 'class' ? 'class' : 'def'
      const name = m[4]
      while (scopeStack.length && indent <= scopeStack[scopeStack.length - 1].indent) {
        scopeStack.pop()
      }
      const scope = scopeStack.length ? scopeStack[scopeStack.length - 1].name : ''
      // Top-level defs/classes are "exported" in Python's module sense.
      symbols.push({ name, kind, line: lineNo, exported: scope === '', scope })
      scopeStack.push({ name, indent })
    }
  }

  return { symbols, imports }
}
