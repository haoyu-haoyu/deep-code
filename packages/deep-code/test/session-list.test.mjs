import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { listSessionsHandler } from '../src/cli/handlers/sessionList.mjs'
import { countTurns, resolveProjectSessionsDir } from '../src/utils/sessionFork.mjs'
import { listSessions } from '../src/utils/sessionList.mjs'

// Run a body with DEEPCODE_CONFIG_DIR pointed at a temp dir, restoring it after.
async function withConfigDir(cfg, body) {
  const prev = process.env.DEEPCODE_CONFIG_DIR
  process.env.DEEPCODE_CONFIG_DIR = cfg
  try {
    await body()
  } finally {
    if (prev === undefined) delete process.env.DEEPCODE_CONFIG_DIR
    else process.env.DEEPCODE_CONFIG_DIR = prev
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

function userTurn(text, timestamp) {
  return { type: 'user', message: { role: 'user', content: text }, sessionId: UUID_A, timestamp }
}

async function writeSession(dir, sessionId, entries) {
  const body = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
  await writeFile(join(dir, `${sessionId}.jsonl`), body, 'utf8')
}

async function makeDir() {
  return mkdtemp(join(tmpdir(), 'deepcode-session-list-'))
}

function capture() {
  const chunks = []
  return { chunks, write: s => (chunks.push(s), true), text: () => chunks.join('') }
}

// ── core: listSessions ──────────────────────────────────────────────────────

test('listSessions returns one entry per session file with turn count + title', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [
      userTurn('first prompt', '2026-06-01T00:00:00.000Z'),
      userTurn('second prompt', '2026-06-01T00:01:00.000Z'),
    ])
    const sessions = await listSessions({ sessionDir: dir })
    assert.equal(sessions.length, 1)
    const [s] = sessions
    assert.equal(s.sessionId, UUID_A)
    assert.equal(s.turnCount, 2)
    // No title metadata → falls back to the first user prompt.
    assert.equal(s.title, 'first prompt')
    assert.equal(s.firstPrompt, 'first prompt')
    assert.equal(s.lastTimestamp, '2026-06-01T00:01:00.000Z')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Matches getLogDisplayTitle (src/utils/log.ts) + readLiteMetadata's folding:
// agentName > customTitle > aiTitle (same slot as customTitle) > summary >
// firstPrompt (last-prompt entry > first user message).
test('title preference matches the app: agentName > customTitle > aiTitle > summary > prompt', async () => {
  const dir = await makeDir()
  try {
    const D = '44444444-4444-4444-8444-444444444444'
    const E = '55555555-5555-4555-8555-555555555555'
    const F = '66666666-6666-4666-8666-666666666666'
    // only a first user message → that message
    await writeSession(dir, UUID_A, [userTurn('hello there')])
    // last-prompt entry beats the first user message
    await writeSession(dir, UUID_B, [
      userTurn('hello there'),
      { type: 'last-prompt', lastPrompt: 'the latest thing' },
    ])
    // summary beats the prompt
    await writeSession(dir, UUID_C, [
      userTurn('hello there'),
      { type: 'last-prompt', lastPrompt: 'the latest thing' },
      { type: 'summary', summary: 'a tidy summary' },
    ])
    // ai-title (folded into the customTitle slot) beats summary + prompt
    await writeSession(dir, D, [
      userTurn('hello there'),
      { type: 'summary', summary: 'a tidy summary' },
      { type: 'ai-title', aiTitle: 'AI named this' },
    ])
    // a user custom-title beats the ai-title in the same slot
    await writeSession(dir, E, [
      { type: 'ai-title', aiTitle: 'AI named this' },
      { type: 'custom-title', customTitle: 'User renamed this' },
      { type: 'summary', summary: 'a tidy summary' },
    ])
    // agentName wins over everything
    await writeSession(dir, F, [
      { type: 'agent-name', agentName: 'Scout' },
      { type: 'custom-title', customTitle: 'User renamed this' },
      { type: 'summary', summary: 'a tidy summary' },
    ])
    const byId = Object.fromEntries(
      (await listSessions({ sessionDir: dir })).map(s => [s.sessionId, s]),
    )
    assert.equal(byId[UUID_A].title, 'hello there')
    assert.equal(byId[UUID_B].title, 'the latest thing')
    assert.equal(byId[UUID_C].title, 'a tidy summary')
    assert.equal(byId[D].title, 'AI named this')
    assert.equal(byId[E].title, 'User renamed this')
    assert.equal(byId[E].customTitle, 'User renamed this') // folded slot exposes the resolved value
    assert.equal(byId[F].title, 'Scout')
    assert.equal(byId[F].agentName, 'Scout')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('turnCount agrees with fork countTurns over the same entries', async () => {
  const dir = await makeDir()
  try {
    const entries = [
      userTurn('t1'),
      { type: 'assistant', message: { role: 'assistant', content: 'ok' } },
      userTurn('t2'),
      { type: 'custom-title', customTitle: 'x' }, // not a turn
      userTurn('t3'),
    ]
    await writeSession(dir, UUID_A, entries)
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.turnCount, 3)
    assert.equal(s.turnCount, countTurns(entries))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ignores non-session files and is newest-first by mtime', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [userTurn('a')])
    await writeSession(dir, UUID_B, [userTurn('b')])
    await writeSession(dir, UUID_C, [userTurn('c')])
    await writeFile(join(dir, 'notes.txt'), 'ignore me', 'utf8')
    await writeFile(join(dir, 'not-a-uuid.jsonl'), '{}\n', 'utf8')
    // Set explicit mtimes: C newest, then B, then A.
    await utimes(join(dir, `${UUID_A}.jsonl`), new Date(1000), new Date(1000))
    await utimes(join(dir, `${UUID_B}.jsonl`), new Date(2000), new Date(2000))
    await utimes(join(dir, `${UUID_C}.jsonl`), new Date(3000), new Date(3000))
    const sessions = await listSessions({ sessionDir: dir })
    assert.deepEqual(sessions.map(s => s.sessionId), [UUID_C, UUID_B, UUID_A])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a malformed TRAILING line is tolerated silently (benign half-written record)', async () => {
  const dir = await makeDir()
  try {
    const body =
      JSON.stringify(userTurn('good 1')) + '\n' + JSON.stringify(userTurn('good 2')) + '\n' +
      '{ "type": "user", "message": { "rol' // crashed mid-append final line
    await writeFile(join(dir, `${UUID_A}.jsonl`), body, 'utf8')
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.turnCount, 2)
    assert.equal(s.corrupt, false) // a trailing partial line is NOT flagged
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a malformed NON-trailing line is flagged corrupt (could hide metadata)', async () => {
  const dir = await makeDir()
  try {
    const body =
      JSON.stringify(userTurn('good 1')) + '\n' +
      '{ this is not valid json' + '\n' + // corruption in the middle
      JSON.stringify(userTurn('good 2')) + '\n'
    await writeFile(join(dir, `${UUID_A}.jsonl`), body, 'utf8')
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.turnCount, 2) // both good turns still counted
    assert.equal(s.corrupt, true) // but the session is flagged
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a sole malformed line (no valid content) is flagged corrupt', async () => {
  const dir = await makeDir()
  try {
    await writeFile(join(dir, `${UUID_A}.jsonl`), '{ only a broken line', 'utf8')
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.corrupt, true) // not a benign trailing half-write — there is no good data
    assert.equal(s.turnCount, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an empty-string title field falls through (matches getLogDisplayTitle ||, not ??)', async () => {
  const dir = await makeDir()
  try {
    // A cleared custom-title ("") must NOT blank the title — it falls through to
    // summary, exactly as the /resume picker's getLogDisplayTitle would.
    await writeSession(dir, UUID_A, [
      userTurn('hi'),
      { type: 'custom-title', customTitle: '' },
      { type: 'summary', summary: 'the summary' },
    ])
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.title, 'the summary')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('first prompt skips an attachment-only turn for the next meaningful text turn', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [
      { type: 'user', message: { role: 'user', content: [{ type: 'image' }] } }, // turn-start, no text
      { type: 'user', message: { role: 'user', content: 'the real question' } },
    ])
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.firstPrompt, 'the real question')
    assert.equal(s.title, 'the real question')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sidechain sessions are hidden by default, shown + flagged with includeSidechains', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [
      { type: 'user', message: { role: 'user', content: 'real session' }, isSidechain: false },
    ])
    await writeSession(dir, UUID_B, [
      { type: 'user', message: { role: 'user', content: 'agent sidechain' }, isSidechain: true },
    ])
    await utimes(join(dir, `${UUID_A}.jsonl`), new Date(1000), new Date(1000))
    await utimes(join(dir, `${UUID_B}.jsonl`), new Date(2000), new Date(2000)) // sidechain newest
    // default: the sidechain (newest) is hidden, matching the /resume picker
    assert.deepEqual((await listSessions({ sessionDir: dir })).map(s => s.sessionId), [UUID_A])
    // includeSidechains: both, newest first, flagged
    const all = await listSessions({ sessionDir: dir, includeSidechains: true })
    assert.deepEqual(all.map(s => s.sessionId), [UUID_B, UUID_A])
    assert.equal(all[0].sidechain, true)
    assert.equal(all[1].sidechain, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a filtered sidechain does not consume the --limit budget', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [userTurn('real 1')])
    await writeSession(dir, UUID_C, [userTurn('real 2')])
    await writeSession(dir, UUID_B, [
      { type: 'user', message: { role: 'user', content: 'sidechain' }, isSidechain: true },
    ])
    await utimes(join(dir, `${UUID_A}.jsonl`), new Date(1000), new Date(1000))
    await utimes(join(dir, `${UUID_C}.jsonl`), new Date(2000), new Date(2000))
    await utimes(join(dir, `${UUID_B}.jsonl`), new Date(3000), new Date(3000)) // sidechain is newest
    // limit 1 skips the newest (sidechain) and still returns the newest REAL one
    assert.deepEqual((await listSessions({ sessionDir: dir, limit: 1 })).map(s => s.sessionId), [UUID_C])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a directory named like a session file is ignored (no EISDIR crash)', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [userTurn('real session')])
    await mkdir(join(dir, `${UUID_B}.jsonl`)) // a directory masquerading as a session file
    const sessions = await listSessions({ sessionDir: dir })
    assert.deepEqual(sessions.map(s => s.sessionId), [UUID_A])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('limit caps to the N most-recent; missing dir → []', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [userTurn('a')])
    await writeSession(dir, UUID_B, [userTurn('b')])
    await utimes(join(dir, `${UUID_A}.jsonl`), new Date(1000), new Date(1000))
    await utimes(join(dir, `${UUID_B}.jsonl`), new Date(2000), new Date(2000))
    const limited = await listSessions({ sessionDir: dir, limit: 1 })
    assert.deepEqual(limited.map(s => s.sessionId), [UUID_B])

    const missing = await listSessions({ sessionDir: join(dir, 'does-not-exist') })
    assert.deepEqual(missing, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('limit must be a non-negative integer', async () => {
  await assert.rejects(() => listSessions({ sessionDir: '/tmp', limit: -1 }), /non-negative integer/)
  await assert.rejects(() => listSessions({ sessionDir: '/tmp', limit: 1.5 }), /non-negative integer/)
})

// ── project-dir resolution (matches the transcript writer) ───────────────────

test('resolveProjectSessionsDir canonicalizes a symlinked cwd to the same project dir', async () => {
  const cfg = await makeDir()
  const real = await makeDir()
  const linkParent = await makeDir()
  const link = join(linkParent, 'link')
  try {
    await withConfigDir(cfg, async () => {
      await symlink(real, link)
      // A symlinked cwd and its real target must map to the SAME project dir (the
      // writer canonicalizes via realpath), or list/fork miss the sessions.
      assert.equal(resolveProjectSessionsDir({ cwd: link }), resolveProjectSessionsDir({ cwd: real }))
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
    await rm(real, { recursive: true, force: true })
    await rm(linkParent, { recursive: true, force: true })
  }
})

function userTurnInCwd(text, cwd) {
  return { type: 'user', message: { role: 'user', content: text }, cwd }
}
const prefixOf = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200)

test('recovers a long-path dir written under a non-reproducible hash via stored cwd', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const longCwd = '/nonexistent/' + 'y'.repeat(300)
      // Dir hash matches NEITHER djb2 nor Bun.hash of longCwd (a foreign/legacy
      // hash), but its transcript records the matching cwd.
      const dir = join(cfg, 'projects', `${prefixOf(longCwd)}-legacyhash`)
      await mkdir(dir, { recursive: true })
      await writeSession(dir, UUID_A, [userTurnInCwd('mine', longCwd)])
      assert.equal(resolveProjectSessionsDir({ cwd: longCwd }), dir) // verified by stored cwd
      assert.deepEqual((await listSessions({ cwd: longCwd })).map(s => s.sessionId), [UUID_A])
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test('a same-prefix sibling with a DIFFERENT stored cwd is rejected (no cross-project leak)', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const longCwd = '/nonexistent/' + 'z'.repeat(300)
      // Another cwd that shares the first 200 sanitized chars but is NOT longCwd.
      const otherCwd = '/nonexistent/' + 'z'.repeat(250) + '/different'
      assert.equal(prefixOf(longCwd), prefixOf(otherCwd)) // same 200-char prefix
      const otherDir = join(cfg, 'projects', `${prefixOf(otherCwd)}-otherhash`)
      await mkdir(otherDir, { recursive: true })
      await writeSession(otherDir, UUID_A, [userTurnInCwd('theirs', otherCwd)])

      assert.notEqual(resolveProjectSessionsDir({ cwd: longCwd }), otherDir)
      assert.deepEqual(await listSessions({ cwd: longCwd }), []) // fail closed
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test('an oversized first message is recovered by reading line 1 up to the cap (positive match)', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const longCwd = '/nonexistent/' + 'h'.repeat(300)
      const dir = join(cfg, 'projects', `${prefixOf(longCwd)}-legacyhash`)
      await mkdir(dir, { recursive: true })
      // A ~70KB first message — line 1 (incl its trailing cwd) is within the cap,
      // so its cwd is read and positively matches.
      await writeSession(dir, UUID_A, [userTurnInCwd('x'.repeat(70000), longCwd)])
      assert.equal(resolveProjectSessionsDir({ cwd: longCwd }), dir)
      assert.deepEqual((await listSessions({ cwd: longCwd })).map(s => s.sessionId), [UUID_A])
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test("a later message's cwd never shadows line 1's cwd (no wrong-dir match)", async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const myCwd = '/nonexistent/' + 'k'.repeat(300)
      // A DIFFERENT project sharing the first 200 sanitized chars; its session's
      // FIRST message is in otherCwd, but a LATER message ran in myCwd (worktree
      // move). Resolving myCwd must NOT match this dir — we read line 1's cwd only.
      const otherCwd = '/nonexistent/' + 'k'.repeat(250) + '/elsewhere'
      assert.equal(prefixOf(myCwd), prefixOf(otherCwd))
      const dir = join(cfg, 'projects', `${prefixOf(otherCwd)}-somehash`)
      await mkdir(dir, { recursive: true })
      const body =
        JSON.stringify(userTurnInCwd('x'.repeat(70000), otherCwd)) + '\n' + // line 1: huge, cwd=otherCwd
        JSON.stringify(userTurnInCwd('moved here later', myCwd)) + '\n' // later turn: cwd=myCwd
      await writeFile(join(dir, `${UUID_A}.jsonl`), body, 'utf8')
      assert.notEqual(resolveProjectSessionsDir({ cwd: myCwd }), dir)
      assert.deepEqual(await listSessions({ cwd: myCwd }), []) // line-1 cwd is otherCwd → no match
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test('a sole same-prefix sibling with an UNVERIFIABLE cwd is NOT trusted (no cross-project)', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const longCwd = '/nonexistent/' + 'u'.repeat(300)
      // The ONLY same-prefix dir, but its transcript records no cwd, so we cannot
      // confirm it is ours — it must NOT be resolved (it could be a different
      // project). Requiring a positive match (never trusting prefix alone) is what
      // prevents cross-project leakage.
      const dir = join(cfg, 'projects', `${prefixOf(longCwd)}-unknownhash`)
      await mkdir(dir, { recursive: true })
      await writeSession(dir, UUID_A, [userTurn('no cwd field here')])
      assert.notEqual(resolveProjectSessionsDir({ cwd: longCwd }), dir)
      assert.deepEqual(await listSessions({ cwd: longCwd }), []) // fail closed
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test('multiple same-prefix dirs with unverifiable cwd fail closed (no arbitrary pick)', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      const longCwd = '/nonexistent/' + 'm'.repeat(300)
      const p = prefixOf(longCwd)
      const d1 = join(cfg, 'projects', `${p}-hashone`)
      const d2 = join(cfg, 'projects', `${p}-hashtwo`)
      await mkdir(d1, { recursive: true })
      await writeSession(d1, UUID_A, [userTurn('a')]) // no cwd field → unverifiable
      await mkdir(d2, { recursive: true })
      await writeSession(d2, UUID_B, [userTurn('b')])
      const resolved = resolveProjectSessionsDir({ cwd: longCwd })
      assert.notEqual(resolved, d1)
      assert.notEqual(resolved, d2)
      assert.deepEqual(await listSessions({ cwd: longCwd }), []) // ambiguous → fail closed
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

test('a task-summary surfaces as the title (matches readLiteMetadata last-summary)', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, UUID_A, [
      userTurn('the prompt'),
      { type: 'task-summary', summary: 'doing the thing' },
    ])
    const [s] = await listSessions({ sessionDir: dir })
    assert.equal(s.summary, 'doing the thing')
    assert.equal(s.title, 'doing the thing') // summary beats the first prompt
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Replicates the writer's sanitizePath (sessionStoragePortable.ts) for the Node
// long-path branch: djb2 hash from src/utils/hash.ts. Used to compute the dir the
// WRITER would pick, to prove sessionFork resolves to the SAME one (exact match).
function sanitizeLikeWriter(name) {
  const s = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (s.length <= 200) return s
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return `${s.slice(0, 200)}-${Math.abs(hash).toString(36)}`
}

test('long same-prefix paths exact-match the writer hash (no wrong-sibling pick)', async () => {
  const cfg = await makeDir()
  try {
    await withConfigDir(cfg, async () => {
      // Two nonexistent long cwds sharing the first 200 sanitized chars but with
      // different djb2 hashes — a prefix scan would ambiguously pick one, exact
      // hashing must pick each correctly.
      const shared = '/' + 'a'.repeat(250)
      const cwd1 = `${shared}/one`
      const cwd2 = `${shared}/two`
      const dir1 = join(cfg, 'projects', sanitizeLikeWriter(cwd1))
      const dir2 = join(cfg, 'projects', sanitizeLikeWriter(cwd2))
      assert.notEqual(dir1, dir2)
      assert.ok(dir1.startsWith(dir2.slice(0, dir2.lastIndexOf('-')))) // same prefix, different hash
      await mkdir(dir1, { recursive: true })
      await writeSession(dir1, UUID_A, [userTurn('one')])
      await mkdir(dir2, { recursive: true })
      await writeSession(dir2, UUID_B, [userTurn('two')])

      assert.equal(resolveProjectSessionsDir({ cwd: cwd1 }), dir1) // exact match, not prefix scan
      assert.equal(resolveProjectSessionsDir({ cwd: cwd2 }), dir2)
      assert.deepEqual((await listSessions({ cwd: cwd1 })).map(s => s.sessionId), [UUID_A])
      assert.deepEqual((await listSessions({ cwd: cwd2 })).map(s => s.sessionId), [UUID_B])
    })
  } finally {
    await rm(cfg, { recursive: true, force: true })
  }
})

// ── handler: listSessionsHandler ─────────────────────────────────────────────

// No undefined-valued keys: JSON.stringify drops those, so the round-trip stays
// exact. (The real core may emit undefined metadata fields; the handler ignores
// them and JSON omits them — not what this handler test is pinning.)
const SAMPLE = [
  { sessionId: UUID_C, path: '/p/c', modifiedMs: 3000, turnCount: 7, title: 'newest', firstPrompt: 'newest' },
  { sessionId: UUID_A, path: '/p/a', modifiedMs: 1000, turnCount: 2, title: 'oldest', firstPrompt: 'oldest' },
]

test('handler --json emits the exact session objects', async () => {
  const out = capture()
  const returned = await listSessionsHandler({ json: true, listSessionsFn: async () => SAMPLE, stdout: out })
  assert.deepEqual(returned, SAMPLE)
  assert.deepEqual(JSON.parse(out.text()), SAMPLE)
})

test('handler table prints one line per session with short id + turns + title', async () => {
  const out = capture()
  await listSessionsHandler({ listSessionsFn: async () => SAMPLE, stdout: out })
  const lines = out.text().trimEnd().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^33333333/) // short id (first 8 of UUID_C)
  assert.match(lines[0], /7 turns/)
  assert.match(lines[0], /newest/)
  assert.match(lines[1], /oldest/)
})

test('handler reports an empty store distinctly (not a blank table)', async () => {
  const out = capture()
  await listSessionsHandler({ listSessionsFn: async () => [], stdout: out })
  assert.match(out.text(), /No saved sessions/i)
})

test('handler passes json/limit/sessionDir through to the core (sidechains excluded by default)', async () => {
  let received
  await listSessionsHandler({
    json: false,
    limit: 5,
    sessionDir: '/some/dir',
    listSessionsFn: async args => {
      received = args
      return []
    },
    stdout: capture(),
  })
  assert.deepEqual(received, { sessionDir: '/some/dir', limit: 5, includeSidechains: false })
})

test('handler --all asks the core to include sidechains', async () => {
  let received
  await listSessionsHandler({
    all: true,
    listSessionsFn: async args => {
      received = args
      return []
    },
    stdout: capture(),
  })
  assert.equal(received.includeSidechains, true)
})
