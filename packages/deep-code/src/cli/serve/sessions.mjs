import { randomUUID } from 'node:crypto'

export function createSessionRegistry({ defaultCwd = process.cwd } = {}) {
  const sessions = new Map()

  return {
    createSession({ cwd } = {}) {
      const now = Date.now()
      const session = {
        active_turn_id: null,
        created_at: now,
        cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : defaultCwd(),
        id: randomUUID(),
        state: 'idle',
        turns: new Map(),
        turn_count: 0,
        updated_at: now,
      }
      sessions.set(session.id, session)
      return cloneSession(session)
    },

    deleteSession(id) {
      this.abortActiveTurn(id)
      return sessions.delete(id)
    },

    getSession(id) {
      const session = sessions.get(id)
      return session ? cloneSession(session) : null
    },

    getTurn(sessionId, turnId) {
      const session = sessions.get(sessionId)
      const turn = session?.turns.get(Number(turnId))
      return turn ? cloneTurn(turn) : null
    },

    startTurn(sessionId, { abortController }) {
      const session = sessions.get(sessionId)
      if (!session) return { status: 'not_found' }
      if (session.active_turn_id !== null) return { status: 'conflict' }

      const now = Date.now()
      const turn = {
        completed_at: null,
        error: null,
        id: session.turn_count + 1,
        session_id: session.id,
        started_at: now,
        status: 'running',
      }

      session.turn_count = turn.id
      session.active_turn_id = turn.id
      session.activeTurnAbortController = abortController
      session.state = 'running'
      session.updated_at = now
      session.turns.set(turn.id, turn)

      return {
        session: cloneSession(session),
        status: 'started',
        turn: cloneTurn(turn),
      }
    },

    completeTurn(sessionId, turnId, { error = null, status }) {
      const session = sessions.get(sessionId)
      const turn = session?.turns.get(Number(turnId))
      if (!session || !turn) return false

      const now = Date.now()
      turn.completed_at = now
      turn.error = error
      turn.status = status
      if (session.active_turn_id === turn.id) {
        session.active_turn_id = null
        session.activeTurnAbortController = null
      }
      session.state = 'idle'
      session.updated_at = now
      return true
    },

    abortActiveTurn(sessionId) {
      const session = sessions.get(sessionId)
      if (!session?.activeTurnAbortController) return false
      session.activeTurnAbortController.abort()
      return true
    },
  }
}

function cloneSession(session) {
  const { activeTurnAbortController, turns, ...publicSession } = session
  return { ...publicSession }
}

function cloneTurn(turn) {
  return { ...turn }
}
