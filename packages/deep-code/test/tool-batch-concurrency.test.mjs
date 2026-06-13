import test from 'node:test'
import assert from 'node:assert/strict'

import { computeBatchConcurrency } from '../src/services/tools/batchConcurrency.mjs'
import { computeStreamingAdmission } from '../src/services/tools/streamingAdmission.mjs'
import { getMaxToolUseConcurrency } from '../src/services/tools/maxToolConcurrency.mjs'

// ── agent fan-out concurrency policy ─────────────────────────────────────────
// A concurrency-safe batch that contains the Agent/Task tool is bounded by the
// harness maxAgents cap (previously parsed + displayed but never enforced —
// agents fanned out at the generic tool cap instead). Every other batch keeps
// the generic per-turn tool cap. Applied at the scheduler's all(gens, cap).

const AGENTS = ['Agent', 'Task']

test('a non-agent batch uses the generic cap unchanged', () => {
  assert.equal(
    computeBatchConcurrency({
      toolNames: ['Read', 'Grep', 'Glob'],
      agentToolNames: AGENTS,
      genericCap: 10,
      maxAgents: 4,
    }),
    10,
  )
})

test('an agent batch is tightened to maxAgents', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent', 'Agent', 'Agent'], agentToolNames: AGENTS, genericCap: 10, maxAgents: 4 }),
    4,
  )
})

test("the legacy 'Task' agent name is recognized", () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Task', 'Task'], agentToolNames: AGENTS, genericCap: 10, maxAgents: 4 }),
    4,
  )
})

test('a mixed batch containing any agent is tightened to maxAgents', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Read', 'Agent', 'Read', 'Grep'], agentToolNames: AGENTS, genericCap: 10, maxAgents: 4 }),
    4,
  )
})

test('the generic cap is also a ceiling: maxAgents above it never raises concurrency', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent'], agentToolNames: AGENTS, genericCap: 3, maxAgents: 8 }),
    3, // min(8, 3)
  )
})

test('a lower generic cap still bounds agents', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent'], agentToolNames: AGENTS, genericCap: 2, maxAgents: 4 }),
    2,
  )
})

test('accepts a Set of agent names', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent'], agentToolNames: new Set(['Agent']), genericCap: 10, maxAgents: 4 }),
    4,
  )
})

test('defends against invalid caps', () => {
  // invalid genericCap → falls back to 10
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Read'], agentToolNames: AGENTS, genericCap: NaN, maxAgents: 4 }),
    10,
  )
  // invalid maxAgents on an agent batch → no extra cap (generic)
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent'], agentToolNames: AGENTS, genericCap: 10, maxAgents: 0 }),
    10,
  )
  // fractional caps floor
  assert.equal(
    computeBatchConcurrency({ toolNames: ['Agent'], agentToolNames: AGENTS, genericCap: 10, maxAgents: 4.9 }),
    4,
  )
})

test('an empty batch yields the generic cap', () => {
  assert.equal(
    computeBatchConcurrency({ toolNames: [], agentToolNames: AGENTS, genericCap: 10, maxAgents: 4 }),
    10,
  )
})

// ── streaming executor admission (count cap, not just compatibility) ─────────
// The streaming executor previously admitted any concurrency-safe tool onto a
// concurrency-safe batch with NO count cap → unbounded fan-out. computeStreamingAdmission
// adds the generic per-turn cap and the Agent/Task maxAgents sub-cap.

test('admits the first tool regardless of safety (matches the prior length===0 branch)', () => {
  for (const safe of [true, false]) {
    assert.equal(
      computeStreamingAdmission({
        candidateIsConcurrencySafe: safe,
        runningCount: 0,
        runningAllConcurrencySafe: true,
        genericCap: 10,
        maxAgents: 4,
      }),
      true,
    )
  }
})

test('a non-concurrency-safe candidate is never admitted alongside a running batch', () => {
  assert.equal(
    computeStreamingAdmission({
      candidateIsConcurrencySafe: false,
      runningCount: 1,
      runningAllConcurrencySafe: true,
      genericCap: 10,
      maxAgents: 4,
    }),
    false,
  )
})

test('a concurrency-safe candidate is admitted only up to the generic cap', () => {
  const base = {
    candidateIsConcurrencySafe: true,
    runningAllConcurrencySafe: true,
    genericCap: 10,
    maxAgents: 4,
  }
  assert.equal(computeStreamingAdmission({ ...base, runningCount: 9 }), true, 'under cap')
  assert.equal(computeStreamingAdmission({ ...base, runningCount: 10 }), false, 'at cap')
  assert.equal(computeStreamingAdmission({ ...base, runningCount: 11 }), false, 'over cap')
})

test('a candidate cannot join a batch that contains a non-concurrency-safe running tool', () => {
  assert.equal(
    computeStreamingAdmission({
      candidateIsConcurrencySafe: true,
      runningCount: 1,
      runningAllConcurrencySafe: false,
      genericCap: 10,
      maxAgents: 4,
    }),
    false,
  )
})

test('an Agent candidate is bounded by maxAgents, tighter than the generic cap', () => {
  const base = {
    candidateIsConcurrencySafe: true,
    candidateIsAgent: true,
    runningAllConcurrencySafe: true,
    genericCap: 10,
    maxAgents: 4,
  }
  // below maxAgents → admitted even though well under the generic cap
  assert.equal(computeStreamingAdmission({ ...base, runningCount: 3, runningAgentCount: 3 }), true)
  // at maxAgents → blocked, despite being under the generic 10
  assert.equal(computeStreamingAdmission({ ...base, runningCount: 4, runningAgentCount: 4 }), false)
})

test('maxAgents above the generic cap never raises concurrency; invalid caps clamp', () => {
  // maxAgents 100 but generic 10 → still bounded by 10
  assert.equal(
    computeStreamingAdmission({
      candidateIsConcurrencySafe: true,
      candidateIsAgent: true,
      runningCount: 10,
      runningAgentCount: 10,
      runningAllConcurrencySafe: true,
      genericCap: 10,
      maxAgents: 100,
    }),
    false,
  )
  // invalid genericCap falls back to 10
  assert.equal(
    computeStreamingAdmission({
      candidateIsConcurrencySafe: true,
      runningCount: 5,
      runningAllConcurrencySafe: true,
      genericCap: 0,
      maxAgents: 4,
    }),
    true,
  )
})

test('getMaxToolUseConcurrency: env overrides, default 10, invalid falls back', () => {
  assert.equal(getMaxToolUseConcurrency({}), 10)
  assert.equal(getMaxToolUseConcurrency({ DEEPCODE_MAX_TOOL_USE_CONCURRENCY: '3' }), 3)
  assert.equal(getMaxToolUseConcurrency({ CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '7' }), 7)
  assert.equal(getMaxToolUseConcurrency({ DEEPCODE_MAX_TOOL_USE_CONCURRENCY: 'abc' }), 10)
  // DEEPCODE_ takes precedence over CLAUDE_CODE_
  assert.equal(
    getMaxToolUseConcurrency({
      DEEPCODE_MAX_TOOL_USE_CONCURRENCY: '5',
      CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '9',
    }),
    5,
  )
})
