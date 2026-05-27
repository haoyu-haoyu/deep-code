import { startHttpServer } from './http.mjs'

export async function startServeMode({
  acp = false,
  host,
  http = false,
  port,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  if (http) {
    const server = await startHttpServer({ host, port })
    stdout.write(`Deep Code HTTP server listening on ${server.url}\n`)
    return server
  }

  if (acp) {
    stderr.write('deepcode serve --acp is not implemented yet\n')
    process.exitCode = 1
    return { mode: 'acp_unimplemented' }
  }

  stderr.write('Specify --http to start the HTTP server.\n')
  process.exitCode = 1
  return { mode: 'no_mode_selected' }
}
