import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { shouldResetCompletedTaskList } from '../src/utils/task/resetCompletedGuard.mjs'
import { nextHighWaterMark } from '../src/utils/task/highWaterMark.mjs'
import { atomicWriteFile } from '../src/utils/atomicWrite.mjs'

// ---------------------------------------------------------------------------
// (MED) hide-timer-reset TOCTOU: the all-completed guard the destructive wipe
// depends on. The wipe is now gated on this predicate re-evaluated UNDER the
// list lock, so a task created in the race window blocks the reset.
// ---------------------------------------------------------------------------

test('shouldResetCompletedTaskList: empty list never resets (the length>0 gate)', () => {
  assert.equal(shouldResetCompletedTaskList([]), false)
})

test('shouldResetCompletedTaskList: all-completed → reset (the happy path, unchanged)', () => {
  assert.equal(shouldResetCompletedTaskList([{ status: 'completed' }]), true)
  assert.equal(
    shouldResetCompletedTaskList([
      { status: 'completed' },
      { status: 'completed' },
    ]),
    true,
  )
})

test('shouldResetCompletedTaskList: ANY non-completed task aborts the reset (THE BUG)', () => {
  // The raced new `pending` task is exactly this case — it must block the wipe.
  assert.equal(
    shouldResetCompletedTaskList([
      { status: 'completed' },
      { status: 'pending' },
    ]),
    false,
  )
  assert.equal(
    shouldResetCompletedTaskList([
      { status: 'completed' },
      { status: 'in_progress' },
    ]),
    false,
  )
  assert.equal(shouldResetCompletedTaskList([{ status: 'pending' }]), false)
  assert.equal(shouldResetCompletedTaskList([{ status: 'in_progress' }]), false)
})

test('shouldResetCompletedTaskList fuzz: === (len>0 && every completed) for any status vector', () => {
  let s = 0x1f2e3d4c >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  const statuses = ['pending', 'in_progress', 'completed']
  for (let iter = 0; iter < 10000; iter++) {
    const n = (rnd() * 20) | 0
    const tasks = []
    for (let k = 0; k < n; k++) {
      tasks.push({ status: statuses[(rnd() * statuses.length) | 0] })
    }
    const expected = tasks.length > 0 && tasks.every(t => t.status === 'completed')
    assert.equal(shouldResetCompletedTaskList(tasks), expected, `iter ${iter}`)
  }
})

// ---------------------------------------------------------------------------
// (LOW) non-atomic task write → torn read: createTask/updateTaskUnsafe/
// writeHighWaterMark now use atomicWriteFile. listTasks/getTask read WITHOUT a
// lock and jsonParse THROWS on a partial file (→ getTask returns null → the task
// transiently vanishes). rename is atomic, so a reader always sees a complete
// file. Differential: an in-place writeFile DOES produce torn reads; the atomic
// writer produces ZERO.
// ---------------------------------------------------------------------------

// A representative Task JSON blob, padded so the in-place write spans multiple
// write() syscalls (so a concurrent reader reliably catches a partial file).
function taskBlob(i) {
  return JSON.stringify({
    id: String(i),
    status: 'pending',
    subject: 'demo task ' + i,
    description: 'x'.repeat(300_000),
    blockedBy: [],
  })
}

async function countTornReads(writer, dir, rounds) {
  const path = join(dir, 'torn-read-probe.json')
  await writer(path, taskBlob(0)) // seed a complete file
  let tornReads = 0
  for (let i = 1; i <= rounds; i++) {
    // Interleave a write with several concurrent reads of the same file.
    const ops = [writer(path, taskBlob(i))]
    for (let r = 0; r < 4; r++) {
      ops.push(
        readFile(path, 'utf-8').then(
          content => {
            try {
              JSON.parse(content)
            } catch {
              tornReads++ // a partial/torn file: JSON.parse threw (getTask → null)
            }
          },
          () => {}, // ENOENT mid-rename on some platforms is not a torn READ
        ),
      )
    }
    await Promise.all(ops)
  }
  return tornReads
}

