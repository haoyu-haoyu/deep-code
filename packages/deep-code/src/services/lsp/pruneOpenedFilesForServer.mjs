/**
 * Drop every openedFiles entry recorded against a server's PREVIOUS process.
 *
 * ensureServerStarted runs this when it (re)starts a stopped/errored server: a
 * freshly started process has no open documents, and entries from the dead prior
 * process are invalid regardless (isOpenInCurrentServerProcess already masks them
 * via a startedAt identity check, but they are never reclaimed).
 *
 * Running it only on the SUCCESS path leaked entries whenever server.start()
 * threw — a server that repeatedly fails to start (missing binary, repeated init
 * timeout) accumulated dead-generation entries unboundedly across a long session.
 * Calling this in a finally reclaims them on both the success and failure paths.
 *
 * Deleting the current key during Map iteration is well-defined (the original
 * inline loop did the same).
 *
 * @param {Map<string, { serverName: string, startedAt?: unknown }>} openedFiles
 * @param {string} serverName
 */
export function pruneOpenedFilesForServer(openedFiles, serverName) {
  for (const [fileUri, entry] of openedFiles) {
    if (entry.serverName === serverName) {
      openedFiles.delete(fileUri)
    }
  }
}
