import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reconcileEditsToContents } from '../src/hooks/reconcilePatchEdits.mjs'
// The real applyEditToFile leaf (was a local port here, a drift hazard).
import { applyEditToFile } from '../src/tools/FileEditTool/applyEditToFile.mjs'

// Faithful port of the (original, marker-unaware) getEditsForPatch.
function getEditsForPatch(hunks) {
  return hunks.map(hunk => {
    const oldLines = []
    const newLines = []
    for (const line of hunk.lines) {
      if (line.startsWith(' ')) {
        oldLines.push(line.slice(1))
        newLines.push(line.slice(1))
      } else if (line.startsWith('-')) {
        oldLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        newLines.push(line.slice(1))
      }
    }
    return {
      old_string: oldLines.join('\n'),
      new_string: newLines.join('\n'),
      replace_all: false,
    }
  })
}

// Mirror the IDE accept path: applyChanges consumes edits[0]; editMode is always
// 'single' so there's exactly one edit.
function applyResult(old, edits) {
  const e = edits[0]
  if (!e) return old
  return e.old_string === ''
    ? e.new_string
    : applyEditToFile(old, e.old_string, e.new_string, e.replace_all)
}

const wholeFile = (o, n) => [{ old_string: o, new_string: n, replace_all: false }]

// Hunk-line arrays are REAL structuredPatch(...,{context:100000}) output.
const cases = [
  {
    name: 'newline-only change (was a silent no-op)',
    o: 'a\nb\nc',
    n: 'a\nb\nc\n',
    lines: [' a', ' b', '-c', '\\ No newline at end of file', '+c'],
    fallback: true,
  },
  {
    name: 'asymmetric context-line newline (the regression repro)',
    o: 'a\na',
    n: 'c\na\nb',
    lines: ['+c', ' a', '\\ No newline at end of file', '-a', '+b', '\\ No newline at end of file'],
    fallback: true,
  },
  {
    name: 'content change that also adds the trailing newline (was: newline dropped)',
    o: 'a\nb\nc',
    n: 'a\nB\nc\n',
    lines: [' a', '-b', '-c', '\\ No newline at end of file', '+B', '+c'],
    fallback: true,
  },
  {
    name: 'common mid-file change keeps its minimal edit (no fallback)',
    o: 'a\nb\nc\n',
    n: 'a\nB\nc\n',
    lines: [' a', '-b', '+B', ' c'],
    fallback: false,
  },
  {
    name: 'delete whole file (faithful, no fallback)',
    o: 'a\nb\n',
    n: '',
    lines: ['-a', '-b', '\\ No newline at end of file'],
    fallback: false,
  },
]

for (const c of cases) {
  test(`reconcile end-to-end: ${c.name}`, () => {
    const edits = reconcileEditsToContents(
      getEditsForPatch([{ lines: c.lines }]),
      c.o,
      c.n,
      applyEditToFile,
    )
    // Core contract: the reconciled edit ALWAYS reproduces the new content.
    assert.equal(applyResult(c.o, edits), c.n, 'reconciled edit must reproduce new content')
    if (c.fallback) {
      assert.deepEqual(edits, wholeFile(c.o, c.n), 'should fall back to a whole-file edit')
    } else {
      assert.notDeepEqual(edits, wholeFile(c.o, c.n), 'should keep the minimal patch edit')
    }
  })
}

test('reconcile: a reconstructed no-op (old===new) with changed content falls back', () => {
  const edits = reconcileEditsToContents(
    [{ old_string: 'x', new_string: 'x', replace_all: false }],
    'x',
    'y',
    applyEditToFile,
  )
  assert.deepEqual(edits, wholeFile('x', 'y'))
})

test('reconcile: a faithful edit is returned unchanged', () => {
  const edits = [{ old_string: 'a', new_string: 'b', replace_all: false }]
  const out = reconcileEditsToContents(edits, 'a', 'b', applyEditToFile)
  assert.equal(out, edits)
})

test('reconcile: an edit that applies but produces the wrong content falls back', () => {
  // old_string matches and changes the file, but to the wrong result.
  const edits = [{ old_string: 'a', new_string: 'WRONG', replace_all: false }]
  const out = reconcileEditsToContents(edits, 'a', 'b', applyEditToFile)
  assert.deepEqual(out, wholeFile('a', 'b'))
  assert.equal(applyResult('a', out), 'b')
})
