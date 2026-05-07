import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read the unmount cleanup section out of ink.tsx as plain text.
 * Returns the slice from `if (this.options.stdout.isTTY) {` through
 * its matching close brace, with line numbers stripped. Used by the
 * order-sensitive assertions below.
 */
function readUnmountCleanup() {
  const source = readFileSync(
    resolve(packageRoot, 'src/ink/ink.tsx'),
    'utf8',
  )
  const startIdx = source.indexOf('if (this.options.stdout.isTTY) {')
  assert.ok(
    startIdx >= 0,
    'unmount cleanup block not found — did the structure change?',
  )
  // Find the next standalone `    }` indented at 4 spaces, which is the
  // close of the if block. The cleanup block is ~30 lines so this is
  // sufficient even if intermediate `}` exist (writeSync calls etc).
  let depth = 1
  let i = source.indexOf('{', startIdx) + 1
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  return source.slice(startIdx, i)
}

test('unmount cleanup writes DBP BEFORE drainStdin', () => {
  // Regression guard for the user-reported bug: large paste followed
  // by Ctrl+C left bracketed-paste markers on the shell prompt. Root
  // cause was the old order (drain → DBP) leaving the terminal in
  // bracketed-paste mode while we drained, so markers emitted during
  // the drain itself went to the shell. The fix is DBP first so the
  // terminal stops emitting markers, then drain residue.
  const cleanup = readUnmountCleanup()
  const dbpIdx = cleanup.indexOf('writeSync(1, DBP)')
  const drainIdx = cleanup.indexOf('this.drainStdin()')
  assert.ok(dbpIdx >= 0, 'unmount cleanup must call writeSync(1, DBP)')
  assert.ok(drainIdx >= 0, 'unmount cleanup must call this.drainStdin()')
  assert.ok(
    dbpIdx < drainIdx,
    `DBP (idx ${dbpIdx}) must precede drainStdin (idx ${drainIdx}) — ` +
      `regression of bracketed-paste leak on exit`,
  )
})

test('unmount cleanup writes DISABLE_MOUSE_TRACKING BEFORE drainStdin', () => {
  // Same parity as DBP: drain catches tail-end mouse events the same
  // way it catches paste markers. If a future refactor splits these
  // into separate orderings, the drain may run before mouse tracking
  // is off and leak XTERM_MOUSE_REPORT bytes.
  const cleanup = readUnmountCleanup()
  const dmtIdx = cleanup.indexOf('writeSync(1, DISABLE_MOUSE_TRACKING)')
  const drainIdx = cleanup.indexOf('this.drainStdin()')
  assert.ok(dmtIdx >= 0)
  assert.ok(dmtIdx < drainIdx, 'DISABLE_MOUSE_TRACKING must precede drainStdin')
})

test('unmount cleanup writes DFE (focus events) BEFORE drainStdin', () => {
  // DECSET 1004 emits unsolicited `\x1b[I` / `\x1b[O` on focus
  // changes — same drain-ordering requirement as DBP and DMT.
  const cleanup = readUnmountCleanup()
  const dfeIdx = cleanup.indexOf('writeSync(1, DFE)')
  const drainIdx = cleanup.indexOf('this.drainStdin()')
  assert.ok(dfeIdx >= 0)
  assert.ok(dfeIdx < drainIdx, 'DFE must precede drainStdin')
})

test('extended-key reporting is disabled AFTER first drain (no ordering need)', () => {
  // Modify-other-keys / kitty keyboard don't EMIT bytes — they only
  // modify how key events are encoded. So they can disable any time
  // without drain ordering. This test pins the rationale so a future
  // refactor that "tidies" the order doesn't add unnecessary drains.
  const cleanup = readUnmountCleanup()
  const modIdx = cleanup.indexOf('writeSync(1, DISABLE_MODIFY_OTHER_KEYS)')
  const kittyIdx = cleanup.indexOf('writeSync(1, DISABLE_KITTY_KEYBOARD)')
  const firstDrainIdx = cleanup.indexOf('this.drainStdin()')
  assert.ok(modIdx >= 0)
  assert.ok(kittyIdx >= 0)
  assert.ok(
    modIdx > firstDrainIdx && kittyIdx > firstDrainIdx,
    'modify-other-keys / kitty disable should come AFTER first drain (no input-emitting effect)',
  )
})

