import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ensureLeadingBom, stripLeadingBom } from '../src/utils/bom.mjs'

const BOM = '\uFEFF'

// --- stripLeadingBom -------------------------------------------------------

test('stripLeadingBom removes exactly one leading BOM', () => {
  assert.equal(stripLeadingBom(BOM + 'hello'), 'hello')
  assert.equal(stripLeadingBom('hello'), 'hello')
  // Only ONE: a second BOM is real content and must survive.
  assert.equal(stripLeadingBom(BOM + BOM + 'x'), BOM + 'x')
})

test('stripLeadingBom is safe on the empty string and a bare BOM', () => {
  assert.equal(stripLeadingBom(''), '')
  assert.equal(stripLeadingBom(BOM), '')
})

test('stripLeadingBom ignores a BOM that is not at the start', () => {
  assert.equal(stripLeadingBom('a' + BOM + 'b'), 'a' + BOM + 'b')
})

test('stripLeadingBom is idempotent', () => {
  const once = stripLeadingBom(BOM + 'data')
  assert.equal(stripLeadingBom(once), once)
})

// --- ensureLeadingBom ------------------------------------------------------

test('ensureLeadingBom prepends a BOM only when absent', () => {
  assert.equal(ensureLeadingBom('hello'), BOM + 'hello')
  // Idempotent: already-prefixed content is returned unchanged (no double BOM).
  assert.equal(ensureLeadingBom(BOM + 'hello'), BOM + 'hello')
})

test('ensureLeadingBom leaves the empty string empty (no 2-byte BOM-only file)', () => {
  assert.equal(ensureLeadingBom(''), '')
})

test('strip/ensure round-trip: ensure then strip yields the stripped original', () => {
  for (const s of ['plain', BOM + 'withbom', '', BOM, 'a' + BOM]) {
    const ensured = ensureLeadingBom(s)
    assert.equal(stripLeadingBom(ensured), stripLeadingBom(s))
  }
})

// --- bug #1: staleness comparison normalization ----------------------------

test('staleness comparison: a BOM-kept whole-file read equals a BOM-stripped range read', () => {
  // FileReadTool populates readFileState via the range reader (BOM stripped);
  // FileEditTool/FileWriteTool re-read via readFileSyncWithMetadata /
  // readFileBytes.toString (BOM kept). For an UNMODIFIED file the two strings
  // differ only by the leading BOM, so the raw === check fails (false
  // FILE_UNEXPECTEDLY_MODIFIED) but the normalized check must pass.
  const onDisk = 'line1\nline2\n'
  const wholeFileRead = BOM + onDisk // readFileSyncWithMetadata keeps the BOM
  const rangeRead = onDisk // readFileInRange stripped it
  assert.notEqual(wholeFileRead, rangeRead) // the bug: raw compare disagrees
  assert.equal(stripLeadingBom(wholeFileRead), stripLeadingBom(rangeRead)) // fixed
})

// --- getChangedFiles phantom diff: the diff must stripLeadingBom BOTH sides -----

test('getChangedFiles: a BOM file edit + a fresh range read must be BOM-normalized before diffing', () => {
  // bug #1 covers the staleness === checks. getChangedFiles is the OTHER consumer
  // of readFileState.content: it line-DIFFs the stored content against a fresh
  // FileReadTool read (range reader → BOM stripped) via a BOM-naive structuredPatch.
  // readFileState entries written by a whole-file read — FileEdit's `updatedFile`
  // and the BashTool sed path's `newContent` — KEEP the BOM, so for an UNTOUCHED
  // BOM file (mtime bumped by a bare external touch) the diff showed a phantom
  // line-1 change and injected a bogus edited_text_file attachment. The fix mirrors
  // the staleness checks: stripLeadingBom BOTH sides at the getChangedFiles diff.
  const onDisk = 'line1\nline2\n'
  const storedAfterEdit = BOM + onDisk // a whole-file-read store (BOM kept)
  const freshRangeRead = onDisk // getChangedFiles' re-read (BOM stripped)

  // Raw, the two differ only by the BOM → line 1 mismatches → structuredPatch
  // produces a (phantom) hunk.
  assert.notEqual(storedAfterEdit, freshRangeRead)
  assert.notEqual(storedAfterEdit.split('\n')[0], freshRangeRead.split('\n')[0])

  // Stripping BOTH sides (as the fix does) makes them byte-identical → no hunks →
  // no phantom attachment (the empty-snippet suppression now correctly fires). This
  // closes the bug for EVERY whole-file-read writer in one consumer-side place.
  assert.equal(stripLeadingBom(storedAfterEdit), stripLeadingBom(freshRangeRead))
})

