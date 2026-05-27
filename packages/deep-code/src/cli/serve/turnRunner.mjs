export async function* runTurn({ input, signal }) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt : ''
  if (!prompt) {
    throw new Error('prompt is required')
  }

  const runtime = await import('../../services/runtime/messageSend.js')
  for await (const event of runtime.queryRuntimeWithStreaming({
    maxThinkingTokens: 0,
    messages: [{ content: prompt, role: 'user' }],
    model:
      process.env.DEEPSEEK_MODEL ??
      process.env.DEEPCODE_MODEL ??
      'deepseek-v4-pro',
    signal,
    systemPrompt: [],
    tools: [],
  })) {
    const mapped = mapRuntimeEvent(event)
    if (mapped) yield mapped
  }
}

function mapRuntimeEvent(event) {
  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta'
  ) {
    return { text: event.delta.text, type: 'text_delta' }
  }

  if (
    event.type === 'content_block_start' &&
    event.contentBlock?.type === 'tool_use'
  ) {
    return {
      id: event.contentBlock.id,
      input: event.contentBlock.input,
      name: event.contentBlock.name,
      type: 'tool_call',
    }
  }

  if (event.type === 'tool_use_delta') {
    return {
      id: event.id,
      name: event.name,
      partial_json: event.partialJson,
      type: 'tool_call',
    }
  }

  return null
}
