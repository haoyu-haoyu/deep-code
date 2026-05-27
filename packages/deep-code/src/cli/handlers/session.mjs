import { forkSession } from '../../utils/sessionFork.mjs'

export async function forkHandler({
  atTurn,
  forkSessionFn = forkSession,
  sessionId,
  stdout = process.stdout,
} = {}) {
  if (atTurn !== undefined && (!Number.isInteger(atTurn) || atTurn <= 0)) {
    throw new Error('--at-turn must be a positive integer')
  }

  const result = await forkSessionFn({
    atTurn,
    sourceSessionId: sessionId,
  })

  stdout.write(
    `Forked session ${result.forkedFromSessionId} at turn ${result.forkedAtTurn} ` +
      `into ${result.newSessionId} (${result.turnCount} turns).\n`,
  )

  return result
}
