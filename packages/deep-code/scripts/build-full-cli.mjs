import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'src')
const outDir = join(packageRoot, 'dist')
// --inline-requires bundles pure-JS dynamic require() deps INTO the artifact
// (instead of leaving them external for runtime NODE_PATH resolution) so the
// output is self-contained and `bun --compile` can produce a working binary.
// The default (lean) bundle keeps them external to stay small for the npm
// tarball, which ships node_modules alongside it.
const inlineRequires = process.argv.includes('--inline-requires')
const outFile = join(
  outDir,
  inlineRequires ? 'deepcode-full-inline.mjs' : 'deepcode-full.mjs',
)

// Resolve bare specifiers from the package root (Node walks up to the hoisted
// node_modules). In --inline-requires mode we inline only deps that are
// actually installed; optional/uninstalled dynamic requires (e.g. telemetry
// exporters) stay external and fail-soft behind their existing guards, exactly
// as they do for an `npm install` that omits them.
const requireFromPackage = createRequire(join(packageRoot, 'package.json'))
function canResolveBarePackage(specifier) {
  try {
    requireFromPackage.resolve(specifier)
    return true
  } catch {
    return false
  }
}

// In the default (lean) build, optional/native/stripped-feature modules are
// left external and resolved from node_modules at runtime. The inline build
// (consumed by `bun --compile`) has no runtime node_modules, and an
// unresolvable external literal breaks the compile — so there we replace them
// with an empty stub instead, keeping the artifact self-contained. These
// modules are never reached in normal CLI use: image processing (sharp), the
// daemon/server/ssh/self-hosted-runner features the DeepSeek rebrand stripped,
// and optional telemetry exporters. If one is somehow invoked in the binary it
// fails the same way an absent optional dependency would for an npm install.
const INLINE_STUB_NAMESPACE = 'deepcode-inline-unavailable'
function externalOrStub(path) {
  if (inlineRequires) return { path, namespace: INLINE_STUB_NAMESPACE }
  return { path, external: true }
}
const buildEntry = join(outDir, '.deepcode-full-entry.mjs')
const buildOutDir = join(outDir, '.full-cli-build')

const optionalBarePackages = new Set([
  '@ant/computer-use-mcp',
  '@ant/computer-use-mcp/sentinelApps',
  '@ant/computer-use-mcp/types',
  '@ant/computer-use-input',
  '@ant/computer-use-swift',
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/mcpb',
  '@aws-crypto/sha256-js',
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-provider-node',
  '@azure/identity',
  '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/sdk/server/index.js',
  'fsevents',
  'fflate',
  'google-auth-library',
  'modifiers-napi',
  'qrcode',
  'sharp',
  'turndown',
  'vscode-jsonrpc/node.js',
])

const optionalStaticStubs = new Map([
  [
    '@ant/computer-use-mcp',
    `
export function buildComputerUseTools() {
  return []
}
export function createComputerUseMcpServer() {
  return {
    setRequestHandler() {},
    setNotificationHandler() {},
    connect() {
      return Promise.resolve()
    },
    close() {
      return Promise.resolve()
    },
  }
}
export function bindSessionContext() {
  return async () => ({
    content: [{ type: 'text', text: 'Computer use is not bundled in this Deep Code build.' }],
  })
}
export const DEFAULT_GRANT_FLAGS = {}
export const API_RESIZE_PARAMS = {}
export function targetImageSize(width, height) {
  return [width, height]
}
`,
  ],
  [
    '@ant/computer-use-mcp/sentinelApps',
    `
export function getSentinelCategory() {
  return 'other'
}
`,
  ],
  [
    '@ant/computer-use-mcp/types',
    `
export const DEFAULT_GRANT_FLAGS = {}
`,
  ],
  [
    '@modelcontextprotocol/sdk/server/index.js',
    `
export class Server {
  constructor() {}
  setRequestHandler() {}
  setNotificationHandler() {}
  connect() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}
`,
  ],
  [
    '@modelcontextprotocol/sdk/server/stdio.js',
    `
export class StdioServerTransport {
  constructor() {}
}
`,
  ],
  [
    'vscode-jsonrpc/node.js',
    `
export const Trace = { Off: 'off', Messages: 'messages', Verbose: 'verbose' }
export class StreamMessageReader {
  constructor(stream) {
    this.stream = stream
  }
}
export class StreamMessageWriter {
  constructor(stream) {
    this.stream = stream
  }
}
export function createMessageConnection() {
  return {
    listen() {},
    dispose() {},
    trace() {},
    sendRequest() {
      return Promise.reject(new Error('vscode-jsonrpc is not bundled in this Deep Code build'))
    },
    sendNotification() {},
    onNotification() {},
    onRequest() {},
  }
}
`,
  ],
  [
    'qrcode',
    `
export function toString(value, options, callback) {
  const rendered = String(value ?? '')
  const cb = typeof options === 'function' ? options : callback
  if (cb) cb(null, rendered)
  return Promise.resolve(rendered)
}
`,
  ],
  [
    'google-auth-library',
    `
export class GoogleAuth {
  constructor() {}
  async getClient() {
    throw new Error('google-auth-library is not bundled in this Deep Code build')
  }
  async getAccessToken() {
    throw new Error('google-auth-library is not bundled in this Deep Code build')
  }
}
`,
  ],
])

