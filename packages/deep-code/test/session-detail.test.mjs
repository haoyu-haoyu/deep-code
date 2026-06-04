import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { exportSessionHandler } from '../src/cli/handlers/sessionExport.mjs'
import { removeSessionHandler } from '../src/cli/handlers/sessionRemove.mjs'
import { showSessionHandler } from '../src/cli/handlers/sessionShow.mjs'
import {
  exportEntryJson,
  exportSession,
  getSessionDetail,
  removeSession,
  renderEntryMarkdown,
} from '../src/utils/sessionDetail.mjs'

const ID = '11111111-1111-4111-8111-111111111111'

async function makeDir() {
  return mkdtemp(join(tmpdir(), 'deepcode-session-detail-'))
}
async function writeSession(dir, id, entries) {
  await writeFile(join(dir, `${id}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}
function capture() {
  const chunks = []
  // Honors the optional Writable write(chunk, cb) callback so it's a valid stand-in
  // for a real stream when a handler awaits per-write completion.
  return {
    chunks,
    write: (s, cb) => {
      chunks.push(s)
      if (typeof cb === 'function') cb()
      return true
    },
    text: () => chunks.join(''),
  }
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

// ── export: renderers + streaming ─────────────────────────────────────────────

test('renderEntryMarkdown renders user/assistant turns and skips metadata', () => {
  assert.equal(
    renderEntryMarkdown({ type: 'user', message: { role: 'user', content: 'hello' } }),
    '## User\n\nhello',
  )
  const asst = renderEntryMarkdown({
    type: 'assistant',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'hi there' },
      { type: 'tool_use', name: 'BashTool', input: { command: 'ls' } },
    ] },
  })
  assert.match(asst, /^## Assistant/)
  assert.match(asst, /hi there/)
  assert.match(asst, /\[tool: .*BashTool.*\]/)
  // metadata + empty turns are skipped
  assert.equal(renderEntryMarkdown({ type: 'custom-title', customTitle: 'X' }), null)
  assert.equal(renderEntryMarkdown({ type: 'user', message: { role: 'user', content: '' } }), null)
})

test('exportEntryJson keeps conversation messages and drops metadata', () => {
  assert.deepEqual(
    exportEntryJson({ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: 't' }),
    { type: 'user', role: 'user', content: 'hi', timestamp: 't' },
  )
  assert.equal(exportEntryJson({ type: 'summary', summary: 's' }), null)
})

const CONVO = [
  { type: 'user', message: { role: 'user', content: 'hello' }, timestamp: '2026-06-01T00:00:00.000Z' },
  { type: 'custom-title', customTitle: 'X' }, // skipped in both formats
  { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'text', text: 'hi there' },
    { type: 'tool_use', name: 'BashTool', input: { command: 'ls' } },
  ] }, timestamp: '2026-06-01T00:00:01.000Z' },
]

test('exportSession markdown streams user/assistant blocks, omits metadata', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, CONVO)
    const chunks = []
    const r = await exportSession({ sessionId: ID, sessionDir: dir, format: 'markdown', write: c => chunks.push(c) })
    assert.equal(r.exists, true)
    const out = chunks.join('')
    assert.match(out, /## User\n\nhello/)
    assert.match(out, /## Assistant/)
    assert.match(out, /\[tool: .*BashTool.*\]/)
    assert.doesNotMatch(out, /custom-title|"X"/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSession json streams a valid JSON array of conversation messages', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, CONVO)
    const chunks = []
    await exportSession({ sessionId: ID, sessionDir: dir, format: 'json', write: c => chunks.push(c) })
    const parsed = JSON.parse(chunks.join(''))
    assert.equal(parsed.length, 2) // metadata entry excluded
    assert.equal(parsed[0].type, 'user')
    assert.equal(parsed[1].type, 'assistant')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSession json emits [] for a session with no conversation messages', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [{ type: 'custom-title', customTitle: 'only metadata' }])
    const chunks = []
    await exportSession({ sessionId: ID, sessionDir: dir, format: 'json', write: c => chunks.push(c) })
    assert.deepEqual(JSON.parse(chunks.join('')), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSession returns exists:false (no writes) for a missing session', async () => {
  const dir = await makeDir()
  try {
    const chunks = []
    const r = await exportSession({ sessionId: ID, sessionDir: dir, write: c => chunks.push(c) })
    assert.equal(r.exists, false)
    assert.equal(chunks.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSession treats a symlinked transcript as not-found (no symlink-follow)', async () => {
  const dir = await makeDir()
  const target = await makeDir()
  try {
    await writeSession(target, ID, CONVO)
    await symlink(join(target, `${ID}.jsonl`), join(dir, `${ID}.jsonl`))
    const chunks = []
    const r = await exportSession({ sessionId: ID, sessionDir: dir, write: c => chunks.push(c) })
    assert.equal(r.exists, false)
    assert.equal(chunks.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})

test('exportSessionHandler reports a missing session to STDERR (stdout stays clean)', async () => {
  const out = capture()
  const err = capture()
  const r = await exportSessionHandler({
    sessionId: ID,
    exportSessionFn: async () => ({ exists: false }),
    stdout: out,
    stderr: err,
  })
  assert.equal(r.exists, false)
  assert.equal(out.text(), '') // nothing on stdout — safe to pipe
  assert.match(err.text(), /not found/i)
})

test('exportSessionHandler defaults to markdown and forwards an explicit format', async () => {
  let received
  await exportSessionHandler({ sessionId: ID, exportSessionFn: async a => ((received = a), { exists: true }), stdout: capture(), stderr: capture() })
  assert.equal(received.format, 'markdown')
  await exportSessionHandler({ sessionId: ID, format: 'json', exportSessionFn: async a => ((received = a), { exists: true }), stdout: capture(), stderr: capture() })
  assert.equal(received.format, 'json')
})

test('renderEntryMarkdown renders a tool_result block', () => {
  const md = renderEntryMarkdown({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'exit 0\nok' }] },
  })
  assert.match(md, /## User/)
  assert.match(md, /\[tool result\]/)
  assert.match(md, /exit 0/)
})

test('a tool_use input containing backticks does not break the markdown fence', () => {
  const fence4 = '`'.repeat(4)
  const inner3 = '`'.repeat(3)
  const md = renderEntryMarkdown({
    type: 'assistant',
    message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Bash', input: { code: `${inner3}js\nx\n${inner3}` } },
    ] },
  })
  // input has a run of 3 backticks → fence must widen to >=4 so it can't be closed early
  assert.ok(md.includes(`${fence4}json`), 'fence widened to 4 backticks')
  assert.ok(md.includes(`${inner3}js`), 'the backtick-containing input survived intact')
})

