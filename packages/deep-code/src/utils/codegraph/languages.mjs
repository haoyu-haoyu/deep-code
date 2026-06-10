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
 * @property {'function'|'class'|'const'|'let'|'var'|'interface'|'type'|'enum'|'namespace'|'method'|'def'|'struct'|'trait'|'impl'|'mod'|'package'} kind
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
const GO_EXTENSIONS = new Set(['.go'])
const RUST_EXTENSIONS = new Set(['.rs'])

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
  if (GO_EXTENSIONS.has(ext)) return 'go'
  if (RUST_EXTENSIONS.has(ext)) return 'rust'
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
  if (language === 'go') return extractGo(text)
  if (language === 'rust') return extractRust(text)
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

// Class-body member detectors, compiled ONCE (they were rebuilt per line inside the
// extractJsTs loop). Both are static — `ID` is a constant — and are used with
// String.match (no `g` flag, so no shared lastIndex state), so a single instance is
// behavior-identical to a per-line `new RegExp`.
//   JS_CLASS_MEMBER_RE: a `name(...)` / `name<...>` method member, after any modifier run.
//   JS_CLASS_FIELD_ARROW_RE: a `name = (...) =>` / `name = arg =>` field arrow.
const JS_CLASS_MEMBER_RE = new RegExp(
  `^\\s*(?:public\\s+|private\\s+|protected\\s+|readonly\\s+|static\\s+|abstract\\s+|override\\s+|declare\\s+|accessor\\s+|async\\s+|get\\s+|set\\s+|\\*\\s*)*(${ID})\\s*[(<]`,
)
const JS_CLASS_FIELD_ARROW_RE = new RegExp(
  `^\\s*(?:public\\s+|private\\s+|protected\\s+|readonly\\s+|static\\s+)*(${ID})\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${ID})\\s*=>`,
)

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
      const member = line.match(JS_CLASS_MEMBER_RE)
      const fieldArrow = line.match(JS_CLASS_FIELD_ARROW_RE)
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

// ---------------------------------------------------------------------------
// Go extractor
// ---------------------------------------------------------------------------

const GO_ID = '[A-Za-z_][A-Za-z0-9_]*'
// Go visibility is by capitalization: an identifier is exported iff its first
// rune is upper-case.
const goExported = name => /^[\p{Lu}]/u.test(name)

// Mask Go comments + string/rune literals (bodies -> spaces, delimiters +
// newlines + length preserved). Go has line and C-style block comments
// (non-nesting), `"..."` interpreted strings, backtick raw strings (span
// newlines, no escapes), and `'...'` rune literals (so a brace inside a rune
// can't corrupt brace tracking — Go has no `'`-lifetimes, unlike Rust).
export function maskGo(text) {
  const out = new Array(text.length)
  let state = 'code' // code | line | block | dq | raw | rune
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    const keep = c === '\n' ? '\n' : ' '
    switch (state) {
      case 'code':
        if (c === '/' && n === '/') { state = 'line'; out[i] = ' ' }
        else if (c === '/' && n === '*') { state = 'block'; out[i] = ' ' }
        else if (c === '"') { state = 'dq'; out[i] = c }
        else if (c === '`') { state = 'raw'; out[i] = c }
        else if (c === "'") { state = 'rune'; out[i] = c }
        else out[i] = c
        break
      case 'line':
        out[i] = keep
        if (c === '\n') state = 'code'
        break
      case 'block':
        out[i] = keep
        if (c === '*' && n === '/') { out[i + 1] = ' '; i++; state = 'code' }
        break
      case 'dq': // interpreted string: escapes, cannot span a newline
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++ } }
        else if (c === '"' || c === '\n') { out[i] = c; state = 'code' }
        else out[i] = keep
        break
      case 'raw': // `...` raw string: no escapes, spans newlines
        if (c === '`') { out[i] = c; state = 'code' }
        else out[i] = keep
        break
      case 'rune':
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++ } }
        else if (c === "'" || c === '\n') { out[i] = c; state = 'code' }
        else out[i] = keep
        break
    }
  }
  return out.join('')
}