test('unmount cleanup runs drainStdin TWICE — once before, once after React teardown', () => {
  // Codex flagged: terminal application of DBP/DMT/DFE has round-trip
  // latency. Bytes can arrive in the few μs between the first drain
  // and the terminal actually switching modes off. AND
  // updateContainerSync(null) later fires React teardown effects
  // (e.g. <AlternateScreen>'s cleanup writes DISABLE_MOUSE_TRACKING +
  // EXIT_ALT_SCREEN), which can themselves trigger more input bursts.
  // The fix is TWO drains: one inside the synchronous mode-reset
  // block, and one AFTER updateContainerSync.
  const source = readFileSync(
    resolve(packageRoot, 'src/ink/ink.tsx'),
    'utf8',
  )
  const unmountStart = source.indexOf('unmount(error?: Error | number | null)')
  assert.ok(unmountStart >= 0, 'unmount() definition not found')
  // Bracket-balance to find the close of unmount.
  let depth = 0
  let i = source.indexOf('{', unmountStart)
  const fnStart = i + 1
  do {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  } while (i < source.length && depth > 0)
  const fnBody = source.slice(fnStart, i)

  // Locate the two drains and updateContainerSync.
  const drainOffsets = []
  let m
  const drainRe = /this\.drainStdin\(\)/g
  while ((m = drainRe.exec(fnBody)) !== null) {
    drainOffsets.push(m.index)
  }
  const containerSyncIdx = fnBody.indexOf('updateContainerSync(null')
  const flushSyncIdx = fnBody.indexOf('flushSyncWork()')
  assert.ok(
    containerSyncIdx >= 0,
    'unmount must call updateContainerSync(null) for React teardown',
  )
  assert.ok(
    flushSyncIdx >= 0,
    'unmount must call flushSyncWork() to drain pending React work',
  )
  assert.equal(
    drainOffsets.length,
    2,
    `unmount must call drainStdin() exactly twice, got ${drainOffsets.length}`,
  )
  assert.ok(
    drainOffsets[0] < containerSyncIdx,
    'first drainStdin() must come BEFORE updateContainerSync (catches in-flight input bytes)',
  )
  // The teardown guarantee depends on React work having actually
  // FLUSHED, not just scheduled. flushSyncWork() runs immediately
  // after updateContainerSync; the final drain must be AFTER both,
  // otherwise effects fired during flush could leak input bytes past
  // our last drain.
  assert.ok(
    drainOffsets[1] > flushSyncIdx,
    'second drainStdin() must come AFTER flushSyncWork() so all React teardown effects have flushed before the drain',
  )
})

test('App.componentWillUnmount cancels the deferred XTVERSION probe', () => {
  // Codex flagged: setImmediate(() => querier.send(xtversion()))
  // could fire AFTER ink.tsx's final input drain, writing xtversion()
  // to the TTY and triggering terminal response bytes on stdin
  // post-teardown — re-introducing the leak path A4 is meant to
  // close. We need a clearImmediate handle stored AND cleared on
  // unmount.
  const appSource = readFileSync(
    resolve(packageRoot, 'src/ink/components/App.tsx'),
    'utf8',
  )
  assert.match(
    appSource,
    /xtversionImmediate[\s\S]{0,80}setImmediate/,
    'XTVERSION setImmediate handle must be stored on the instance',
  )
  // Match the actual method definition, not the comment. The class
  // method is `override componentWillUnmount()` and the body must
  // contain a clearImmediate call within ~600 chars (header comment
  // + a few prior cleanup branches).
  assert.match(
    appSource,
    /override componentWillUnmount\(\)[\s\S]{0,800}clearImmediate\(this\.xtversionImmediate\)/,
    'componentWillUnmount method body must clearImmediate the stored handle',
  )
})

test('drainStdin kernel cap is at least 1024 reads (covers >64KB pastes)', () => {
  // The pre-A4 cap of 64 reads (64KB) was too small for real-world
  // paste workloads. Bumping to 1024 (1MB) keeps the safety net for
  // terminals that ignore O_NONBLOCK while letting normal large
  // pastes drain fully.
  const source = readFileSync(
    resolve(packageRoot, 'src/ink/ink.tsx'),
    'utf8',
  )
  const drainFn = source.slice(source.indexOf('export function drainStdin'))
  assert.match(
    drainFn,
    /for \(let i = 0; i < (1024|2048|4096); i\+\+\)/,
    'drainStdin kernel-buffer loop must cap at >=1024 iterations',
  )
})
