import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parsePrunableEphemeralOrphans } from '../src/utils/worktreePrunableOrphans.mjs'

// Mirror of the relevant EPHEMERAL_WORKTREE_PATTERNS shapes (agent + workflow).
const isEphemeralSlug = slug =>
  /^agent-a[0-9a-f]{7}$/.test(slug) ||
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/.test(slug)

const block = lines => lines.join('\n')

test('a prunable ephemeral worktree with a branch is returned (branch stripped of refs/heads/)', () => {
  const out = block([
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/agent-a1234567',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/worktree-agent-a1234567',
    'prunable gitdir file points to non-existent location',
  ])
  const orphans = parsePrunableEphemeralOrphans(out, isEphemeralSlug)
  assert.deepEqual(orphans, [
    {
      path: '/repo/.claude/worktrees/agent-a1234567',
      slug: 'agent-a1234567',
      branch: 'worktree-agent-a1234567',
    },
  ])
})

test('a prunable NON-ephemeral (user-named) worktree is NOT returned', () => {
  const out = block([
    'worktree /repo/.claude/worktrees/my-feature',
    'HEAD 3333333333333333333333333333333333333333',
    'branch refs/heads/worktree-my-feature',
    'prunable gitdir file points to non-existent location',
  ])
  assert.deepEqual(parsePrunableEphemeralOrphans(out, isEphemeralSlug), [])
})

test('a NON-prunable ephemeral worktree (dir still present) is NOT returned', () => {
  const out = block([
    'worktree /repo/.claude/worktrees/agent-a1234567',
    'HEAD 4444444444444444444444444444444444444444',
    'branch refs/heads/worktree-agent-a1234567',
  ])
  assert.deepEqual(parsePrunableEphemeralOrphans(out, isEphemeralSlug), [])
})

test('a LOCKED prunable ephemeral worktree is excluded (never force-delete a locked branch)', () => {
  const out = block([
    'worktree /repo/.claude/worktrees/agent-a1234567',
    'HEAD 5555555555555555555555555555555555555555',
    'branch refs/heads/worktree-agent-a1234567',
    'locked',
    'prunable gitdir file points to non-existent location',
  ])
  assert.deepEqual(parsePrunableEphemeralOrphans(out, isEphemeralSlug), [])
})

test('a detached-HEAD prunable ephemeral worktree is returned with branch null', () => {
  const out = block([
    'worktree /repo/.claude/worktrees/wf_0123abcd-ef0-3',
    'HEAD 6666666666666666666666666666666666666666',
    'detached',
    'prunable gitdir file points to non-existent location',
  ])
  assert.deepEqual(parsePrunableEphemeralOrphans(out, isEphemeralSlug), [
    {
      path: '/repo/.claude/worktrees/wf_0123abcd-ef0-3',
      slug: 'wf_0123abcd-ef0-3',
      branch: null,
    },
  ])
})

test('multiple worktrees: only the prunable ephemeral ones are returned', () => {
  const out = block([
    'worktree /repo',
    'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/agent-a1234567',
    'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'branch refs/heads/worktree-agent-a1234567',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /repo/.claude/worktrees/agent-a89abcde',
    'HEAD cccccccccccccccccccccccccccccccccccccccc',
    'branch refs/heads/worktree-agent-a89abcde',
    '',
    'worktree /repo/.claude/worktrees/wf_12345678-abc-0',
    'HEAD dddddddddddddddddddddddddddddddddddddddd',
    'branch refs/heads/worktree-wf_12345678-abc-0',
    'prunable gitdir file points to non-existent location',
  ])
  const orphans = parsePrunableEphemeralOrphans(out, isEphemeralSlug)
  assert.deepEqual(
    orphans.map(o => o.slug),
    ['agent-a1234567', 'wf_12345678-abc-0'],
  )
})

test('CRLF line endings and a trailing blank line parse correctly', () => {
  const out =
    'worktree /repo/.claude/worktrees/agent-a1234567\r\n' +
    'HEAD 7777777777777777777777777777777777777777\r\n' +
    'branch refs/heads/worktree-agent-a1234567\r\n' +
    'prunable gitdir file points to non-existent location\r\n\r\n'
  const orphans = parsePrunableEphemeralOrphans(out, isEphemeralSlug)
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].slug, 'agent-a1234567')
  assert.equal(orphans[0].branch, 'worktree-agent-a1234567')
})

test('a Windows-style backslash path yields the basename slug', () => {
  const out = block([
    'worktree C:\\repo\\.claude\\worktrees\\agent-a1234567',
    'HEAD 8888888888888888888888888888888888888888',
    'branch refs/heads/worktree-agent-a1234567',
    'prunable gitdir file points to non-existent location',
  ])
  const orphans = parsePrunableEphemeralOrphans(out, isEphemeralSlug)
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].slug, 'agent-a1234567')
})

test('empty / whitespace input yields no orphans', () => {
  assert.deepEqual(parsePrunableEphemeralOrphans('', isEphemeralSlug), [])
  assert.deepEqual(parsePrunableEphemeralOrphans('   \n\n  ', isEphemeralSlug), [])
  assert.deepEqual(parsePrunableEphemeralOrphans(null, isEphemeralSlug), [])
  assert.deepEqual(parsePrunableEphemeralOrphans(undefined, isEphemeralSlug), [])
})