test('atomicWriteFile eliminates the torn read that an in-place writeFile produces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-tasks-torn-'))
  try {
    // Baseline: the OLD in-place write produces torn reads under concurrency.
    const baseline = await countTornReads(
      (p, d) => writeFile(p, d),
      dir,
      60,
    )
    // The FIX: atomic tmp+rename — a reader never observes a partial file.
    const atomic = await countTornReads(atomicWriteFile, dir, 60)

    assert.equal(atomic, 0, 'atomicWriteFile must never expose a torn read')
    assert.ok(
      baseline > 0,
      `in-place writeFile should produce torn reads (got ${baseline}); ` +
        'if 0, the probe under-exercised the race',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('atomicWriteFile leaves no .tmp survivors in the task dir', async () => {
  const { readdir } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-tasks-tmp-'))
  try {
    for (let i = 0; i < 12; i++) {
      await atomicWriteFile(join(dir, `${randomUUID()}.json`), taskBlob(i))
    }
    const entries = await readdir(dir)
    assert.ok(
      entries.every(f => f.endsWith('.json')),
      `unexpected non-.json survivor: ${entries.filter(f => !f.endsWith('.json')).join(',')}`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// (MED) task ID reuse: the .highwatermark is the sole id-reuse guard after a
// file is unlinked. It must be MONOTONIC — never lowered below an already-issued
// id. nextHighWaterMark is the SSOT decision both writers (deleteTask retiring
// an id, resetTaskList recording the highest id) route through; bumping it under
// the list lock makes the read-modify-write atomic so a stale snapshot can't
// clobber a higher mark back down (→ silent id reuse colliding with a live ref).
// ---------------------------------------------------------------------------

test('nextHighWaterMark: monotonic-max, never lowers the mark', () => {
  assert.equal(nextHighWaterMark(0, 3), 3) // raise from nothing
  assert.equal(nextHighWaterMark(5, 9), 9) // raise
  // THE BUG class: a lower candidate must NOT lower the HWM.
  assert.equal(nextHighWaterMark(9, 3), null)
  assert.equal(nextHighWaterMark(3, 3), null) // equal → no write
  assert.equal(nextHighWaterMark(0, 0), null)
  // non-integer / NaN / negative candidates never write
  assert.equal(nextHighWaterMark(2, Number.NaN), null)
  assert.equal(nextHighWaterMark(2, 2.5), null)
  assert.equal(nextHighWaterMark(2, -1), null)
})

test('nextHighWaterMark fuzz: the result never decreases the mark, for any candidate', () => {
  let s = 0x3c9a7b15 >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  for (let iter = 0; iter < 50000; iter++) {
    const current = (rnd() * 1000) | 0
    // mix integers, floats, negatives, NaN
    const pick = rnd()
    const candidate =
      pick < 0.7 ? (rnd() * 1000) | 0 : pick < 0.85 ? rnd() * 1000 : pick < 0.95 ? -((rnd() * 1000) | 0) : Number.NaN
    const next = nextHighWaterMark(current, candidate)
    const written = next ?? current
    assert.ok(written >= current, `iter ${iter}: HWM decreased ${current}→${written}`)
    if (Number.isInteger(candidate) && candidate > current) {
      assert.equal(next, candidate, `iter ${iter}: should raise to ${candidate}`)
    } else {
      assert.equal(next, null, `iter ${iter}: should not write for ${candidate}`)
    }
  }
})

test('DIFFERENTIAL: only a LOCKED read-modify-write keeps the HWM monotonic (the leaf alone is insufficient)', async () => {
  // Model deleteTask('3') racing resetTaskList over the shared .highwatermark.
  // Both retire/record an id via nextHighWaterMark; the only difference is whether
  // the read-then-write is serialized under a lock. Gate-stepped for determinism.
  async function run({ locked }) {
    const store = { hwm: 0 }
    const highestFileId = 9 // resetTaskList sees the highest existing id
    const deletedId = 3 // deleteTask retires a lower id from a stale snapshot

    // FIFO async mutex
    let tail = Promise.resolve()
    const lock = () => {
      let release
      const acquired = tail.then(() => {})
      tail = new Promise(r => (release = r))
      return acquired.then(() => release)
    }

    let resolveBDone
    const bDone = new Promise(r => (resolveBDone = r))

    // A = deleteTask's HWM bump
    const a = async () => {
      const rel = locked ? await lock() : null
      const cur = store.hwm // READ
      if (!locked) await bDone // unlocked: B's full RMW interleaves between read & write
      const next = nextHighWaterMark(cur, deletedId)
      if (next !== null) store.hwm = next // WRITE
      if (rel) rel()
    }
    // B = resetTaskList's HWM bump (records the highest existing id)
    const b = async () => {
      const rel = locked ? await lock() : null
      const cur = store.hwm
      const next = nextHighWaterMark(cur, highestFileId)
      if (next !== null) store.hwm = next
      if (rel) rel()
      resolveBDone()
    }

    const pa = a() // starts, reads hwm, then (unlocked) suspends on bDone
    const pb = b() // runs fully, resolves bDone
    await Promise.all([pa, pb])
    return store.hwm
  }

  // THE BUG: A's stale snapshot (read 0) clobbers B's freshly-written 9 down to 3.
  assert.equal(await run({ locked: false }), 3)
  // THE FIX: serialized read-modify-write → the bump is monotonic, 9 survives.
  assert.equal(await run({ locked: true }), 9)
})