const GO_PACKAGE_RE = new RegExp(`^\\s*package\\s+(${GO_ID})`)
// func (recv [*]T) Name   |   func (recv [*]T[generics]) Name
const GO_METHOD_RE = new RegExp(`^\\s*func\\s+\\(\\s*(?:${GO_ID}\\s+)?\\*?(${GO_ID})\\b[^)]*\\)\\s+(${GO_ID})`)
// func Name(  |  func Name[  (generic)
const GO_FUNC_RE = new RegExp(`^\\s*func\\s+(${GO_ID})\\s*[([]`)
const GO_TYPE_KIND_RE = new RegExp(`^\\s*type\\s+(${GO_ID})\\s+(struct|interface)\\b`)
const GO_TYPE_ALIAS_RE = new RegExp(`^\\s*type\\s+(${GO_ID})\\s+\\S`)
const GO_CONST_RE = new RegExp(`^\\s*const\\s+(${GO_ID})`)
const GO_VAR_RE = new RegExp(`^\\s*var\\s+(${GO_ID})`)
// [alias|.|_] "path"  or  [alias] `path`  — the module specifier is quoted.
const GO_IMPORT_SPEC_RE = new RegExp(`(?:(?:${GO_ID}|\\.|_)\\s+)?[\`"]([^\`"]+)[\`"]`)
const GO_IMPORT_SINGLE_RE = new RegExp(`^\\s*import\\s+${GO_IMPORT_SPEC_RE.source}`)
const GROUP_OPEN_RE = /^\s*(import|type|const|var)\s*\(\s*$/
// inside a grouped `type (...)`: `Name struct|interface` or `Name OtherType`
const GO_GROUP_TYPE_KIND_RE = new RegExp(`^\\s*(${GO_ID})\\s+(struct|interface)\\b`)
const GO_GROUP_TYPE_ALIAS_RE = new RegExp(`^\\s*(${GO_ID})\\s+\\S`)
const GO_GROUP_NAME_RE = new RegExp(`^\\s*(${GO_ID})`)

export function extractGo(text) {
  const masked = maskGo(text)
  const lines = masked.split('\n')
  const origLines = text.split('\n')
  /** @type {SymbolRecord[]} */
  const symbols = []
  /** @type {ImportRecord[]} */
  const imports = []
  let group = null // 'import' | 'type' | 'const' | 'var' | null — open grouped decl

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1

    // Inside a grouped declaration: a `)` at the start closes it.
    if (group) {
      if (/^\s*\)/.test(line)) { group = null; continue }
      if (line.trim() === '') continue
      if (group === 'import') {
        const om = origLines[i].match(GO_IMPORT_SPEC_RE)
        if (om) imports.push({ module: om[1], line: lineNo, kind: 'import' })
      } else if (group === 'type') {
        const tk = line.match(GO_GROUP_TYPE_KIND_RE)
        const ta = line.match(GO_GROUP_TYPE_ALIAS_RE)
        if (tk) symbols.push({ name: tk[1], kind: tk[2] === 'struct' ? 'struct' : 'interface', line: lineNo, exported: goExported(tk[1]), scope: '' })
        else if (ta) symbols.push({ name: ta[1], kind: 'type', line: lineNo, exported: goExported(ta[1]), scope: '' })
      } else {
        // const | var group: first identifier on the line is the name
        const gm = line.match(GO_GROUP_NAME_RE)
        if (gm) symbols.push({ name: gm[1], kind: group, line: lineNo, exported: goExported(gm[1]), scope: '' })
      }
      continue
    }

    // Open a grouped declaration: `import (` / `type (` / `const (` / `var (`.
    const openM = line.match(GROUP_OPEN_RE)
    if (openM) { group = openM[1]; continue }

    // package
    const pkg = line.match(GO_PACKAGE_RE)
    if (pkg) { symbols.push({ name: pkg[1], kind: 'package', line: lineNo, exported: true, scope: '' }); continue }

    // single-line import
    const imp = origLines[i].match(GO_IMPORT_SINGLE_RE)
    if (imp && GO_IMPORT_SINGLE_RE.test(line)) { imports.push({ module: imp[1], line: lineNo, kind: 'import' }); continue }

    // method (receiver) — try before plain func
    const method = line.match(GO_METHOD_RE)
    if (method) {
      symbols.push({ name: method[2], kind: 'method', line: lineNo, exported: goExported(method[2]), scope: method[1] })
      continue
    }
    const fn = line.match(GO_FUNC_RE)
    if (fn) { symbols.push({ name: fn[1], kind: 'function', line: lineNo, exported: goExported(fn[1]), scope: '' }); continue }

    // type X struct|interface  |  type X <alias>
    const tk = line.match(GO_TYPE_KIND_RE)
    if (tk) { symbols.push({ name: tk[1], kind: tk[2] === 'struct' ? 'struct' : 'interface', line: lineNo, exported: goExported(tk[1]), scope: '' }); continue }
    const ta = line.match(GO_TYPE_ALIAS_RE)
    if (ta) { symbols.push({ name: ta[1], kind: 'type', line: lineNo, exported: goExported(ta[1]), scope: '' }); continue }

    // const / var
    const cm = line.match(GO_CONST_RE)
    if (cm) { symbols.push({ name: cm[1], kind: 'const', line: lineNo, exported: goExported(cm[1]), scope: '' }); continue }
    const vm = line.match(GO_VAR_RE)
    if (vm) { symbols.push({ name: vm[1], kind: 'var', line: lineNo, exported: goExported(vm[1]), scope: '' }); continue }
  }

  return { symbols, imports }
}

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

