import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { forkHandler } from '../src/cli/handlers/session.mjs'
import { forkSession } from '../src/utils/sessionFork.mjs'

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
