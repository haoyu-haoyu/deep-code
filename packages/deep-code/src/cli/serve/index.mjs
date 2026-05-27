import { startHttpServer } from './http.mjs'

export async function startServeMode({
  acp = false,
  host,
  http = false,
  port,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  if (acp) {
    stderr.write('ACP protocol mode is not yet implemented. Reserved for future phase.\n')
    process.exit(78)
  }

  if (http) {
    const server = await startHttpServer({ host, port })
    stdout.write(`Deep Code HTTP server listening on ${server.url}\n`)
    return server
  }

  stderr.write('Specify --http to start the HTTP server.\n')
  process.exitCode = 1
  return { mode: 'no_mode_selected' }
}
