import { startHttpServer } from './http.mjs'
import { startAcpServer } from './acp/index.mjs'

export async function startServeMode({
  acp = false,
  host,
  http = false,
  port,
  stderr = process.stderr,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (acp) {
    // ACP (Agent Client Protocol) over stdio: serve --acp delegates with
    // stdio:'inherit', so stdin/stdout are the editor's pipes. Stay alive until
    // the editor closes stdin.
    const { closed } = startAcpServer({ stdin, stdout, env: process.env })
    await closed
    // The editor closed stdin: flush any buffered output, then exit promptly.
    // The full-CLI bundle leaves other handles on the loop, so returning isn't
    // enough to end the process.
    await new Promise(resolve => stdout.write('', resolve))
    process.exit(0)
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