test('exportEntryJson drops empty-content turns (consistency with markdown)', () => {
  assert.equal(exportEntryJson({ type: 'user', message: { role: 'user', content: '' } }), null)
  assert.equal(exportEntryJson({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '  ' }] } }), null)
  assert.ok(exportEntryJson({ type: 'user', message: { role: 'user', content: 'hi' } }))
})

test('exportSession markdown and json include the SAME set of turns (empty dropped in both)', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [
      { type: 'user', message: { role: 'user', content: '' } }, // empty → dropped in BOTH formats
      { type: 'user', message: { role: 'user', content: 'real' } },
    ])
    const j = []
    await exportSession({ sessionId: ID, sessionDir: dir, format: 'json', write: c => j.push(c) })
    assert.equal(JSON.parse(j.join('')).length, 1)
    const m = []
    await exportSession({ sessionId: ID, sessionDir: dir, format: 'markdown', write: c => m.push(c) })
    assert.equal((m.join('').match(/## User/g) || []).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an attachment-only turn is kept with a placeholder, not dropped (markdown + json)', () => {
  const md = renderEntryMarkdown({ type: 'user', message: { role: 'user', content: [{ type: 'image' }] } })
  assert.match(md, /## User/)
  assert.match(md, /\[image\]/)
  assert.ok(exportEntryJson({ type: 'user', message: { role: 'user', content: [{ type: 'image' }] } }))
})

test('a non-text tool_result (e.g. image) renders a placeholder, not an empty stub', () => {
  const md = renderEntryMarkdown({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'image' }] }] },
  })
  assert.match(md, /\[tool result\]/)
  assert.match(md, /\[image\]/)
})