// --- bug #3: UTF-16LE write keeps its detectable BOM -----------------------

// Mirror the encoding auto-detection in src/utils/fileRead.ts.
function detectEncoding(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf16le'
  }
  return 'utf8'
}

test('UTF-16LE write without the BOM is mis-detected as UTF-8 on the next read (the bug)', () => {
  // Model-supplied full-replacement content carries no BOM. The OLD write path
  // encoded it as utf16le directly; Node's utf16le encoder emits no BOM bytes.
  const content = 'héllo' // non-ASCII so a utf8 mis-decode is visibly corrupt
  const written = Buffer.from(content, 'utf16le')
  assert.equal(detectEncoding(written), 'utf8') // FF FE absent -> wrong encoding
  const reread = written.toString('utf8')
  assert.notEqual(reread, content) // interleaved-null garbage
})

test('UTF-16LE write WITH ensureLeadingBom round-trips correctly (the fix)', () => {
  const content = 'héllo'
  const written = Buffer.from(ensureLeadingBom(content), 'utf16le')
  // The BOM bytes FF FE are present, so detection picks utf16le again.
  assert.equal(written[0], 0xff)
  assert.equal(written[1], 0xfe)
  assert.equal(detectEncoding(written), 'utf16le')
  // Decoding with the detected encoding and stripping the BOM (as the readers
  // do) recovers the original content exactly.
  const reread = stripLeadingBom(written.toString('utf16le'))
  assert.equal(reread, content)
})

test('FileEditTool path: content already carrying a BOM is not double-encoded', () => {
  // readFileSyncWithMetadata keeps the BOM, so an edited file's content already
  // begins with U+FEFF; ensureLeadingBom must be a no-op there (no double BOM).
  const editedContent = BOM + 'edited'
  const written = Buffer.from(ensureLeadingBom(editedContent), 'utf16le')
  assert.equal(written[0], 0xff)
  assert.equal(written[1], 0xfe)
  // Exactly one BOM: bytes 2-3 must be the first real char, not a second FF FE.
  assert.notDeepEqual([written[2], written[3]], [0xff, 0xfe])
  assert.equal(stripLeadingBom(written.toString('utf16le')), 'edited')
})

test('notebook parse path: a BOM-prefixed .ipynb is unreadable raw but parses after stripLeadingBom', () => {
  // readNotebook (buffer.toString('utf-8')) and NotebookEditTool.call
  // (readFileSyncWithMetadata) keep a leading BOM, and raw JSON.parse throws on
  // it ("Unexpected token") — so a PowerShell-written UTF-8-BOM notebook was
  // unreadable and reported "not valid JSON". The parse sites now wrap the
  // content in stripLeadingBom; verify that composition (jsonParse === JSON.parse
  // for the BOM concern).
  const notebook = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }
  const json = JSON.stringify(notebook)
  const bomPrefixed = BOM + json
  assert.throws(() => JSON.parse(bomPrefixed), SyntaxError) // the bug
  assert.deepEqual(JSON.parse(stripLeadingBom(bomPrefixed)), notebook) // the fix
  // A normal (no-BOM) notebook is unaffected (idempotent strip).
  assert.deepEqual(JSON.parse(stripLeadingBom(json)), notebook)
  // A UTF-16LE-decoded notebook (its BOM decodes to the same U+FEFF) also parses.
  const utf16le = Buffer.from(bomPrefixed, 'utf16le').toString('utf16le')
  assert.deepEqual(JSON.parse(stripLeadingBom(utf16le)), notebook)
})
