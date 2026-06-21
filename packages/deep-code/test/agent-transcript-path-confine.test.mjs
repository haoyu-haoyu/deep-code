import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, normalize, sep } from 'node:path'

// getAgentTranscriptPath (sessionStorage.ts, bun-tainted) builds
//   join(<base>, `agent-${safeToolResultIdComponent(agentId)}.jsonl`)
// where <base> = <projectDir>/<sessionId>/subagents[/<subdir>]. The CCR v2 resume
// path derives agentId from a REMOTE agent_id via the unvalidated asAgentId() cast,
// so this pins that the shared safe-component primitive keeps the derived path
// inside the subagents dir for an adversarial id, while a well-formed id round-trips.
import { safeToolResultIdComponent } from '../src/utils/safeToolResultIdComponent.mjs'

const base = '/home/u/.deepcode/projects/cwd/session-123/subagents'

function agentTranscriptPath(agentId) {
  return join(base, `agent-${safeToolResultIdComponent(agentId)}.jsonl`)
}

test('a well-formed agentId round-trips into the expected in-dir path', () => {
  for (const id of ['a0123456789abcdef', 'a-explore-0123456789abcdef', 'a-general-purpose-fedcba9876543210']) {
    const p = agentTranscriptPath(id)
    assert.equal(p, `${base}/agent-${id}.jsonl`)
    assert.ok(normalize(p).startsWith(base + sep))
  }
})

test('THE FIX: a traversal agent_id cannot escape the subagents dir', () => {
  for (const evil of [
    '../../../../tmp/evil',
    '../../../../../../etc/cron.d/x',
    '..',
    'a/../../b',
    '..\\..\\win',
    '/etc/passwd',
    'sub/dir/id',
  ]) {
    const p = agentTranscriptPath(evil)
    assert.ok(
      normalize(p).startsWith(base + sep),
      `evil=${JSON.stringify(evil)} escaped: ${p}`,
    )
    // and the filename is a single component (no separators introduced)
    const filename = p.slice(base.length + 1)
    assert.ok(!filename.slice(0, -'.jsonl'.length).includes('/'))
  }
})

test('the confinement is deterministic per id (write and read-back derive the same path)', () => {
  const evil = '../../planted'
  assert.equal(agentTranscriptPath(evil), agentTranscriptPath(evil))
  assert.notEqual(agentTranscriptPath('../../a'), agentTranscriptPath('../../b'))
})
