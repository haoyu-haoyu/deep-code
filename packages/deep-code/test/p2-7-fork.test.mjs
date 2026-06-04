import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { forkHandler } from '../src/cli/handlers/session.mjs'
import { forkSession } from '../src/utils/sessionFork.mjs'
import { scanSessionFile } from '../src/utils/sessionList.mjs'

test('forkSession copies a 10-turn session through turn 5', async () => {
  const fixture = await createSessionFixture({ turns: 10 })

  const result = await forkSession({
    atTurn: 5,
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })
  const forked = await readSessionLines(fixture.sessionDir, result.newSessionId)

  assert.equal(result.forkedFromSessionId, fixture.sourceSessionId)
  assert.equal(result.forkedAtTurn, 5)
  assert.equal(result.turnCount, 5)
  assert.equal(countTurns(forked), 5)
  assert.deepEqual(
    forked.filter(entry => entry.type === 'user').map(entry => entry.message.content),
    ['turn 1', 'turn 2', 'turn 3', 'turn 4', 'turn 5'],
  )
})

test('forkSession defaults to the last turn', async () => {
  const fixture = await createSessionFixture({ turns: 4 })

  const result = await forkSession({
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })
  const forked = await readSessionLines(fixture.sessionDir, result.newSessionId)

  assert.equal(result.forkedAtTurn, 4)
  assert.equal(result.turnCount, 4)
  assert.equal(countTurns(forked), 4)
})

test('forkSession rejects invalid turn numbers', async () => {
  const fixture = await createSessionFixture({ turns: 3 })

  for (const atTurn of [0, -1, 4]) {
    await assert.rejects(
      forkSession({
        atTurn,
        sessionDir: fixture.sessionDir,
        sourceSessionId: fixture.sourceSessionId,
      }),
      /atTurn|turn/i,
    )
  }
})

test('forkSession rejects a missing source session', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'deepcode-fork-missing-'))

  await assert.rejects(
    forkSession({
      sessionDir,
      sourceSessionId: randomUUID(),
    }),
    /not found/i,
  )
})

test('forkSession leaves the source session unchanged', async () => {
  const fixture = await createSessionFixture({ turns: 6 })
  const before = await readFile(fixture.sourcePath, 'utf8')

  await forkSession({
    atTurn: 3,
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })

  assert.equal(await readFile(fixture.sourcePath, 'utf8'), before)
})

test('forkSession creates unique session ids', async () => {
  const fixture = await createSessionFixture({ turns: 2 })

  const first = await forkSession({
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })
  const second = await forkSession({
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })

  assert.notEqual(first.newSessionId, fixture.sourceSessionId)
  assert.notEqual(second.newSessionId, fixture.sourceSessionId)
  assert.notEqual(first.newSessionId, second.newSessionId)
})

test('forkHandler validates atTurn and prints the fork result', async () => {
  let output = ''
  const result = await forkHandler({
    atTurn: 2,
    forkSessionFn: async input => ({
      forkedAtTurn: input.atTurn,
      forkedFromSessionId: input.sourceSessionId,
      newSessionId: '11111111-1111-4111-8111-111111111111',
      turnCount: 2,
    }),
    sessionId: '22222222-2222-4222-8222-222222222222',
    stdout: { write: chunk => { output += chunk } },
  })

  assert.equal(result.turnCount, 2)
  assert.match(output, /Forked session 22222222-2222-4222-8222-222222222222/)
  assert.match(output, /turn 2/)
  assert.match(output, /11111111-1111-4111-8111-111111111111/)

  await assert.rejects(
    forkHandler({
      atTurn: Number.NaN,
      sessionId: '22222222-2222-4222-8222-222222222222',
    }),
    /positive integer/i,
  )
})

// A benign trailing half-write (the CLI SIGKILLed mid-append) is what
// scanSessionFile (list/show) reports as corrupt:false / forkable. fork must
// AGREE — it used to hard-throw "Invalid JSONL", so `list` showed a clean
// session that `fork <id>` then rejected.
test('forkSession tolerates a benign trailing half-write (consistent with list/show)', async () => {
  const fixture = await createSessionFixture({ turns: 3 })
  // append a truncated final line, no newline — exactly a killed-mid-append write
  await appendFile(fixture.sourcePath, '{"type":"user","message":{"con', 'utf8')

  // list/show would call this clean + forkable:
  const acc = await scanSessionFile(fixture.sourcePath)
  assert.equal(acc.corrupt, false, 'scanner treats a trailing half-write as benign')

  // fork must therefore succeed (dropping the partial line), not throw:
  const result = await forkSession({
    sessionDir: fixture.sessionDir,
    sourceSessionId: fixture.sourceSessionId,
  })
  assert.equal(result.turnCount, 3)
  const forked = await readSessionLines(fixture.sessionDir, result.newSessionId)
  assert.equal(countTurns(forked), 3)
})

