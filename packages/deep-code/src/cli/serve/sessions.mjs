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
        turn_count: 0,
        updated_at: now,
      }
      sessions.set(session.id, session)
      return cloneSession(session)
    },

    deleteSession(id) {
      return sessions.delete(id)
    },

    getSession(id) {
      const session = sessions.get(id)
      return session ? cloneSession(session) : null
    },
  }
}

function cloneSession(session) {
  return { ...session }
}
