import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diagnosticFileLabel } from '../src/services/diagnosticFileLabel.mjs'

// The old model-facing renderer: file.uri.split('/').pop() || file.uri
const oldBasename = uri => uri.split('/').pop() || uri

test('same-basename files in different dirs get DISTINCT labels (the fix)', () => {
  const cwd = '/repo'
  const a = diagnosticFileLabel('file:///repo/src/components/Modal.tsx', cwd)
  const b = diagnosticFileLabel('file:///repo/src/legacy/Modal.tsx', cwd)
  assert.equal(a, 'src/components/Modal.tsx')
  assert.equal(b, 'src/legacy/Modal.tsx')
  assert.notEqual(a, b)
  // the old renderer collapsed both to the same ambiguous basename
  assert.equal(oldBasename('file:///repo/src/components/Modal.tsx'), 'Modal.tsx')
  assert.equal(oldBasename('file:///repo/src/legacy/Modal.tsx'), 'Modal.tsx')
})

test('a file:// URI is converted to a cwd-relative path', () => {
  assert.equal(diagnosticFileLabel('file:///repo/src/a.ts', '/repo'), 'src/a.ts')
})

test('an already-absolute OS path (passive path) is made cwd-relative', () => {
  assert.equal(diagnosticFileLabel('/repo/src/lib/util.ts', '/repo'), 'src/lib/util.ts')
})

test('percent-encoding is decoded (model sees the real on-disk name, not %20)', () => {
  const label = diagnosticFileLabel('file:///repo/src/My%20Component.tsx', '/repo')
  assert.equal(label, 'src/My Component.tsx')
  assert.ok(!label.includes('%20'))
})

test('the _claude_fs_right: scheme is stripped before going relative', () => {
  assert.equal(diagnosticFileLabel('_claude_fs_right:/repo/src/x.ts', '/repo'), 'src/x.ts')
})

test('a file outside cwd yields an informative ../-relative path', () => {
  const label = diagnosticFileLabel('file:///other/pkg/y.ts', '/repo')
  assert.ok(label.startsWith('../'), label)
  assert.ok(label.endsWith('pkg/y.ts'))
})

test('a malformed / UNC file URI does not throw, and a non-absolute fallback is kept verbatim (no garbage ../process.cwd rooting)', () => {
  let label
  assert.doesNotThrow(() => {
    // fileURLToPath rejects a host-bearing (UNC) file URL → strip-scheme fallback
    label = diagnosticFileLabel('file://server/share/app.ts', '/repo')
  })
  // kept raw (non-absolute), NOT relativized against process.cwd()
  assert.equal(label, 'server/share/app.ts')
  assert.ok(!label.startsWith('../'))
})

test('an unknown / non-absolute scheme is kept verbatim rather than mis-rooted', () => {
  // not file:// or _claude_fs_right: → uriToLocalPath returns it as-is; non-absolute
  // → kept verbatim instead of relative() resolving it against the real process.cwd()
  const label = diagnosticFileLabel('untitled:Untitled-1', '/repo')
  assert.equal(label, 'untitled:Untitled-1')
})

test('the file === cwd edge keeps the path rather than an empty label', () => {
  assert.equal(diagnosticFileLabel('file:///repo', '/repo'), '/repo')
})
