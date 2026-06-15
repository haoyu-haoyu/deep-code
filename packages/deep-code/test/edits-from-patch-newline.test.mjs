import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getEditsForPatch } from '../src/tools/FileEditTool/editsFromPatch.mjs'

// The hunk-line arrays below are REAL `structuredPatch(...).hunks[i].lines` output
// captured from the installed `diff` library (the same one src/utils/diff.ts uses)
// for each (old, new) file pair — including the `\ No newline at end of file`
// marker. We hard-code them so the test needs no diff import (the lib is vendored/
// undeclared and not node-resolvable on CI). Each case asserts the reconstructed
// edits AND that applying them to the old file yields the new file.

// Apply edits the way the IDE-diff path does (sequential single-occurrence
// replace; replace_all is always false here).
function applyEdits(file, edits) {
  let out = file
  for (const e of edits) {
    out = out.replace(e.old_string, () => e.new_string)
  }
  return out
}

const cases = [
  {
    name: 'add trailing newline (the bug: was a no-op)',
    old: 'a\nb\nc',
    new: 'a\nb\nc\n',
    lines: [' a', ' b', '-c', '\\ No newline at end of file', '+c'],
  },
  {
    name: 'remove trailing newline (the bug: was a no-op)',
    old: 'a\nb\nc\n',
    new: 'a\nb\nc',
    lines: [' a', ' b', '-c', '+c', '\\ No newline at end of file'],
  },
  {
    name: 'content change, both keep trailing newline',
    old: 'a\nb\nc\n',
    new: 'a\nB\nc\n',
    lines: [' a', '-b', '+B', ' c'],
  },
  {
    name: 'content change, neither has trailing newline',
    old: 'a\nb\nc',
    new: 'a\nB\nc',
    lines: [' a', '-b', '+B', ' c', '\\ No newline at end of file'],
  },
  {
    name: 'content change that also ADDS the trailing newline (was: newline dropped)',
    old: 'a\nb\nc',
    new: 'a\nB\nc\n',
    lines: [' a', '-b', '-c', '\\ No newline at end of file', '+B', '+c'],
  },
  {
    name: 'both sides no trailing newline, last line changed',
    old: 'x\ny',
    new: 'x\nZ',
    lines: [' x', '-y', '\\ No newline at end of file', '+Z', '\\ No newline at end of file'],
  },
  {
    name: 'last-line change, both keep trailing newline',
    old: 'a\nb\nc\n',
    new: 'a\nb\nC\n',
    lines: [' a', ' b', '-c', '+C'],
  },
  {
    name: 'empty file to one line without trailing newline',
    old: '',
    new: 'a',
    lines: ['+a', '\\ No newline at end of file'],
  },
  {
    name: 'two hunks, file keeps trailing newline',
    old: 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21\nL22\nL23\nL24\nL25\nL26\nL27\nL28\nL29\nL30\n',
    new: 'L1\nCHANGED2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21\nL22\nL23\nL24\nL25\nL26\nL27\nCHANGED28\nL29\nL30\n',
    hunks: [
      [' L1', '-L2', '+CHANGED2', ' L3', ' L4', ' L5'],
      [' L25', ' L26', ' L27', '-L28', '+CHANGED28', ' L29', ' L30'],
    ],
  },
  {
    name: 'two hunks, file has NO trailing newline (marker on the final hunk only)',
    old: 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21\nL22\nL23\nL24\nL25\nL26\nL27\nL28\nL29\nL30',
    new: 'L1\nCHANGED2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21\nL22\nL23\nL24\nL25\nL26\nL27\nCHANGED28\nL29\nL30',
    hunks: [
      [' L1', '-L2', '+CHANGED2', ' L3', ' L4', ' L5'],
      [' L25', ' L26', ' L27', '-L28', '+CHANGED28', ' L29', ' L30', '\\ No newline at end of file'],
    ],
  },
]

for (const c of cases) {
  test(`getEditsForPatch: ${c.name}`, () => {
    const patch = c.hunks
      ? c.hunks.map(lines => ({ lines }))
      : [{ lines: c.lines }]
    const edits = getEditsForPatch(patch)

    // For a single-hunk case, the change must NOT be a no-op when old !== new.
    if (!c.hunks) {
      const e = edits[0]
      if (c.old !== c.new) {
        assert.notEqual(
          e.old_string,
          e.new_string,
          'a real change must not collapse to old_string === new_string',
        )
      }
    }

    // Round-trip: applying the reconstructed edits to the old file yields new.
    assert.equal(applyEdits(c.old, edits), c.new, 'edits must reconstruct the new file')
  })
}
