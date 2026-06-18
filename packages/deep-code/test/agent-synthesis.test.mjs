import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractFilesTouched,
  buildFilesTouchedManifest,
} from '../src/tools/AgentTool/agentSynthesis.mjs'

// Helpers to build transcript fragments the way MessageType shapes them.
const assistant = (...blocks) => ({ type: 'assistant', message: { content: blocks } })
const user = (...blocks) => ({ type: 'user', message: { content: blocks } })
const text = t => ({ type: 'text', text: t })
const toolUse = (name, input) => ({ type: 'tool_use', name, input })

// --- extractFilesTouched ------------------------------------------------------

test('extractFilesTouched: separates read from modified, first-seen order', () => {
  const messages = [
    assistant(toolUse('Read', { file_path: '/a.ts' })),
    assistant(toolUse('Read', { file_path: '/b.ts' }), toolUse('Edit', { file_path: '/c.ts' })),
    assistant(toolUse('Write', { file_path: '/d.ts' })),
  ]
  assert.deepEqual(extractFilesTouched(messages), {
    read: ['/a.ts', '/b.ts'],
    modified: ['/c.ts', '/d.ts'],
  })
})

test('extractFilesTouched: a modified file is NOT also listed as read', () => {
  const messages = [
    assistant(toolUse('Read', { file_path: '/x.ts' })),
    assistant(toolUse('Edit', { file_path: '/x.ts' })),
  ]
  // /x.ts was read then modified → reported only under modified.
  assert.deepEqual(extractFilesTouched(messages), { read: [], modified: ['/x.ts'] })
})

test('extractFilesTouched: dedupes repeated touches', () => {
  const messages = [
    assistant(toolUse('Read', { file_path: '/a.ts' })),
    assistant(toolUse('Read', { file_path: '/a.ts' })),
    assistant(toolUse('Edit', { file_path: '/b.ts' }), toolUse('Edit', { file_path: '/b.ts' })),
  ]
  assert.deepEqual(extractFilesTouched(messages), { read: ['/a.ts'], modified: ['/b.ts'] })
})

test('extractFilesTouched: notebooks are read via Read, modified via NotebookEdit (notebook_path)', () => {
  const messages = [
    assistant(toolUse('Read', { file_path: '/nb1.ipynb' })),
    assistant(toolUse('NotebookEdit', { notebook_path: '/nb2.ipynb' })),
  ]
  assert.deepEqual(extractFilesTouched(messages), {
    read: ['/nb1.ipynb'],
    modified: ['/nb2.ipynb'],
  })
})

test('extractFilesTouched: ignores non-file tools and pathless inputs', () => {
  const messages = [
    assistant(toolUse('Grep', { pattern: 'foo', path: '/dir' })),
    assistant(toolUse('Bash', { command: 'ls' })),
    assistant(toolUse('Read', {})),
    assistant(toolUse('Read', { file_path: '   ' })),
  ]
  assert.deepEqual(extractFilesTouched(messages), { read: [], modified: [] })
})

test('extractFilesTouched: skips non-assistant messages and malformed content', () => {
  const messages = [
    user(toolUse('Edit', { file_path: '/should-not-count.ts' })),
    null,
    { type: 'assistant', message: { content: 'not-an-array' } },
    assistant(toolUse('Read', { file_path: '/real.ts' })),
  ]
  assert.deepEqual(extractFilesTouched(messages), { read: ['/real.ts'], modified: [] })
})

// --- buildFilesTouchedManifest ------------------------------------------------

test('buildFilesTouchedManifest: empty string when nothing touched', () => {
  assert.equal(buildFilesTouchedManifest([assistant(text('Done.'))]), '')
  assert.equal(buildFilesTouchedManifest([]), '')
})

test('buildFilesTouchedManifest: modified first, then read, tagged', () => {
  const messages = [
    assistant(toolUse('Read', { file_path: '/a.ts' })),
    assistant(toolUse('Edit', { file_path: '/b.ts' })),
  ]
  assert.equal(
    buildFilesTouchedManifest(messages),
    '<subagent-files>\nmodified: /b.ts\nread: /a.ts\n</subagent-files>',
  )
})

test('buildFilesTouchedManifest: read-only and modified-only shapes', () => {
  assert.equal(
    buildFilesTouchedManifest([assistant(toolUse('Read', { file_path: '/a.ts' }))]),
    '<subagent-files>\nread: /a.ts\n</subagent-files>',
  )
  assert.equal(
    buildFilesTouchedManifest([assistant(toolUse('Write', { file_path: '/a.ts' }))]),
    '<subagent-files>\nmodified: /a.ts\n</subagent-files>',
  )
})
