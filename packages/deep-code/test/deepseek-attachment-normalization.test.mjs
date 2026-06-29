import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapMessagesToDeepSeek } from '../src/messages/deepseek-normalizer.mjs'

// Contract guard for the bug fixed in query.ts: mapMessagesToDeepSeek only
// dispatches on role / type:'user' / type:'assistant'. A RAW type:'attachment'
// message matches NONE of those arms and is SILENTLY DROPPED. Per-turn attachment
// getters (getAttachmentMessages, memory/skill prefetch) used to push raw
// attachments into the next request's messages, so file-change notices, IDE
// diagnostics, memory, queued prompts and todo/task reminders never reached the
// model. The fix normalizes them to type:'user' messages first
// (normalizeMessagesForAPI), which this mapper DOES keep — these tests lock in
// that contract.

test('SILENTLY DROPS a raw type:attachment message (why normalization is required)', () => {
  const rawAttachment = {
    type: 'attachment',
    uuid: 'a1',
    timestamp: '2026-01-01T00:00:00Z',
    attachment: {
      type: 'edited_text_file',
      filename: 'src/foo.ts',
      snippet: '12: const x = 1',
    },
  }
  const out = mapMessagesToDeepSeek([rawAttachment])
  assert.equal(out.length, 0) // dropped — the bug the fix routes around
})

test('KEEPS a normalized type:user message (what the fix produces)', () => {
  const userMessage = {
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-01-01T00:00:00Z',
    isMeta: true,
    message: {
      role: 'user',
      content: 'Note: src/foo.ts was modified by a linter. Take it into account.',
    },
  }
  const out = mapMessagesToDeepSeek([userMessage])
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'user')
  assert.ok(JSON.stringify(out[0]).includes('was modified'))
})

test('an attachment interleaved with real turns drops ONLY the attachment', () => {
  const user = {
    type: 'user',
    uuid: 'u',
    message: { role: 'user', content: 'do the thing' },
  }
  const assistant = {
    type: 'assistant',
    uuid: 'a',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  }
  const attachment = {
    type: 'attachment',
    uuid: 'att',
    attachment: { type: 'edited_text_file', filename: 'f.ts', snippet: 'x' },
  }
  const out = mapMessagesToDeepSeek([user, assistant, attachment])
  // user + assistant survive; the attachment (the lost context) is dropped
  assert.equal(out.length, 2)
  assert.deepEqual(
    out.map(m => m.role),
    ['user', 'assistant'],
  )
})
