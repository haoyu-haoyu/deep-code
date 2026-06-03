import test from 'node:test'
import assert from 'node:assert/strict'

import { computeBatchConcurrency } from '../src/services/tools/batchConcurrency.mjs'

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
