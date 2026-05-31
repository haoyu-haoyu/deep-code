import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePlanTodos, planTodosToTasks } from '../src/utils/planTodos.mjs'

test('parsePlanTodos extracts top-level ordered + unordered + checkbox steps', () => {
  const plan = `# Plan

Some intro prose that is not a step.

1. First do the thing
2. Then the second thing
- A bullet step
* Another bullet
- [ ] An unchecked task
- [x] A checked task`
  assert.deepEqual(parsePlanTodos(plan), [
    'First do the thing',
    'Then the second thing',
    'A bullet step',
    'Another bullet',
    'An unchecked task',
    'A checked task',
  ])
})

test('parsePlanTodos ignores headings, prose, code fences, and nested/indented items', () => {
  const plan = `## Approach
Intro line, not a step.

- top level step
  - nested detail (ignored)
    - deeper detail (ignored)

\`\`\`
- this is inside a code fence (ignored)
1. also fenced (ignored)
\`\`\`

- second top level step`
  assert.deepEqual(parsePlanTodos(plan), [
    'top level step',
    'second top level step',
  ])
})

test('parsePlanTodos strips emphasis/backticks/checkbox and de-dupes, preserving order', () => {
  const plan = `- **Bold step** with \`code\`
- bold step with code
- Unique step`
  // first two normalize to the same text -> de-duped (case-insensitive)
  assert.deepEqual(parsePlanTodos(plan), ['Bold step with code', 'Unique step'])
})

test('parsePlanTodos caps at max and returns [] for empty/non-string', () => {
  const many = Array.from({ length: 30 }, (_, i) => `- step ${i}`).join('\n')
  assert.equal(parsePlanTodos(many, { max: 5 }).length, 5)
  assert.deepEqual(parsePlanTodos(''), [])
  assert.deepEqual(parsePlanTodos('   '), [])
  assert.deepEqual(parsePlanTodos(undefined), [])
  assert.deepEqual(parsePlanTodos('Just prose, no list items at all.'), [])
})

test('planTodosToTasks maps steps to pending TaskCreate data with a truncated subject', () => {
  const long = 'x'.repeat(120)
  const tasks = planTodosToTasks(`- short step\n- ${long}`)
  assert.equal(tasks.length, 2)
  assert.deepEqual(tasks[0], {
    subject: 'short step',
    description: 'short step',
    status: 'pending',
  })
  assert.equal(tasks[1].status, 'pending')
  assert.ok(tasks[1].subject.length <= 80, 'subject is truncated for the title')
  assert.equal(tasks[1].description, long, 'description keeps the full step')
  assert.ok(tasks[1].subject.endsWith('…'))
})
