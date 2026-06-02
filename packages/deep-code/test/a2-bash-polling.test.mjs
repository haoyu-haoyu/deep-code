import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readBranchedEnvInt } from '../src/utils/branchedEnv.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('TaskOutput.ts: poll interval default is 200ms', () => {
  // Direct import would pull the whole src/* dependency tree, so we
  // assert the constant via static read on the source. The value is
  // critical for the "long Bash commands stream output ~5x faster"
  // user-facing improvement that A2 promised.
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /readBranchedEnvInt\(\s*\[\s*'DEEPCODE_BASH_POLL_INTERVAL_MS'/,
    'TaskOutput must read DEEPCODE_BASH_POLL_INTERVAL_MS for the active poll cadence',
  )
  assert.match(
    source,
    /POLL_INTERVAL_ACTIVE_MS = readBranchedEnvInt\([^)]*,\s*200,?\s*\)/,
    'POLL_INTERVAL_ACTIVE_MS default must be 200ms (5 Hz)',
  )
})

test('TaskOutput.ts: idle-skip threshold is 5 with adaptive backoff', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(
    source,
    /IDLE_TICK_SKIP_THRESHOLD = readBranchedEnvInt\([^)]*,\s*5,?\s*\)/,
    'idle-skip threshold default must be 5 ticks',
  )
  assert.match(
    source,
    /#consecutiveEmptyTicks/,
    'TaskOutput must track per-instance consecutiveEmptyTicks for backoff',
  )
  assert.match(
    source,
    /#pollSkipParity/,
    'TaskOutput must use a parity bit so multiple idle tasks interleave their skipped ticks',
  )
})

test('TaskOutput.ts: env override is respected by readBranchedEnvInt path', () => {
  // readBranchedEnvInt is unit-tested elsewhere; here we just confirm
  // the env-var pair is wired correctly so a user setting
  // DEEPCODE_BASH_POLL_INTERVAL_MS=50 actually gets a 50ms cadence.
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_POLL_INTERVAL_MS', 'CLAUDE_CODE_BASH_POLL_INTERVAL_MS'],
      200,
      { DEEPCODE_BASH_POLL_INTERVAL_MS: '50' },
    ),
    50,
  )
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_POLL_INTERVAL_MS', 'CLAUDE_CODE_BASH_POLL_INTERVAL_MS'],
      200,
      { CLAUDE_CODE_BASH_POLL_INTERVAL_MS: '500' },
    ),
    500,
  )
  assert.equal(
    readBranchedEnvInt(
      ['DEEPCODE_BASH_POLL_INTERVAL_MS', 'CLAUDE_CODE_BASH_POLL_INTERVAL_MS'],
      200,
      {},
    ),
    200,
  )
})

test('BashTool.tsx: progress display threshold is 500ms', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/tools/BashTool/BashTool.tsx'),
    'utf8',
  )
  assert.match(
    source,
    /const PROGRESS_DISPLAY_THRESHOLD_MS = 500/,
    'display threshold must be 500ms (down from upstream 2000ms)',
  )
  assert.match(
    source,
    /const BACKGROUND_HINT_THRESHOLD_MS = 2000/,
    'background hint threshold stays at 2000ms (only fires for genuinely long commands)',
  )
})

test('BashTool.tsx: race uses display threshold, not the legacy 2s', () => {
  const source = readFileSync(
    resolve(packageRoot, 'src/tools/BashTool/BashTool.tsx'),
    'utf8',
  )
  // The initial Promise.race that waits before starting progress UI
  // must use the SHORT threshold so output streams as soon as a
  // command is noticeably long.
  assert.match(
    source,
    /setTimeout\([^,]+,\s*PROGRESS_DISPLAY_THRESHOLD_MS,/,
    'initial timeout in BashTool must use PROGRESS_DISPLAY_THRESHOLD_MS',
  )
  // The "press Ctrl+B" hint must still gate on the LONG threshold so
  // we don't show it on every command.
  assert.match(
    source,
    /elapsedSeconds >= BACKGROUND_HINT_THRESHOLD_MS \/ 1000/,
    'background hint must gate on BACKGROUND_HINT_THRESHOLD_MS (2s)',
  )
})

test('legacy single-name PROGRESS_THRESHOLD_MS no longer exists in BashTool', () => {
  // Sanity-check: after the split, BashTool.tsx must not declare
  // its own PROGRESS_THRESHOLD_MS — the two callers should use the
  // explicit display / background-hint names. This catches a future
  // accidental revert that re-adds the old single threshold.
  const source = readFileSync(
    resolve(packageRoot, 'src/tools/BashTool/BashTool.tsx'),
    'utf8',
  )
  assert.doesNotMatch(
    source,
    /^const PROGRESS_THRESHOLD_MS\b/m,
    'BashTool must not redeclare PROGRESS_THRESHOLD_MS after the A2 split',
  )
})

test('TaskOutput.ts: stale tailFile resolutions are dropped via generation guard', () => {
  // The race Codex flagged: two ticks fire while one tailFile read is still in
  // flight. If the older read resolves AFTER the newer, its bookkeeping would
  // walk #lastSeenBytesTotal backward and falsely increment
  // #consecutiveEmptyTicks. The generation LIFECYCLE (bump per-tick, on
  // startPolling, on stopPolling) lives in TaskOutput; the actual GUARD now
  // lives in the pure taskOutputPoll core and is RUNTIME-tested in
  // test/a2-bash-polling-core.test.mjs ("a stale generation drops the read").
  const source = readFileSync(
    resolve(packageRoot, 'src/utils/task/TaskOutput.ts'),
    'utf8',
  )
  assert.match(source, /#pollGeneration/, 'TaskOutput must track per-instance pollGeneration')
  assert.match(
    source,
    /entry\.#pollGeneration\+\+/,
    'pollGeneration must be bumped per-tick to detect stale resolutions',
  )
  assert.match(
    source,
    /instance\.#pollGeneration\+\+/,
    'pollGeneration must also be bumped on startPolling restart',
  )
  // The tick passes the captured + current generation to the core and
  // EARLY-RETURNS when the core reports the read stale.
  assert.match(
    source,
    /capturedGen:\s*gen[\s\S]{0,120}currentGen:\s*entry\.#pollGeneration/,
    'tick must hand the captured + current generation to processTailRead',
  )
  assert.match(
    source,
    /if \(result\.stale\)\s*\{[\s\S]{0,40}return/,
    'tick must early-return when the core flags the read stale',
  )
  // stopPolling MUST also bump the generation. Without this, a late tailFile
  // resolution after React unmount can leak one onProgress call into a
  // torn-down component.
  assert.match(
    source,
    /static stopPolling[\s\S]{0,300}#pollGeneration\+\+/,
    'stopPolling must bump #pollGeneration before detaching the entry',
  )
  // The actual guard predicate lives in the extracted core.
  const core = readFileSync(
    resolve(packageRoot, 'src/utils/task/taskOutputPoll.mjs'),
    'utf8',
  )
  assert.match(
    core,
    /capturedGen !== currentGen[\s\S]{0,40}return \{ stale: true \}/,
    'the core must drop the read when the captured generation is behind the current one',
  )
})