const cjsStubs = new Map([
  [
    'string-width',
    `
// Deep Code full CLI string width shim.
function stripAnsi(value) {
  return String(value ?? '').replace(/[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))/g, '')
}
function isFullwidthCodePoint(codePoint) {
  if (!Number.isInteger(codePoint)) return false
  return (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  )
}
function stringWidth(value) {
  const string = stripAnsi(value)
  let width = 0
  for (let index = 0; index < string.length; index++) {
    const codePoint = string.codePointAt(index)
    if (codePoint === undefined) continue
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) continue
    if (codePoint >= 0x300 && codePoint <= 0x36f) continue
    if (codePoint > 0xffff) index++
    width += isFullwidthCodePoint(codePoint) ? 2 : 1
  }
  return width
}
module.exports = stringWidth
module.exports.default = stringWidth
`,
  ],
  [
    'signal-exit',
    `
function onExit(callback) {
  if (typeof callback !== 'function') {
    return function noop() {}
  }
  const handler = code => callback(code, null)
  process.once('exit', handler)
  return function remove() {
    process.removeListener('exit', handler)
  }
}
module.exports = onExit
module.exports.default = onExit
module.exports.onExit = onExit
`,
  ],
  [
    'escape-string-regexp',
    `
module.exports = function escapeStringRegexp(value) {
  return String(value).replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&').replace(/-/g, '\\\\x2d')
}
module.exports.default = module.exports
`,
  ],
  [
    'is-binary-path',
    `
module.exports = function isBinaryPath(value) {
  return /\\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dmg|so|dll|dylib|wasm|node)$/i.test(String(value))
}
module.exports.default = module.exports
`,
  ],
  [
    'anymatch',
    `
function anymatch() {
  return false
}
module.exports = anymatch
module.exports.default = anymatch
`,
  ],
  [
    'glob-parent',
    `
const path = require('path')
module.exports = function globParent(value) {
  const input = String(value || '.')
  const idx = input.search(/[!*?[\\]{}()]/)
  return idx === -1 ? path.dirname(input) : path.dirname(input.slice(0, idx))
}
module.exports.default = module.exports
`,
  ],
  [
    'is-glob',
    `
module.exports = function isGlob(value) {
  return /[!*?[\\]{}()]/.test(String(value))
}
module.exports.default = module.exports
`,
  ],
  [
    'braces',
    `
function braces(value) {
  return Array.isArray(value) ? value : [String(value)]
}
braces.expand = braces
module.exports = braces
module.exports.default = braces
`,
  ],
  [
    'normalize-path',
    `
module.exports = function normalizePath(value) {
  return String(value).replace(/\\\\+/g, '/')
}
module.exports.default = module.exports
`,
  ],
  [
    'utf-8-validate',
    `
module.exports = function isValidUTF8() {
  return true
}
module.exports.default = module.exports
`,
  ],
])

