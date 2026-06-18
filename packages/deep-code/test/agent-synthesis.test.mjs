import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractFilesTouched,
  buildFilesTouchedManifest,
  extractAssistantNarration,
  parseSynthesisOutput,
  buildSubagentSynthesisBlock,
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

// --- extractAssistantNarration (LLM synthesis input) -------------------------

test('extractAssistantNarration: all non-empty assistant text, trimmed, in order', () => {
  const messages = [
    assistant(text('  found the bug in parser  ')),
    assistant(toolUse('Edit', { file_path: '/p.ts' })),
    assistant(text('   '), text('fixed it')),
    user(text('this user text is ignored')),
    assistant(text('Done.')),
  ]
  assert.deepEqual(extractAssistantNarration(messages), [
    'found the bug in parser',
    'fixed it',
    'Done.',
  ])
  assert.deepEqual(extractAssistantNarration([]), [])
})

// --- parseSynthesisOutput (defensive free-text parse) ------------------------

test('parseSynthesisOutput: parses sections + bullets, tolerant of case/glyphs/prose', () => {
  const out = parseSynthesisOutput(
    [
      'Here is the summary:',
      'FINDINGS:',
      '- the parser dropped CRLF',
      '* a second finding',
      'Decisions',
      '• kept the BOM for utf16le',
      'random prose with no bullet is ignored',
      'next steps:',
      '- wire it into ci',
    ].join('\n'),
  )
  assert.deepEqual(out, {
    findings: ['the parser dropped CRLF', 'a second finding'],
    decisions: ['kept the BOM for utf16le'],
    followups: ['wire it into ci'], // "next steps" aliases to followups
  })
})

test('parseSynthesisOutput: returns null on empty / no-bullet / non-string', () => {
  assert.equal(parseSynthesisOutput(''), null)
  assert.equal(parseSynthesisOutput('FINDINGS:\nno bullets here just prose'), null)
  assert.equal(parseSynthesisOutput(undefined), null)
  assert.equal(parseSynthesisOutput('   '), null)
})

test('parseSynthesisOutput: caps items and item length', () => {
  const many = ['FINDINGS:', ...Array.from({ length: 30 }, (_, i) => `- f${i}`)].join('\n')
  assert.equal(parseSynthesisOutput(many).findings.length, 12)
  const long = `FINDINGS:\n- ${'x'.repeat(900)}`
  assert.equal(parseSynthesisOutput(long).findings[0].length, 500)
})

test('parseSynthesisOutput: markdown header decoration (**bold**, ## heading) is stripped', () => {
  // DeepSeek (esp. flash) loves markdown. A header wrapped in emphasis/heading
  // syntax must still be recognized as the section label, not discarded.
  const out = parseSynthesisOutput(
    [
      '**FINDINGS:**',
      '- bolded header finding',
      '## Decisions',
      '- heading-style decision',
      '**Follow-ups**',
      '- emphasized bare label followup',
    ].join('\n'),
  )
  assert.deepEqual(out, {
    findings: ['bolded header finding'],
    decisions: ['heading-style decision'],
    followups: ['emphasized bare label followup'],
  })
})

test('parseSynthesisOutput: inline content after a header colon becomes the first item', () => {
  const out = parseSynthesisOutput(
    ['FINDINGS: the parser dropped CRLF', 'Decisions : kept the fallback'].join('\n'),
  )
  assert.deepEqual(out, {
    findings: ['the parser dropped CRLF'],
    decisions: ['kept the fallback'],
    followups: [],
  })
})

test('parseSynthesisOutput: "* item" / "- item" bullets survive the emphasis strip', () => {
  // The leading-star emphasis strip must NOT eat a "* " bullet glyph.
  const out = parseSynthesisOutput(
    ['FINDINGS:', '* star-bullet finding', '- dash-bullet finding'].join('\n'),
  )
  assert.deepEqual(out.findings, ['star-bullet finding', 'dash-bullet finding'])
})

test('parseSynthesisOutput: a prose line containing a colon is NOT a header', () => {
  // Only KNOWN section labels open a section; arbitrary "Word: ..." prose must
  // not hijack the current section or start a new one.
  const out = parseSynthesisOutput(
    ['FINDINGS:', '- real finding', 'Note: this prose has a colon but is not a section'].join('\n'),
  )
  assert.deepEqual(out, {
    findings: ['real finding'],
    decisions: [],
    followups: [],
  })
})

// --- buildSubagentSynthesisBlock (cache-prefix-stable output) -----------------

test('buildSubagentSynthesisBlock: fixed order findings/files/decisions/followups', () => {
  const block = buildSubagentSynthesisBlock({
    findings: ['the bug was a CRLF drop'],
    decisions: ['kept the existing fallback'],
    followups: ['add a fuzz test'],
    filesTouched: { read: ['/a.ts'], modified: ['/b.ts'] },
  })
  assert.equal(
    block,
    '<subagent-synthesis>\n' +
      'findings:\n- the bug was a CRLF drop\n' +
      'modified: /b.ts\nread: /a.ts\n' +
      'decisions:\n- kept the existing fallback\n' +
      'followups:\n- add a fuzz test\n' +
      '</subagent-synthesis>',
  )
})

test('buildSubagentSynthesisBlock: omits empty sections; "" when all empty', () => {
  assert.equal(
    buildSubagentSynthesisBlock({ findings: ['only findings'] }),
    '<subagent-synthesis>\nfindings:\n- only findings\n</subagent-synthesis>',
  )
  assert.equal(
    buildSubagentSynthesisBlock({ filesTouched: { modified: ['/x'] } }),
    '<subagent-synthesis>\nmodified: /x\n</subagent-synthesis>',
  )
  assert.equal(buildSubagentSynthesisBlock({}), '')
  assert.equal(buildSubagentSynthesisBlock({ findings: [], filesTouched: { read: [] } }), '')
})
