import { test } from 'node:test'
import assert from 'node:assert/strict'

import { countWorktreeChanges } from '../src/utils/worktreeChangeCount.mjs'

// A fake execFile that returns queued {stdout, code} responses in call order,
// and records the args each call received.
function fakeExecFile(responses) {
  const calls = []
  const exec = async (cmd, args) => {
    calls.push({ cmd, args })
    return responses[calls.length - 1]
  }
  exec.calls = calls
  return exec
}

test('clean tree → { changedFiles: 0, commits: 0 }', async () => {
  const exec = fakeExecFile([
    { stdout: '', code: 0 }, // status
    { stdout: '0\n', code: 0 }, // rev-list
  ])
  assert.deepEqual(await countWorktreeChanges('/wt', 'abc123', exec), {
    changedFiles: 0,
    commits: 0,
  })
})

test('dirty tree with commits → correct counts', async () => {
  const exec = fakeExecFile([
    { stdout: ' M a.txt\n?? b.txt\n', code: 0 },
    { stdout: '3\n', code: 0 },
  ])
  assert.deepEqual(await countWorktreeChanges('/wt', 'abc123', exec), {
    changedFiles: 2,
    commits: 3,
  })
})

test('FAIL-CLOSED: git status non-zero exit → null (never a silent 0/0)', async () => {
  // The whole point: a status error must NOT be reported as a clean tree, or a
  // caller would silently `git worktree remove --force` and destroy work.
  const exec = fakeExecFile([{ stdout: '', code: 128 }])
  assert.equal(await countWorktreeChanges('/wt', 'abc123', exec), null)
  // rev-list must not even run once status failed.
  assert.equal(exec.calls.length, 1)
})

test('FAIL-CLOSED: rev-list non-zero exit → null', async () => {
  const exec = fakeExecFile([
    { stdout: '', code: 0 }, // status clean
    { stdout: '', code: 129 }, // rev-list errors (bad ref)
  ])
  assert.equal(await countWorktreeChanges('/wt', 'abc123', exec), null)
})

test('FAIL-CLOSED: no baseline commit → null even when status succeeds', async () => {
  const exec = fakeExecFile([{ stdout: '', code: 0 }])
  assert.equal(await countWorktreeChanges('/wt', undefined, exec), null)
  // rev-list is not attempted without a baseline.
  assert.equal(exec.calls.length, 1)
})

test('status uses --no-optional-locks and -C worktreePath (avoids the lock-contention failure)', async () => {
  const exec = fakeExecFile([
    { stdout: '', code: 0 },
    { stdout: '0', code: 0 },
  ])
  await countWorktreeChanges('/my/wt', 'base', exec)
  assert.deepEqual(exec.calls[0].args, [
    '-C',
    '/my/wt',
    '--no-optional-locks',
    'status',
    '--porcelain',
  ])
  assert.deepEqual(exec.calls[1].args, [
    '-C',
    '/my/wt',
    'rev-list',
    '--count',
    'base..HEAD',
  ])
})

test('non-numeric rev-list output → commits 0 (parseInt || 0)', async () => {
  const exec = fakeExecFile([
    { stdout: ' M x\n', code: 0 },
    { stdout: 'not-a-number\n', code: 0 },
  ])
  assert.deepEqual(await countWorktreeChanges('/wt', 'base', exec), {
    changedFiles: 1,
    commits: 0,
  })
})