const featureOnlyImportPatterns = [
  /^@img\//,
  /^@ant\/computer-use-/,
  /^@aws-/,
  /^@aws-sdk\//,
  /^@smithy\//,
  /^\.\.\/daemon\//,
  /^\.\.\/environment-runner\//,
  /^\.\.\/self-hosted-runner\//,
  /^\.\.\/cli\/bg\.js$/,
  /^\.\.\/cli\/handlers\/templateJobs\.js$/,
  /^\.\.\/services\/compact\/cachedMCConfig\.js$/,
  /^\.\.\/proactive\/index\.js$/,
  /^\.\.\/tools\/DiscoverSkillsTool\/prompt\.js$/,
  /^\.\.\/services\/skillSearch\/featureCheck\.js$/,
  /^\.\/assistant\//,
  /^\.\/server\//,
  /^\.\/ssh\/createSSHSession\.js$/,
  /^\.\/components\/agents\/SnapshotUpdateDialog\.js$/,
  /^\.\/protectedNamespace\.js$/,
  /^src\/cli\/update\.js$/,
]

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function candidatePaths(path) {
  const candidates = [path]

  if (path.endsWith('.js')) {
    const stem = path.slice(0, -3)
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mjs`, `${stem}.jsx`)
  } else if (!/\.[cm]?[jt]sx?$/.test(path)) {
    candidates.push(
      `${path}.ts`,
      `${path}.tsx`,
      `${path}.js`,
      `${path}.mjs`,
      `${path}.jsx`,
      join(path, 'index.ts'),
      join(path, 'index.tsx'),
      join(path, 'index.js'),
      join(path, 'index.mjs'),
    )
  }

  return candidates
}

function resolveModulePath(basePath) {
  for (const candidate of candidatePaths(basePath)) {
    if (isFile(candidate)) return candidate
  }
  return undefined
}

function splitPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name, ...rest] = specifier.split('/')
    return {
      packageName: `${scope}/${name}`,
      subpath: rest.join('/'),
    }
  }

  const [packageName, ...rest] = specifier.split('/')
  return {
    packageName,
    subpath: rest.join('/'),
  }
}

function resolveBarePackageShim(specifier) {
  const { packageName, subpath } = splitPackageSpecifier(specifier)
  const packageDir = join(packageRoot, 'node_modules', packageName)
  if (!existsSync(packageDir)) return undefined

  if (subpath) {
    return resolveModulePath(join(packageDir, subpath))
  }

  const packageJson = join(packageDir, 'package.json')
  if (existsSync(packageJson)) return undefined

  const simpleName = basename(packageName).replace(/\.js$/, '')
  for (const candidate of [
    join(packageDir, `${simpleName}.js`),
    join(packageDir, 'dist', `${simpleName}.mjs`),
    join(packageDir, 'dist', `${simpleName}.js`),
    join(packageDir, 'lib', 'index.js'),
    join(packageDir, 'index.js'),
  ]) {
    const resolved = resolveModulePath(candidate)
    if (resolved) return resolved
  }

  return undefined
}

function isFeatureOnlyImport(specifier) {
  return featureOnlyImportPatterns.some(pattern => pattern.test(specifier))
}

const bundleFeaturePlugin = {
  name: 'deepcode-bun-bundle-feature',
  setup(build) {
    build.onResolve({ filter: /^bun:bundle$/ }, () => ({
      path: 'deepcode-bun-bundle-feature',
      namespace: 'deepcode-virtual',
    }))

    build.onLoad({ filter: /^deepcode-bun-bundle-feature$/, namespace: 'deepcode-virtual' }, () => ({
      contents: 'export function feature() { return false }\n',
      loader: 'js',
    }))
  },
}

const textResourcePlugin = {
  name: 'deepcode-text-resources',
  setup(build) {
    build.onResolve({ filter: /\.(txt|md)$/ }, args => {
      const baseDir = args.path.startsWith('.')
        ? dirname(args.importer)
        : sourceRoot
      const resolved = resolveModulePath(
        args.path.startsWith('src/')
          ? join(sourceRoot, args.path.slice(4))
          : resolve(baseDir, args.path),
      )

      return {
        path: resolved ?? args.path,
        namespace: resolved ? 'deepcode-text' : 'deepcode-empty-text',
      }
    })

    build.onLoad({ filter: /.*/, namespace: 'deepcode-text' }, async args => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}\n`,
      loader: 'js',
    }))

    build.onLoad({ filter: /.*/, namespace: 'deepcode-empty-text' }, () => ({
      contents: "export default ''\n",
      loader: 'js',
    }))
  },
}

const sourceAliasPlugin = {
  name: 'deepcode-source-alias',
  setup(build) {
    build.onResolve({ filter: /^src\// }, args => {
      const resolved = resolveModulePath(join(sourceRoot, args.path.slice(4)))
      if (resolved) return { path: resolved }
      if (isFeatureOnlyImport(args.path) || args.kind !== 'import-statement') {
        return externalOrStub(args.path)
      }
      return undefined
    })

    build.onResolve({ filter: /^\.\.?\// }, args => {
      if (!args.importer || !existsSync(args.importer)) return undefined

      const resolved = resolveModulePath(resolve(dirname(args.importer), args.path))
      if (resolved) return { path: resolved }
      if (isFeatureOnlyImport(args.path) || args.kind !== 'import-statement') {
        return externalOrStub(args.path)
      }
      return undefined
    })
  },
}

