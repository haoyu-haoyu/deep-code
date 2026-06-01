import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Documentation-regression guard for a KNOWN, deliberately-deferred limitation:
// per-tool `networkMode` is advisory-only — `networkMode: 'deny'` does NOT block
// outbound traffic, because the sandbox-runtime proxy reads its allowlist from
// GLOBAL init config, not per-call customConfig (Sandbox Fortress F2.x). This
// test fails if someone quietly removes the warnings (implying the boundary is
// real) WITHOUT actually wiring the per-call enforcement — which would turn a
// documented no-op into a false security guarantee.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const typesSrc = readFileSync(resolve(packageRoot, 'src/sandbox-fortress/types.ts'), 'utf8')
const profilesSrc = readFileSync(
  resolve(packageRoot, 'src/sandbox-fortress/adapter/per-tool-profiles.ts'),
  'utf8',
)

test('ToolSandboxProfile.networkMode is marked @deprecated / advisory-only in the type', () => {
  // Pull the JSDoc block immediately preceding the networkMode FIELD. Anchor on
  // the field's declaration (`networkMode: 'allow'`) — not a bare "networkMode:"
  // which also appears inside the JSDoc's own example text.
  const idx = typesSrc.indexOf("networkMode: 'allow'")
  assert.ok(idx > 0, 'networkMode field must exist on ToolSandboxProfile')
  const preceding = typesSrc.slice(0, idx)
  const docStart = preceding.lastIndexOf('/**')
  assert.ok(docStart > 0, 'networkMode must carry a JSDoc block')
  // Collapse the JSDoc's line breaks AND its ` * ` line markers so phrases that
  // wrap across lines (e.g. "does\n * NOT block") still match contiguously.
  const doc = preceding.slice(docStart).replace(/[\s*]+/g, ' ')
  assert.match(doc, /@deprecated/, 'networkMode must be flagged @deprecated')
  assert.match(doc, /NOT a security boundary/i)
  assert.match(doc, /does NOT block/i)
})

test('per-tool-profiles documents that networkMode is not enforced at the proxy', () => {
  assert.match(profilesSrc, /NOT enforced at the proxy/i, 'file header must state the limitation')
  assert.match(
    profilesSrc,
    /must NOT rely on networkMode for security/i,
    'file header must warn callers off relying on networkMode',
  )
  // The deny branch itself must carry the advisory note (caught at the code site).
  const denyIdx = profilesSrc.indexOf("case 'deny':")
  assert.ok(denyIdx > 0, "the 'deny' branch must exist")
  const denyBranch = profilesSrc.slice(denyIdx, denyIdx + 320)
  assert.match(denyBranch, /ADVISORY ONLY/i, "the 'deny' branch must flag itself as advisory-only")
  assert.match(denyBranch, /does NOT block/i)
})

test('the FileRead/FileEdit profiles still SET networkMode deny (intent preserved for when F2.x lands)', () => {
  // The intent (read/edit tools should not need the network) is still recorded
  // so the eventual Layer-2 interceptor has something to enforce — we deprecate
  // the guarantee, not the declared intent.
  //
  // Match the FIELD ASSIGNMENT form (`networkMode: 'deny',` with a trailing
  // comma), NOT a bare /networkMode: 'deny'/ — the latter also matches the
  // header comment's backtick-wrapped example `networkMode: 'deny'` and would
  // pass vacuously even if both real assignments were deleted. There are two
  // such profiles (FileRead + FileEdit).
  const assignments = profilesSrc.match(/networkMode:\s*'deny',/g) ?? []
  assert.ok(
    assignments.length >= 2,
    `expected >=2 real "networkMode: 'deny'," profile assignments, found ${assignments.length}`,
  )
})
