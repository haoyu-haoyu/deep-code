#!/usr/bin/env node
/**
 * Generate a deterministic large-session JSONL fixture for resume-time
 * perf measurements. Output is written to:
 *   packages/deep-code/test/fixtures/large-session-1k-msgs.jsonl
 *
 * Format mirrors the production transcript JSONL — one user/assistant
 * pair per turn, with parentUuid pointers chaining the conversation
 * forward, plus a trailing leaf marker so loadTranscriptFile picks
 * up the chain. Fields outside the parser's required set are omitted
 * to keep the fixture readable.
 *
 * Run via:
 *   node scripts/perf/generate-fixture.mjs [--count=1000] [--out=<path>]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultOut = join(
  packageRoot,
  'test',
  'fixtures',
  'large-session-1k-msgs.jsonl',
)

const args = parseArgs(process.argv.slice(2))
const count = Number(args.count ?? 1000)
const outPath = args.out ?? defaultOut

if (!Number.isInteger(count) || count <= 0) {
  console.error(
    `--count must be a positive integer (got ${JSON.stringify(args.count ?? '1000')})`,
  )
  process.exit(1)
}

const dir = dirname(outPath)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const sessionId = '00000000-0000-4000-8000-000000000000'
const cwd = '/tmp/deepcode-perf-fixture'
const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0)

const lines = []
let parentUuid = null

for (let i = 0; i < count; i++) {
  const userUuid = padUuid(`u-${i}`)
  const assistantUuid = padUuid(`a-${i}`)
  const userTimestamp = new Date(startedAt + i * 2_000).toISOString()
  const assistantTimestamp = new Date(startedAt + i * 2_000 + 1_000).toISOString()

  lines.push(
    JSON.stringify({
      parentUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId,
      version: '0.1.0',
      gitBranch: 'main',
      type: 'user',
      message: {
        role: 'user',
        content: `User turn ${i}: write a function that does work item ${i}.`,
      },
      uuid: userUuid,
      timestamp: userTimestamp,
    }),
  )

  lines.push(
    JSON.stringify({
      parentUuid: userUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId,
      version: '0.1.0',
      gitBranch: 'main',
      type: 'assistant',
      message: {
        id: `msg_perf_${i}`,
        type: 'message',
        role: 'assistant',
        model: 'deepseek-v4-pro',
        content: [
          {
            type: 'text',
            text:
              'Sure — here is a draft of work item ' +
              i +
              '. ' +
              'It includes a short explanation and an example. '.repeat(4),
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100 + i,
          output_tokens: 80 + i,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      uuid: assistantUuid,
      timestamp: assistantTimestamp,
    }),
  )

  parentUuid = assistantUuid
}

writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')
const sizeKb = Math.round(Buffer.byteLength(lines.join('\n'), 'utf8') / 1024)
console.log(
  `Wrote ${count * 2} entries (${count} turns) to ${outPath} (${sizeKb} KB)`,
)

function padUuid(prefix) {
  // RFC4122-shaped, deterministic, parser-friendly.
  const padded = prefix.padEnd(8, '0').slice(0, 8)
  return `${padded}-0000-4000-8000-000000000000`
}

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) out[m[1]] = m[2]
  }
  return out
}