const RS_ID = '[A-Za-z_][A-Za-z0-9_]*'
// `pub`, `pub(crate)`, `pub(in path)` … all count as exported.
const RS_PUB = /^\s*pub\b/

// Mask Rust comments + string/char literals. Rust block comments NEST (a depth
// counter handles inner open/close pairs); strings are `"..."` (escapes) and
// raw `r"..."` / `r#"..."#` (hash-balanced, no escapes); char literals like
// `'x'` / `'\n'` are masked (so a brace inside a char literal can't corrupt
// brace tracking) but lifetimes (`'a`, `'static`) are left as code —
// disambiguated by whether a closing `'` follows a single char.
export function maskRust(text) {
  const out = new Array(text.length)
  let state = 'code' // code | line | block | dq | raw | char
  let blockDepth = 0
  let rawHashes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    const keep = c === '\n' ? '\n' : ' '
    switch (state) {
      case 'code': {
        if (c === '/' && n === '/') { state = 'line'; out[i] = ' ' }
        else if (c === '/' && n === '*') { state = 'block'; blockDepth = 1; out[i] = ' '; out[i + 1] = ' '; i++ }
        else if (c === '"') { state = 'dq'; out[i] = c }
        else if (c === 'r' && (n === '"' || n === '#')) {
          // raw string r"..." / r#"..."# (vs the raw identifier r#name) — only a
          // string if the hashes are followed by a quote.
          let j = i + 1
          let hashes = 0
          while (text[j] === '#') { hashes++; j++ }
          if (text[j] === '"') {
            state = 'raw'; rawHashes = hashes
            for (let k = i; k <= j; k++) out[k] = text[k]
            i = j
          } else out[i] = c
        }
        else if (c === "'") {
          // char literal ('x' / '\n') vs lifetime ('a / 'static): a char literal
          // either escapes (next is \) or is a single char then a closing '.
          if (n === '\\') { state = 'char'; out[i] = c }
          else if (text[i + 2] === "'") { state = 'char'; out[i] = c }
          else out[i] = c // lifetime → code
        }
        else out[i] = c
        break
      }
      case 'line':
        out[i] = keep
        if (c === '\n') state = 'code'
        break
      case 'block':
        if (c === '/' && n === '*') { blockDepth++; out[i] = ' '; out[i + 1] = ' '; i++ }
        else if (c === '*' && n === '/') { blockDepth--; out[i] = ' '; out[i + 1] = ' '; i++; if (blockDepth === 0) state = 'code' }
        else out[i] = keep
        break
      case 'dq':
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++ } }
        else if (c === '"') { out[i] = c; state = 'code' }
        else out[i] = keep
        break
      case 'raw': { // ends at a `"` followed by exactly rawHashes `#`
        if (c === '"') {
          let ok = true
          for (let k = 1; k <= rawHashes; k++) { if (text[i + k] !== '#') { ok = false; break } }
          if (ok) {
            out[i] = c
            for (let k = 1; k <= rawHashes; k++) out[i + k] = '#'
            i += rawHashes
            state = 'code'
          } else out[i] = keep
        } else out[i] = keep
        break
      }
      case 'char':
        if (c === '\\') { out[i] = ' '; if (i + 1 < text.length) { out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i++ } }
        else if (c === "'" || c === '\n') { out[i] = c; state = 'code' }
        else out[i] = keep
        break
    }
  }
  return out.join('')
}

