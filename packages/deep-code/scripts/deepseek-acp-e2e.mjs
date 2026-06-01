#!/usr/bin/env node

// Live ACP E2E: drive the REAL DeepSeek ACP agent over the stdio transport and
// prove the session-scoped permission grant (`allow_always`) is remembered —
// turn 1 creates a file (one permission round-trip, answered allow_always);
// turn 2 creates another file with the same tool and must NOT trigger a new
// permission request. Also asserts both files were written.
//
// Hard-gated on DEEPCODE_REAL_E2E=1 (skips cleanly otherwise) so it is safe to
// run in CI without a key — the nightly live-e2e workflow sets the flag + key.

import { PassThrough } from 'node:stream'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAcpServer } from '../src/cli/serve/acp/index.mjs'
import { resolveDeepSeekConfig } from '../src/deepcode/deepseek-native.mjs'
import { resolveLiveE2EEnv } from './lib/deepseek-e2e-env.mjs'

const REAL_E2E_FLAG = 'DEEPCODE_REAL_E2E'

async function main() {
  if (process.env[REAL_E2E_FLAG] !== '1') {
    console.log(
      'ACP allow_always E2E skipped: set DEEPCODE_REAL_E2E=1 and configure DEEPSEEK_API_KEY, DEEPCODE_API_KEY, or ~/.deepcode/settings.json env to run live ACP validation.',
    )
    return
  }
  const env = await resolveLiveE2EEnv()
  if (!resolveDeepSeekConfig({ env, cwd: process.cwd() }).apiKey) {
    console.error(
      'ACP allow_always E2E failed: missing DEEPSEEK_API_KEY or DEEPCODE_API_KEY.',
    )
    process.exitCode = 1
    return
  }

  const ws = mkdtempSync(join(tmpdir(), 'deepcode-acp-e2e-'))
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const out = []
  const permRequests = []
  let buf = ''
  stdout.on('data', d => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      out.push(msg)
      if (msg.method === 'session/request_permission') {
        permRequests.push(msg)
        // Client answers: allow for the rest of the session.
        stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { outcome: { outcome: 'selected', optionId: 'allow_always' } },
          }) + '\n',
        )
      }
    }
  })
  const handle = startAcpServer({ stdin, stdout, env })
  const send = o => stdin.write(JSON.stringify(o) + '\n')
  const waitFor = async (pred, ms = 120000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
      const v = out.find(pred)
      if (v) return v
      await new Promise(r => setTimeout(r, 50))
    }
    throw new Error('ACP allow_always E2E timed out waiting for a response')
  }

  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })
    await waitFor(m => m.id === 1)
    send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: ws } })
    const sid = (await waitFor(m => m.id === 2)).result.sessionId

    send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: sid, prompt: 'Use the Write tool to create a file named hello.txt whose entire content is exactly: hi from deepseek' } })
    const r3 = await waitFor(m => m.id === 3)
    const permsAfter1 = permRequests.length
    const helloOk = existsSync(join(ws, 'hello.txt')) && /hi from deepseek/.test(readFileSync(join(ws, 'hello.txt'), 'utf8'))

    send({ jsonrpc: '2.0', id: 4, method: 'session/prompt', params: { sessionId: sid, prompt: 'Use the Write tool to create a file named bye.txt whose entire content is exactly: bye from deepseek' } })
    const r4 = await waitFor(m => m.id === 4)
    const permsAfter2 = permRequests.length
    const byeOk = existsSync(join(ws, 'bye.txt')) && /bye from deepseek/.test(readFileSync(join(ws, 'bye.txt'), 'utf8'))

    const remembered = permsAfter2 === permsAfter1 && permsAfter1 >= 1

    console.log('ACP allow_always E2E')
    console.log(`stopReason turn1/turn2: ${r3.result?.stopReason} / ${r4.result?.stopReason}`)
    console.log(`permission prompts after turn1: ${permsAfter1}`)
    console.log(`permission prompts after turn2: ${permsAfter2}`)
    console.log(`grant remembered (turn2 added none): ${remembered}`)
    console.log(`hello.txt written: ${helloOk}; bye.txt written: ${byeOk}`)

    stdin.end()
    await handle.closed

    if (!helloOk || !byeOk || !remembered) {
      console.error(
        'ACP allow_always E2E failed: expected both files written and the allow_always grant to be remembered (turn2 must add no new permission requests).',
      )
      process.exitCode = 1
      return
    }
    console.log('ACP allow_always E2E passed')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('ACP allow_always E2E error:', error?.message ?? error)
  process.exitCode = 1
})
