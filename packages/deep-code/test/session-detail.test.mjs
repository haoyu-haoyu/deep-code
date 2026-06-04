import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { removeSessionHandler } from '../src/cli/handlers/sessionRemove.mjs'
import { showSessionHandler } from '../src/cli/handlers/sessionShow.mjs'
import { getSessionDetail, removeSession } from '../src/utils/sessionDetail.mjs'

const ID = '11111111-1111-4111-8111-111111111111'

async function makeDir() {
  return mkdtemp(join(tmpdir(), 'deepcode-session-detail-'))
}
async function writeSession(dir, id, entries) {
  await writeFile(join(dir, `${id}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}
function capture() {
  const chunks = []
  return { chunks, write: s => (chunks.push(s), true), text: () => chunks.join('') }
}

// ── getSessionDetail ─────────────────────────────────────────────────────────

test('getSessionDetail returns rich metadata for an existing session', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [
      { type: 'user', message: { role: 'user', content: 'first prompt' }, cwd: '/proj', gitBranch: 'main', timestamp: '2026-06-01T00:00:00.000Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'hi' }, timestamp: '2026-06-01T00:00:01.000Z' },
      { type: 'custom-title', customTitle: 'My Title' },
      { type: 'user', message: { role: 'user', content: 'second' }, timestamp: '2026-06-01T00:01:00.000Z' },
    ])
    const d = await getSessionDetail({ sessionId: ID, sessionDir: dir })
    assert.equal(d.exists, true)
    assert.equal(d.sessionId, ID)
    assert.equal(d.turnCount, 2) // two user turns
    assert.equal(d.messageCount, 3) // 2 user + 1 assistant
    assert.equal(d.title, 'My Title') // shares list's title semantics (custom-title wins)
    assert.equal(d.cwd, '/proj')
    assert.equal(d.gitBranch, 'main')
    assert.equal(d.firstTimestamp, '2026-06-01T00:00:00.000Z')
    assert.equal(d.lastTimestamp, '2026-06-01T00:01:00.000Z')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('getSessionDetail reports exists:false for a missing session', async () => {
  const dir = await makeDir()
  try {
    const d = await getSessionDetail({ sessionId: ID, sessionDir: dir })
    assert.equal(d.exists, false)
    assert.equal(d.sessionId, ID)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('getSessionDetail rejects a non-UUID id (path-traversal guard)', async () => {
  await assert.rejects(() => getSessionDetail({ sessionId: '../../etc/passwd', sessionDir: '/tmp' }), /UUID/)
})

test('getSessionDetail treats a symlinked transcript as not-found (matches list, no symlink-follow)', async () => {
  const dir = await makeDir()
  const target = await makeDir()
  try {
    await writeSession(target, ID, [{ type: 'user', message: { role: 'user', content: 'real elsewhere' } }])
    // A planted `<uuid>.jsonl` SYMLINK pointing outside the store: `session list`
    // skips it (dirent.isFile() false), so `show` must too — never follow it.
    await symlink(join(target, `${ID}.jsonl`), join(dir, `${ID}.jsonl`))
    const d = await getSessionDetail({ sessionId: ID, sessionDir: dir })
    assert.equal(d.exists, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})

// ── removeSession ────────────────────────────────────────────────────────────

test('removeSession deletes the transcript and its sub-agent subdir', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [{ type: 'user', message: { role: 'user', content: 'x' } }])
    await mkdir(join(dir, ID, 'subagents'), { recursive: true })
    await writeFile(join(dir, ID, 'subagents', 'a.jsonl'), '{}\n', 'utf8')

    const result = await removeSession({ sessionId: ID, sessionDir: dir })
    assert.equal(result.existed, true)
    assert.equal(existsSync(join(dir, `${ID}.jsonl`)), false)
    assert.equal(existsSync(join(dir, ID)), false) // subdir gone too
    // `removed` accurately tracks BOTH paths.
    assert.equal(result.removed.length, 2)
    assert.ok(result.removed.includes(join(dir, `${ID}.jsonl`)))
    assert.ok(result.removed.includes(join(dir, ID)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeSession reports only the file when there is no sub-agent subdir', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [{ type: 'user', message: { role: 'user', content: 'x' } }])
    const result = await removeSession({ sessionId: ID, sessionDir: dir })
    assert.equal(result.existed, true)
    assert.deepEqual(result.removed, [join(dir, `${ID}.jsonl`)]) // exactly one path
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeSession reports existed:true when only an orphaned sub-agent subdir remains', async () => {
  const dir = await makeDir()
  try {
    // No transcript file, but a leftover <id>/ subagent tree.
    await mkdir(join(dir, ID, 'subagents'), { recursive: true })
    const result = await removeSession({ sessionId: ID, sessionDir: dir })
    assert.equal(result.existed, true) // something WAS removed
    assert.deepEqual(result.removed, [join(dir, ID)])
    assert.equal(existsSync(join(dir, ID)), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeSession on a missing session is idempotent (existed:false, no throw)', async () => {
  const dir = await makeDir()
  try {
    const result = await removeSession({ sessionId: ID, sessionDir: dir })
    assert.equal(result.existed, false)
    assert.deepEqual(result.removed, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeSession rejects a non-UUID id (path-traversal guard)', async () => {
  await assert.rejects(() => removeSession({ sessionId: '../evil', sessionDir: '/tmp' }), /UUID/)
})

// ── handlers ─────────────────────────────────────────────────────────────────

const DETAIL = {
  sessionId: ID,
  path: '/p/x.jsonl',
  exists: true,
  modifiedMs: 1_700_000_000_000,
  turnCount: 4,
  messageCount: 9,
  sidechain: false,
  corrupt: false,
  cwd: '/proj',
  gitBranch: 'main',
  firstTimestamp: '2026-06-01T00:00:00.000Z',
  title: 'My Title',
  summary: undefined,
  firstPrompt: 'first prompt',
  lastTimestamp: '2026-06-01T00:01:00.000Z',
}

test('showSessionHandler --json emits the detail object', async () => {
  const out = capture()
  const returned = await showSessionHandler({ sessionId: ID, json: true, getDetailFn: async () => DETAIL, stdout: out })
  assert.deepEqual(returned, DETAIL)
  assert.equal(JSON.parse(out.text()).title, 'My Title')
})

test('showSessionHandler renders a human block with title/turns/cwd', async () => {
  const out = capture()
  await showSessionHandler({ sessionId: ID, getDetailFn: async () => DETAIL, stdout: out })
  const text = out.text()
  assert.match(text, /Session 11111111-1111-4111-8111-111111111111/)
  assert.match(text, /title:\s+My Title/)
  assert.match(text, /turns:\s+4 {3}messages: 9/)
  assert.match(text, /cwd:\s+\/proj/)
})

test('showSessionHandler reports a missing session distinctly', async () => {
  const out = capture()
  const r = await showSessionHandler({ sessionId: ID, getDetailFn: async () => ({ sessionId: ID, exists: false }), stdout: out })
  assert.equal(r.exists, false)
  assert.match(out.text(), /not found/i)
})

test('removeSessionHandler reports a successful delete', async () => {
  const out = capture()
  const r = await removeSessionHandler({ sessionId: ID, removeSessionFn: async () => ({ existed: true, removed: ['/p/x.jsonl', '/p/x/'] }), stdout: out })
  assert.equal(r.existed, true)
  assert.match(out.text(), /Removed session 11111111-1111-4111-8111-111111111111 \(2 paths\)/)
})

test('removeSessionHandler reports nothing-to-remove for a missing session', async () => {
  const out = capture()
  await removeSessionHandler({ sessionId: ID, removeSessionFn: async () => ({ existed: false, removed: [] }), stdout: out })
  assert.match(out.text(), /not found.*nothing removed/i)
})
