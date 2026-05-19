import { expect, mock, test } from 'bun:test'

mock.module('../messages.js', () => ({
  normalizeAttachmentForAPI: () => [],
}))

mock.module('../slowOperations.js', () => ({
  jsonStringify: JSON.stringify,
}))

const {
  bytesPerTokenForFileType,
  roughTokenCountEstimation,
  roughTokenCountEstimationForFileType,
  roughTokenCountEstimationForMessage,
  roughTokenCountEstimationForMessages,
} = await import('../charEstimation.ts')

test('roughTokenCountEstimation divides char length by default bytesPerToken=4', () => {
  expect(roughTokenCountEstimation('')).toBe(0)
  expect(roughTokenCountEstimation('hello')).toBe(Math.round(5 / 4))
  expect(roughTokenCountEstimation('1234567890123456')).toBe(4)
})

test('roughTokenCountEstimation honors custom bytesPerToken ratio', () => {
  expect(roughTokenCountEstimation('hello world', 2)).toBe(
    Math.round('hello world'.length / 2),
  )
})

test('bytesPerTokenForFileType returns 2 for JSON variants and 4 otherwise', () => {
  expect(bytesPerTokenForFileType('json')).toBe(2)
  expect(bytesPerTokenForFileType('jsonl')).toBe(2)
  expect(bytesPerTokenForFileType('jsonc')).toBe(2)
  expect(bytesPerTokenForFileType('ts')).toBe(4)
  expect(bytesPerTokenForFileType('')).toBe(4)
  expect(bytesPerTokenForFileType('unknown_ext')).toBe(4)
})

test('roughTokenCountEstimationForFileType combines the two helpers', () => {
  const content = '{"a":1}'
  expect(roughTokenCountEstimationForFileType(content, 'json')).toBe(
    Math.round(content.length / 2),
  )
  expect(roughTokenCountEstimationForFileType(content, 'ts')).toBe(
    Math.round(content.length / 4),
  )
})

test('roughTokenCountEstimationForMessage counts text content for assistant and user roles', () => {
  expect(
    roughTokenCountEstimationForMessage({
      type: 'assistant',
      message: { content: 'short answer' },
    }),
  ).toBe(roughTokenCountEstimation('short answer'))

  expect(
    roughTokenCountEstimationForMessage({
      type: 'user',
      message: { content: 'a user prompt' },
    }),
  ).toBe(roughTokenCountEstimation('a user prompt'))
})

test('roughTokenCountEstimationForMessage handles content block arrays with text and image blocks', () => {
  const result = roughTokenCountEstimationForMessage({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'first block' },
        {
          type: 'image',
          source: { type: 'base64', data: 'x', media_type: 'image/png' },
        },
        { type: 'text', text: 'second' },
      ] as unknown as Parameters<
        typeof roughTokenCountEstimationForMessage
      >[0]['message'] extends {
        content?: infer C
      }
        ? C
        : never,
    },
  })
  expect(result).toBe(
    roughTokenCountEstimation('first block') +
      2000 +
      roughTokenCountEstimation('second'),
  )
})

test('roughTokenCountEstimationForMessage returns 0 for unknown message types or missing content', () => {
  expect(roughTokenCountEstimationForMessage({ type: 'system' })).toBe(0)
  expect(
    roughTokenCountEstimationForMessage({ type: 'assistant', message: {} }),
  ).toBe(0)
  expect(
    roughTokenCountEstimationForMessage({
      type: 'assistant',
      message: { content: undefined },
    }),
  ).toBe(0)
})

test('roughTokenCountEstimationForMessages sums per-message estimates', () => {
  const messages = [
    { type: 'user', message: { content: 'hello' } },
    { type: 'assistant', message: { content: 'world' } },
    { type: 'system' as const },
  ]
  expect(roughTokenCountEstimationForMessages(messages)).toBe(
    roughTokenCountEstimation('hello') +
      roughTokenCountEstimation('world') +
      0,
  )
})
