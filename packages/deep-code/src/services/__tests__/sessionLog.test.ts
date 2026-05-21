import { expect, mock, test } from 'bun:test'

mock.module('../../utils/debug.js', () => ({
  logForDebugging() {},
}))

mock.module('../../utils/diagLogs.js', () => ({
  logForDiagnosticsNoPII() {},
}))

mock.module('../../utils/log.js', () => ({
  logError() {},
}))

mock.module('../../utils/sessionIngressAuth.js', () => ({
  getSessionIngressAuthToken: () => null,
}))

mock.module('../../utils/sleep.js', () => ({
  sleep: async () => {},
}))

mock.module('../../utils/slowOperations.js', () => ({
  jsonStringify: JSON.stringify,
}))

test('getSessionLogsViaOAuth stub returns null', async () => {
  const sessionLog = await import('../sessionLog.ts')
  const result = await sessionLog.getSessionLogsViaOAuth('s', 't', 'o')
  expect(result).toBeNull()
})

test('getTeleportEvents stub returns null', async () => {
  const sessionLog = await import('../sessionLog.ts')
  const result = await sessionLog.getTeleportEvents('s', 't', 'o')
  expect(result).toBeNull()
})

test('exported local helpers are callable', async () => {
  const sessionLog = await import('../sessionLog.ts')
  expect(typeof sessionLog.appendSessionLog).toBe('function')
  expect(typeof sessionLog.getSessionLogs).toBe('function')
  expect(typeof sessionLog.clearSession).toBe('function')
  expect(typeof sessionLog.clearAllSessions).toBe('function')
})
