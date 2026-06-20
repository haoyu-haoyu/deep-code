import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectQueueDrainBatch } from '../src/utils/queueBatchSelection.mjs'

// selectQueueDrainBatch(orderedMainThread, isSlashCommand) selects the contiguous
// leading run to run together in the next REPL drain. orderedMainThread is in
// EFFECTIVE DISPATCH ORDER. The bug it fixes: a position-agnostic scan jumped a
// sandwiched /clear past later prompts, breaking FIFO.

const isSlash = cmd => typeof cmd.value === 'string' && cmd.value.trim().startsWith('/')
const P = value => ({ mode: 'prompt', value }) // a plain prompt
const S = value => ({ mode: 'prompt', value }) // a slash command (value starts with /)
const B = value => ({ mode: 'bash', value }) // a bash command

test('the reported bug: [prompt, /clear, prompt] batches ONLY the leading prompt (not both)', () => {
  const queue = [P('summarize foo'), S('/clear'), P('refactor it')]
  const batch = selectQueueDrainBatch(queue, isSlash)
  assert.deepEqual(
    batch.map(c => c.value),
    ['summarize foo'],
    'stops at the sandwiched /clear → /clear keeps its position and runs next',
  )
})

test('a slash head runs alone', () => {
  assert.deepEqual(
    selectQueueDrainBatch([S('/compact'), P('a'), P('b')], isSlash).map(c => c.value),
    ['/compact'],
  )
})

test('a bash head runs alone', () => {
  assert.deepEqual(
    selectQueueDrainBatch([B('!git status'), P('a')], isSlash).map(c => c.value),
    ['!git status'],
  )
})

test('contiguous same-mode prompts ARE batched together (the legitimate batching is preserved)', () => {
  const queue = [P('a'), P('b'), P('c')]
  assert.deepEqual(
    selectQueueDrainBatch(queue, isSlash).map(c => c.value),
    ['a', 'b', 'c'],
  )
})

test('stops at a sandwiched BASH command (different mode), preserving its position', () => {
  const queue = [P('a'), B('!cat out.txt'), P('b')]
  assert.deepEqual(selectQueueDrainBatch(queue, isSlash).map(c => c.value), ['a'])
})

test('stops at a different-mode prompt-vs-other head follower', () => {
  // a prompt head followed by a different mode (e.g. task-notification) stops there
  const queue = [P('a'), { mode: 'task-notification', value: 'x' }, P('b')]
  assert.deepEqual(selectQueueDrainBatch(queue, isSlash).map(c => c.value), ['a'])
})

test('a single leading prompt with nothing after → just that prompt', () => {
  assert.deepEqual(selectQueueDrainBatch([P('only')], isSlash).map(c => c.value), ['only'])
})

test('empty queue → empty batch (processQueueIfReady returns processed:false)', () => {
  assert.deepEqual(selectQueueDrainBatch([], isSlash), [])
})

test('returns the SAME object references (so remove() by identity works)', () => {
  const a = P('a')
  const b = P('b')
  const batch = selectQueueDrainBatch([a, b], isSlash)
  assert.equal(batch[0], a)
  assert.equal(batch[1], b)
})

test('successive drains of [P, /clear, P] yield P, then /clear, then P (FIFO across cycles)', () => {
  // simulate the manager: remove the batch from the array, re-select
  let queue = [P('p1'), S('/clear'), P('p2')]
  const drain = () => {
    const batch = selectQueueDrainBatch(queue, isSlash)
    queue = queue.filter(c => !batch.includes(c))
    return batch.map(c => c.value)
  }
  assert.deepEqual(drain(), ['p1'])
  assert.deepEqual(drain(), ['/clear'])
  assert.deepEqual(drain(), ['p2'])
  assert.deepEqual(drain(), [])
})