// optional `pub` / `pub(crate)` / `pub(in ...)` prefix
const RS_VIS = `(?:pub(?:\\([^)]*\\))?\\s+)?`
const RS_FN_RE = new RegExp(`^\\s*${RS_VIS}(?:(?:default|async|const|unsafe|extern(?:\\s+"[^"]*")?)\\s+)*fn\\s+(${RS_ID})`)
const RS_STRUCT_RE = new RegExp(`^\\s*${RS_VIS}struct\\s+(${RS_ID})`)
const RS_ENUM_RE = new RegExp(`^\\s*${RS_VIS}enum\\s+(${RS_ID})`)
const RS_UNION_RE = new RegExp(`^\\s*${RS_VIS}union\\s+(${RS_ID})`)
const RS_TRAIT_RE = new RegExp(`^\\s*${RS_VIS}(?:unsafe\\s+)?trait\\s+(${RS_ID})`)
const RS_MOD_RE = new RegExp(`^\\s*${RS_VIS}mod\\s+(${RS_ID})`)
const RS_TYPE_RE = new RegExp(`^\\s*${RS_VIS}type\\s+(${RS_ID})`)
const RS_CONST_RE = new RegExp(`^\\s*${RS_VIS}(?:const|static)\\s+(?:mut\\s+)?(${RS_ID})`)
// impl Trait for Type  →  Type ;  impl[<…>] Type  →  Type
const RS_IMPL_FOR_RE = new RegExp(`^\\s*(?:unsafe\\s+)?impl\\b[^{]*\\bfor\\s+([A-Za-z_][\\w]*)`)
const RS_IMPL_RE = new RegExp(`^\\s*(?:unsafe\\s+)?impl(?:\\s*<[^>]*>)?\\s+([A-Za-z_][\\w]*)`)
const RS_USE_RE = new RegExp(`^\\s*${RS_VIS}use\\s+`)