test('exportSession awaits a backpressure-aware write (serialized, order preserved)', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [
      { type: 'user', message: { role: 'user', content: 'a' } },
      { type: 'assistant', message: { role: 'assistant', content: 'b' } },
    ])
    const chunks = []
    let inFlight = 0
    let maxInFlight = 0
    const write = async c => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve() // defer a tick (stands in for awaiting 'drain')
      chunks.push(c)
      inFlight--
    }
    await exportSession({ sessionId: ID, sessionDir: dir, format: 'markdown', write })
    assert.equal(maxInFlight, 1, 'writes are awaited serially (backpressure honored)')
    assert.match(chunks.join(''), /## User\n\na[\s\S]*## Assistant\n\nb/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSessionHandler streams through a real backpressured Writable (callback-bounded, ordered)', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [
      { type: 'user', message: { role: 'user', content: 'a' } },
      { type: 'assistant', message: { role: 'assistant', content: 'b' } },
    ])
    const { Writable } = await import('node:stream')
    const collected = []
    // highWaterMark 1 + a deferred _write callback = a genuinely backpressured,
    // slow consumer; the handler must await each chunk's flush callback.
    const out = new Writable({
      highWaterMark: 1,
      write(chunk, _enc, cb) {
        collected.push(chunk.toString())
        setImmediate(cb)
      },
    })
    const result = await exportSessionHandler({ sessionId: ID, sessionDir: dir, stdout: out, stderr: capture() })
    assert.equal(result.exists, true)
    assert.match(collected.join(''), /## User\n\na[\s\S]*## Assistant\n\nb/) // ordered + complete
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSessionHandler rejects (no uncaught) when the stdout stream errors mid-write', async () => {
  const dir = await makeDir()
  try {
    await writeSession(dir, ID, [{ type: 'user', message: { role: 'user', content: 'a' } }])
    const { Writable } = await import('node:stream')
    const out = new Writable({
      write(_chunk, _enc, cb) {
        cb(new Error('boom')) // a write error surfaces via the write callback AND 'error' event
      },
    })
    await assert.rejects(
      () => exportSessionHandler({ sessionId: ID, sessionDir: dir, stdout: out, stderr: capture() }),
      /boom/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a typeless/garbage block is dropped in BOTH markdown and json (same-turns invariant)', () => {
  for (const content of [[{ text: '' }], [{ type: '' }], [{ type: null }], [{}]]) {
    assert.equal(renderEntryMarkdown({ type: 'user', message: { role: 'user', content } }), null, JSON.stringify(content))
    assert.equal(exportEntryJson({ type: 'user', message: { role: 'user', content } }), null, JSON.stringify(content))
  }
})

test('exportSessionHandler write resolves only when the chunk is flushed (no premature success)', async () => {
  // A Writable whose flush callback is deferred and controllable: the handler's
  // per-write promise must NOT resolve until the callback fires (so a later error
  // can't be missed and memory stays bounded).
  const { Writable } = await import('node:stream')
  const pending = []
  const out = new Writable({
    highWaterMark: 1,
    write(chunk, _enc, cb) {
      pending.push({ chunk: chunk.toString(), cb })
    },
  })
  let resolved = false
  const result = exportSessionHandler({
    sessionId: ID,
    exportSessionFn: async ({ write }) => {
      await write('first')
      resolved = true // only reached after 'first' is flushed
      return { exists: true }
    },
    stdout: out,
    stderr: capture(),
  })
  await new Promise(r => setImmediate(r))
  assert.equal(resolved, false, 'did not resolve before the flush callback fired')
  assert.equal(pending.length, 1)
  pending[0].cb() // flush now
  await result
  assert.equal(resolved, true)
})
