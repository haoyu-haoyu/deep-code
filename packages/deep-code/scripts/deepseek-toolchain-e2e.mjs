#!/usr/bin/env node

// Live tool-chain E2E: drive the REAL DeepSeek agent loop through the local
// tool chain (Read -> Edit -> Write -> Bash) on a throwaway workspace and
// assert each file mutation actually landed. Reports the cache hit rate from
// the run so the moat is exercised under a multi-tool turn, not just a plain
// query.
//
// Hard-gated on DEEPCODE_REAL_E2E=1 (skips cleanly otherwise) so it is safe to
// run in CI without a key — the nightly live-e2e workflow sets the flag + key.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDeepSeekLocalToolChain } from '../src/deepcode/local-toolchain.mjs'
import { resolveDeepSeekConfig } from '../src/deepcode/deepseek-native.mjs'
import { resolveLiveE2EEnv } from './lib/deepseek-e2e-env.mjs'

const REAL_E2E_FLAG = 'DEEPCODE_REAL_E2E'

async function main() {
  if (process.env[REAL_E2E_FLAG] !== '1') {
    console.log(
      'DeepSeek tool-chain E2E skipped: set DEEPCODE_REAL_E2E=1 and configure DEEPSEEK_API_KEY, DEEPCODE_API_KEY, or ~/.deepcode/settings.json env to run live tool-chain validation.',
    )
    return
  }
  const env = await resolveLiveE2EEnv()
  if (!resolveDeepSeekConfig({ env, cwd: process.cwd() }).apiKey) {
    console.error(
      'DeepSeek tool-chain E2E failed: missing DEEPSEEK_API_KEY or DEEPCODE_API_KEY.',
    )
    process.exitCode = 1
    return
  }

  const ws = mkdtempSync(join(tmpdir(), 'deepcode-toolchain-e2e-'))
  writeFileSync(join(ws, 'greeting.txt'), 'hello world\n')
  try {
    const result = await runDeepSeekLocalToolChain({
      prompt: [
        'Do these steps in order using the tools:',
        '1. Read greeting.txt.',
        '2. Use Edit to change the word "hello" to "goodbye" in greeting.txt.',
        '3. Use Write to create a NEW file notes.txt whose entire content is exactly: edited by deepseek',
        '4. Use Bash to cat greeting.txt to confirm.',
        'Then answer with exactly: tool-chain-ok',
      ].join('\n'),
      cwd: ws,
      env,
    })

    const greeting = existsSync(join(ws, 'greeting.txt'))
      ? readFileSync(join(ws, 'greeting.txt'), 'utf8')
      : ''
    const notes = existsSync(join(ws, 'notes.txt'))
      ? readFileSync(join(ws, 'notes.txt'), 'utf8')
      : ''
    const editApplied = /goodbye world/.test(greeting)
    const writeApplied = /edited by deepseek/.test(notes)
    const rate = result.cacheDiagnostics?.promptCacheHitRate

    console.log('DeepSeek tool-chain E2E')
    console.log(`answer: ${JSON.stringify((result.content ?? '').slice(0, 80))}`)
    console.log(`edit applied (goodbye world): ${editApplied}`)
    console.log(`write applied (notes.txt): ${writeApplied}`)
    console.log(
      `cache hit rate: ${rate != null ? `${(rate * 100).toFixed(1)}%` : 'n/a'}`,
    )

    if (!editApplied || !writeApplied) {
      console.error(
        'DeepSeek tool-chain E2E failed: expected Edit (goodbye world) and Write (notes.txt) to be applied.',
      )
      process.exitCode = 1
      return
    }
    console.log('DeepSeek tool-chain E2E passed')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('DeepSeek tool-chain E2E error:', error?.message ?? error)
  process.exitCode = 1
})