export function extractRust(text) {
  const masked = maskRust(text)
  const lines = masked.split('\n')
  /** @type {SymbolRecord[]} */
  const symbols = []
  /** @type {ImportRecord[]} */
  const imports = []

  let depth = 0
  // impl/trait scopes for method attribution: { name, depth }
  const scopeStack = []
  // a multi-line `use …;` opened but not yet terminated
  let pendingUse = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const enclosing = scopeStack.length ? scopeStack[scopeStack.length - 1].name : ''
    const exported = RS_PUB.test(line)

    // Resolve a multi-line use on the line bearing its `;`.
    if (pendingUse) {
      pendingUse.text += ` ${line.trim()}`
      if (line.includes(';') || i - pendingUse.openedAt > 20) {
        const mod = pendingUse.text.replace(/;[\s\S]*$/, '').replace(RS_USE_RE, '').trim()
        if (mod) imports.push({ module: mod, line: pendingUse.line, kind: 'import' })
        pendingUse = null
      }
      applyBraces(line)
      continue
    }

    // use (single line, or open a multi-line one)
    if (RS_USE_RE.test(line)) {
      if (line.includes(';')) {
        const mod = line.replace(/;[\s\S]*$/, '').replace(RS_USE_RE, '').trim()
        if (mod) imports.push({ module: mod, line: lineNo, kind: 'import' })
      } else {
        pendingUse = { text: line.trim(), line: lineNo, openedAt: i }
      }
      applyBraces(line)
      continue
    }

    let decl = null // { name, kind, opensScope }
    const fn = line.match(RS_FN_RE)
    const isMethod = scopeStack.length && depth === scopeStack[scopeStack.length - 1].depth + 1
    if (fn) {
      symbols.push({ name: fn[1], kind: isMethod ? 'method' : 'function', line: lineNo, exported, scope: isMethod ? enclosing : '' })
    } else {
      const implFor = line.match(RS_IMPL_FOR_RE)
      const impl = implFor ?? line.match(RS_IMPL_RE)
      const struct = line.match(RS_STRUCT_RE)
      const en = line.match(RS_ENUM_RE)
      const union = line.match(RS_UNION_RE)
      const trait = line.match(RS_TRAIT_RE)
      const mod = line.match(RS_MOD_RE)
      const ty = line.match(RS_TYPE_RE)
      const cs = line.match(RS_CONST_RE)
      if (impl) { symbols.push({ name: impl[1], kind: 'impl', line: lineNo, exported: false, scope: '' }); decl = { name: impl[1], opensScope: true } }
      else if (struct) symbols.push({ name: struct[1], kind: 'struct', line: lineNo, exported, scope: enclosing })
      else if (en) symbols.push({ name: en[1], kind: 'enum', line: lineNo, exported, scope: enclosing })
      else if (union) symbols.push({ name: union[1], kind: 'struct', line: lineNo, exported, scope: enclosing })
      else if (trait) { symbols.push({ name: trait[1], kind: 'trait', line: lineNo, exported, scope: enclosing }); decl = { name: trait[1], opensScope: true } }
      else if (mod) symbols.push({ name: mod[1], kind: 'mod', line: lineNo, exported, scope: enclosing })
      else if (ty) symbols.push({ name: ty[1], kind: 'type', line: lineNo, exported, scope: enclosing })
      else if (cs) symbols.push({ name: cs[1], kind: 'const', line: lineNo, exported, scope: enclosing })
    }

    // Brace + scope bookkeeping. impl/trait whose line opens a body push a scope.
    // HEURISTIC LIMIT: the body-opening `{` must be on the impl/trait line; if a
    // multi-line generic/`where` clause pushes it to a later line, no scope is
    // pushed and that block's methods are attributed at top level (kind stays
    // 'method'-vs-'function' wrong). Acceptable for this candidate-level indexer.
    const opens = countChar(line, '{')
    const closes = countChar(line, '}')
    if (decl?.opensScope && opens > closes) scopeStack.push({ name: decl.name, depth })
    depth += opens - closes
    if (depth < 0) depth = 0
    while (scopeStack.length && depth <= scopeStack[scopeStack.length - 1].depth) scopeStack.pop()
  }

  return { symbols, imports }

  // Keep brace depth honest across use/pending lines (a `use a::{…}` group's
  // braces are balanced, but multi-line groups still move depth mid-block).
  function applyBraces(line) {
    depth += countChar(line, '{') - countChar(line, '}')
    if (depth < 0) depth = 0
    while (scopeStack.length && depth <= scopeStack[scopeStack.length - 1].depth) scopeStack.pop()
  }
}
