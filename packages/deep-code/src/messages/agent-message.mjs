export const AGENT_MESSAGE_ROLES = Object.freeze({
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
})

export function createAgentMessage(role, fields = {}) {
  if (!Object.values(AGENT_MESSAGE_ROLES).includes(role)) {
    throw new Error(`Unsupported agent message role: ${role}`)
  }
  return { role, ...fields }
}

export function createAgentToolCall({
  id,
  name,
  arguments: args = '{}',
}) {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  }
}
