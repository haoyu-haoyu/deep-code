import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mainTsxPath = resolve(packageRoot, 'src/main.tsx')
const useManageMcpPath = resolve(
  packageRoot,
  'src/services/mcp/useManageMCPConnections.ts',
)

// A1 was an audit recommendation to "make MCP connect non-blocking" so cold
// start drops 300-500ms. Investigation found the interactive path is ALREADY
// non-blocking. These tests guard the architectural invariant — if a future
// edit accidentally adds an `await mcpPromise` in the interactive path, the
// audit issue would actually become real, and the cold start would regress.
// Catching that in CI is cheaper than catching it post-merge.

test('interactive MCP prefetch is fire-and-forget (mcpPromise never awaited)', () => {
  // The architectural invariant: prefetchAllMcpResources returns a promise
  // that is suppressed via .catch but never awaited before REPL renders.
  // If this changes, the slow-server case would block cold start by exactly
  // the slowest MCP server's connect time — hundreds of ms with normal SSH/
  // SSE servers, multiple seconds with broken stdio servers.
  const src = readFileSync(mainTsxPath, 'utf8')
  // The fire-and-forget pattern: a `mcpPromise.catch(() => {})` line
  // suppressing unhandledRejection. This is the marker for "we kicked off
  // the prefetch but don't block on it."
  assert.match(
    src,
    /mcpPromise\.catch\(\(\)\s*=>\s*\{\s*\}\)/,
    'main.tsx must keep mcpPromise as fire-and-forget (.catch suppresses ' +
      'unhandledRejection but no await)',
  )
  // Direct evasion: `await mcpPromise`, `await mcpPromiseGated`, etc.
  assert.doesNotMatch(
    src,
    /await\s+\w*[Mm]cpPromise\w*\b/,
    'main.tsx must never `await mcpPromise` (or any *McpPromise* alias) — ' +
      'that would make MCP block REPL render',
  )
  // Wrapper evasion: `await Promise.race([mcpPromise, timeout])`,
  // `await Promise.all([mcpPromise])`, `await Promise.allSettled([...mcpPromise...])`.
  // Codex flagged this — the bare `await mcpPromise` regex misses it.
  assert.doesNotMatch(
    src,
    /await\s+Promise\.(race|all|allSettled|any)\s*\([^)]*mcpPromise/,
    'main.tsx must never wrap mcpPromise in a Promise combinator and await ' +
      'the wrapper — same blocking effect as awaiting the promise directly',
  )
})

test('the only `await connectMcpBatch` is inside the print-mode block', () => {
  // connectMcpBatch is the local helper inside the -p/--print branch.
  // Its synchronous await is INTENTIONAL — single-turn invocations need
  // turn-1 tools available before the SDK init message. Comment at the
  // call site explains this. We should never grow a second await of the
  // same shape outside that block.
  const src = readFileSync(mainTsxPath, 'utf8')
  const matches = [...src.matchAll(/await\s+connectMcpBatch\s*\(/g)]
  assert.equal(
    matches.length,
    1,
    `expected exactly 1 \`await connectMcpBatch(...)\` (the intentional ` +
      `print-mode block); found ${matches.length}. Adding more would block ` +
      `interactive REPL render on MCP connect.`,
  )
  // Catch renamed/aliased connectors. Codex flagged that
  // `await connectMcp(...)`, `await fooMcpBatch(...)`, etc., would slip
  // past the strict-name check. The print-mode block already has its
  // intentional await above; any OTHER `await*Mcp*Batch` or
  // `await connect*Mcp*` is a regression candidate. The match for the
  // intentional one is `connectMcpBatch`, so allow exactly one
  // `await connect[A-Z]\w*Mcp` and zero of any other variant.
  const anyMcpBatchAwait = [
    ...src.matchAll(/await\s+\w*[Mm]cp[Bb]atch\b/g),
  ]
  assert.equal(
    anyMcpBatchAwait.length,
    1,
    `Found ${anyMcpBatchAwait.length} \`await *McpBatch\` calls; expected 1 ` +
      `(the intentional print-mode connectMcpBatch). Renamed clones would ` +
      `also block REPL render.`,
  )
})

test('useManageMCPConnections kicks off connections without awaiting', () => {
  // The hook starts MCP connection work via getMcpToolsCommandsAndResources
  // and only attaches a .catch for error logging. The result is never
  // awaited inside the hook body; tools land in appState via the
  // onConnectionAttempt callback as servers settle.
  const src = readFileSync(useManageMcpPath, 'utf8')
  // Must contain at least one fire-and-forget call: a
  // getMcpToolsCommandsAndResources(...) followed by .catch but NOT
  // preceded by `await`. Use multiline so the regex spans the call's
  // multi-line argument list.
  const callPattern = /(?<!await\s)getMcpToolsCommandsAndResources\s*\([\s\S]*?\)\s*\.catch\(/g
  const matches = [...src.matchAll(callPattern)]
  assert.ok(
    matches.length >= 1,
    'useManageMCPConnections must start at least one MCP connection ' +
      'without awaiting it (fire-and-forget). If every call became ' +
      'awaited, the hook itself would block React render.',
  )
  // Direct: `await getMcpToolsCommandsAndResources(...)`.
  assert.doesNotMatch(
    src,
    /await\s+getMcpToolsCommandsAndResources\b/,
    'useManageMCPConnections must never await getMcpToolsCommandsAndResources',
  )
  // Wrapper: `await Promise.race([getMcpToolsCommandsAndResources(...), ...])`.
  assert.doesNotMatch(
    src,
    /await\s+Promise\.(race|all|allSettled|any)\s*\([^)]*getMcpToolsCommandsAndResources/,
    'useManageMCPConnections must never wrap getMcpToolsCommandsAndResources ' +
      'in a Promise combinator and await — same effect as awaiting directly',
  )
  // Note on regex tightness: there is one shape this guard does NOT catch —
  // `const p = getMcpToolsCommandsAndResources(...).catch(...); await p`.
  // Detecting that requires AST-level dataflow analysis. It is unlikely
  // because there is no reason to bind an MCP promise just to await it
  // (the .catch is for unhandledRejection suppression, not result use).
  // If a future engineer goes out of their way to bind+await, the
  // architectural comment at main.tsx ~line 2442 should give pause.
})

test('main.tsx documents the non-blocking invariant', () => {
  // The architectural claim "MCP never blocks REPL render OR turn 1 TTFT"
  // is the source of truth. Locking the comment text means a future
  // refactor that drops this comment will trip the test, forcing the
  // author to either preserve the invariant or update the test
  // intentionally. Cheap insurance against drift.
  const src = readFileSync(mainTsxPath, 'utf8')
  assert.match(
    src,
    /MCP never blocks REPL render OR turn 1 TTFT/,
    'the invariant comment in main.tsx is the documentation that must be ' +
      'preserved alongside any change to the MCP startup sequence',
  )
})