test('forkSession still rejects REAL mid-file corruption (also consistent with list/show)', async () => {
  // A malformed line FOLLOWED by a good line is real corruption, not a trailing
  // half-write — the scanner marks corrupt:true and fork still throws.
  const fixture = await createSessionFixture({ turns: 2 })
  const good = (await readFile(fixture.sourcePath, 'utf8')).trimEnd().split('\n')
  await writeFile(
    fixture.sourcePath,
    [good[0], '{"type":"user","message":{"broken', ...good.slice(1)].join('\n') + '\n',
    'utf8',
  )
  const acc = await scanSessionFile(fixture.sourcePath)
  assert.equal(acc.corrupt, true, 'scanner flags mid-file corruption')
  await assert.rejects(
    forkSession({ sessionDir: fixture.sessionDir, sourceSessionId: fixture.sourceSessionId }),
    /Invalid JSONL/,
  )
})

test('forkSession tokenizes/parses like the scanner (BOM/NBSP-led + CR-only lines)', async () => {
  // parseJsonl must mirror scanSessionFile EXACTLY: split on universal newlines
  // (\r\n, \r, \n — readline breaks on a lone \r) and JSON.parse the TRIMMED line
  // (JSON.parse rejects a leading BOM/NBSP that String.trim() strips). Otherwise
  // a BOM/NBSP-led or CR-terminated transcript that list/show call clean would
  // throw (or silently undercount turns) on fork.
  for (const [label, build] of [
    ['BOM-led 2nd line', (u, a) => `${u}\n﻿${a}`],
    ['NBSP-led 2nd line', (u, a) => `${u}\n ${a}`],
    ['CR-only separators', (u, a) => `${u}\r${a}\r`],
    ['CRLF separators', (u, a) => `${u}\r\n${a}\r\n`],
  ]) {
    const fixture = await createSessionFixture({ turns: 2 })
    const [u, a] = (await readFile(fixture.sourcePath, 'utf8')).trimEnd().split('\n').slice(0, 2)
    await writeFile(fixture.sourcePath, build(u, a), 'utf8')

    const acc = await scanSessionFile(fixture.sourcePath)
    const result = await forkSession({
      sessionDir: fixture.sessionDir,
      sourceSessionId: fixture.sourceSessionId,
    })
    // fork's turn count must match what the scanner (list/show) reported.
    assert.equal(result.turnCount, acc.turnCount, `${label}: fork/scan turn count must agree`)
    assert.equal(acc.corrupt, false, `${label}: scanner clean`)
  }
})

async function createSessionFixture({ turns }) {
  const sessionDir = await mkdtemp(join(tmpdir(), 'deepcode-fork-'))
  const sourceSessionId = randomUUID()
  const sourcePath = join(sessionDir, `${sourceSessionId}.jsonl`)
  const lines = []
  let parentUuid = null

  for (let turn = 1; turn <= turns; turn++) {
    const userUuid = randomUUID()
    lines.push(sessionEntry({
      parentUuid,
      sessionId: sourceSessionId,
      type: 'user',
      uuid: userUuid,
      turn,
    }))
    const assistantUuid = randomUUID()
    lines.push(sessionEntry({
      parentUuid: userUuid,
      sessionId: sourceSessionId,
      type: 'assistant',
      uuid: assistantUuid,
      turn,
    }))
    lines.push({
      lastPrompt: `turn ${turn}`,
      sessionId: sourceSessionId,
      type: 'last-prompt',
    })
    parentUuid = assistantUuid
  }

  await writeFile(
    sourcePath,
    lines.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  )

  return { sessionDir, sourcePath, sourceSessionId }
}

function sessionEntry({ parentUuid, sessionId, type, uuid, turn }) {
  const timestamp = new Date(Date.UTC(2026, 4, 28, 12, turn)).toISOString()
  if (type === 'user') {
    return {
      cwd: '/tmp/deepcode-fork-fixture',
      isSidechain: false,
      message: { content: `turn ${turn}`, role: 'user' },
      parentUuid,
      sessionId,
      timestamp,
      type,
      userType: 'external',
      uuid,
      version: 'test',
    }
  }

  return {
    cwd: '/tmp/deepcode-fork-fixture',
    isSidechain: false,
    message: {
      content: [{ text: `answer ${turn}`, type: 'text' }],
      role: 'assistant',
    },
    parentUuid,
    sessionId,
    timestamp,
    type,
    userType: 'external',
    uuid,
    version: 'test',
  }
}

async function readSessionLines(sessionDir, sessionId) {
  const path = join(sessionDir, `${sessionId}.jsonl`)
  assert.equal(existsSync(path), true, `expected ${path} to exist`)
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
}

function countTurns(entries) {
  return entries.filter(isTurnStart).length
}

function isTurnStart(entry) {
  return entry.type === 'user' &&
    entry.isMeta !== true &&
    typeof entry.message?.content === 'string' &&
    entry.message.content.trim().length > 0
}