const optionalExternalPlugin = {
  name: 'deepcode-optional-externals',
  setup(build) {
    build.onResolve({ filter: /^[^./]|^@/ }, args => {
      if (args.path.startsWith('node:') || args.path === 'bun:bundle') {
        return undefined
      }

      if (cjsStubs.has(args.path)) {
        return {
          path: args.path,
          namespace: 'deepcode-cjs-stub',
        }
      }

      if (optionalStaticStubs.has(args.path)) {
        return {
          path: args.path,
          namespace: 'deepcode-optional-stub',
        }
      }

      if (
        optionalBarePackages.has(args.path) ||
        isFeatureOnlyImport(args.path)
      ) {
        return externalOrStub(args.path)
      }

      const shim = resolveBarePackageShim(args.path)
      if (shim) return { path: shim }

      // Dynamic require() of a bare specifier. Normally externalized (resolved
      // from node_modules at runtime via NODE_PATH). In --inline-requires mode
      // we let Bun bundle it INTO the artifact so it is self-contained for
      // `bun --compile` — but only when the dep is actually installed. Optional/
      // uninstalled requires (telemetry exporters, etc.) stay external so they
      // fail-soft behind their guards instead of breaking the build. Genuinely
      // optional/native packages are already kept external above
      // (optionalBarePackages / isFeatureOnlyImport).
      if (args.kind !== 'import-statement') {
        if (inlineRequires && canResolveBarePackage(args.path)) {
          return undefined
        }
        return externalOrStub(args.path)
      }

      return undefined
    })

    build.onLoad({ filter: /.*/, namespace: 'deepcode-optional-stub' }, args => ({
      contents: optionalStaticStubs.get(args.path) ?? 'export {}\n',
      loader: 'js',
    }))

    build.onLoad({ filter: /.*/, namespace: 'deepcode-cjs-stub' }, args => ({
      contents: cjsStubs.get(args.path) ?? 'module.exports = {}\n',
      loader: 'js',
    }))

    // Inline-build stub for optional/native/stripped-feature modules (see
    // externalOrStub). An empty CJS module so both `import()` and `require()`
    // sites resolve; never reached in normal CLI use.
    build.onLoad({ filter: /.*/, namespace: INLINE_STUB_NAMESPACE }, () => ({
      contents: 'module.exports = {}\n',
      loader: 'js',
    }))

    build.onResolve({ filter: /.*/ }, args => {
      if (optionalBarePackages.has(args.path) || isFeatureOnlyImport(args.path)) {
        return externalOrStub(args.path)
      }
      return undefined
    })
  },
}

await mkdir(outDir, { recursive: true })
await rm(buildOutDir, { recursive: true, force: true })

await writeFile(
  buildEntry,
  [
    "import { dirname, resolve } from 'node:path'",
    "import { fileURLToPath } from 'node:url'",
    "const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')",
    "process.env.DEEPCODE_PROVIDER = process.env.DEEPCODE_PROVIDER ?? 'deepseek'",
    "process.env.NODE_PATH = [packageRoot, process.env.NODE_PATH].filter(Boolean).join(':')",
    "await import('../src/deepcode/runtime-macro.mjs')",
    "await import('../src/entrypoints/cli.tsx')",
    '',
  ].join('\n'),
)

const result = await Bun.build({
  entrypoints: [buildEntry],
  outdir: buildOutDir,
  target: 'node',
  format: 'esm',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  splitting: false,
  sourcemap: 'none',
  minify: false,
  plugins: [
    bundleFeaturePlugin,
    textResourcePlugin,
    sourceAliasPlugin,
    optionalExternalPlugin,
  ],
})

await rm(buildEntry, { force: true })

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const outputPath = result.outputs[0]?.path
if (!outputPath) {
  console.error('Deep Code full CLI build did not produce an output file')
  process.exit(1)
}

const source = (await readFile(outputPath, 'utf8')).replace(
  /^\/\/ src\/entrypoints\/cli\.tsx\n/gm,
  '',
)
const header = '#!/usr/bin/env node\n// Deep Code full CLI bundled artifact\n'
await writeFile(outFile, source.startsWith('#!') ? source : `${header}${source}`)
await rm(buildOutDir, { recursive: true, force: true })
await chmod(outFile, 0o755)
console.log(`Built ${outFile}`)
