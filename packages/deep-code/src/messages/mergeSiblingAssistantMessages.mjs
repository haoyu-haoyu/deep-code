// Merge CONSECUTIVE Claude-Code assistant messages that share a `message.id` into a
// single message, so the DeepSeek wire mapper emits ONE assistant with all tool_calls.
//
// WHY: a parallel-tool turn is persisted as N sibling assistant messages — same
// `message.id`, one tool_use each — the upstream Anthropic "one AssistantMessage per
// content_block_stop" shape, and exactly what recoverOrphanedParallelToolResults
// reconstructs on resume (sessionStorage.ts). mapMessagesToDeepSeek emits one wire
// assistant PER input message, so those siblings become
//   assistant[X] | assistant[Y] | tool[X] | tool[Y]
// where X is now a DANGLING tool_call (the next message is a non-tool assistant, which
// breaks X's run) and tool[X] is an ORPHAN tool_result — DeepSeek/OpenAI hard-reject the
// request with a 400. Because the sibling messages stay in the append-only transcript,
// every subsequent turn/resume rebuilds the identical invalid request and re-400s: a
// PERMANENT session wedge. normalizeMessagesForAPI performs this same merge
// (mergeAssistantMessages, messages.ts) but is NEVER run over the conversation on the
// DeepSeek send path (query.ts only calls it on single-message arrays).
//
// Merging the ADJACENT siblings yields `assistant[X,Y] | tool[X] | tool[Y]`, which is
// valid (both tools answer the single preceding assistant run). The TR-interleaved shape
// `assistant[X] | tool[X] | assistant[Y] | tool[Y]` is ALREADY valid (each tool answers
// its immediately-preceding assistant) and is correctly left untouched — those assistants
// are not adjacent, so this pass never merges them.
//
// Cache-moat safe: a NO-OP (byte-identical wire output) for a normal session, because the
// native writer (deepseek-call-model.mjs) emits ONE assistant per turn holding all
// tool_uses, so no two adjacent messages ever share a `message.id`. The merge only
// activates on a resumed legacy / content-block-split / recovery-reconstructed transcript.
//
// Pure: message list in, message list out. Mirrors mergeAssistantMessages semantics
// (concat content, keep the first sibling's other fields).
//
// @param {any[]} messages
// @returns {any[]}

function isClaudeCodeAssistant(m) {
  // A Claude-Code assistant message (type:'assistant', nested `message`), NOT an
  // already-wire-shaped OpenAI-style message (top-level `role`, no `message.id`).
  return Boolean(m) && !m.role && m.type === 'assistant'
}

function assistantMessageId(m) {
  return m.message?.id
}

export function mergeSiblingAssistantMessages(messages) {
  if (!Array.isArray(messages)) return messages
  const out = []
  for (const message of messages) {
    const id = isClaudeCodeAssistant(message)
      ? assistantMessageId(message)
      : undefined
    const prev = out[out.length - 1]
    if (
      id !== undefined &&
      id !== null &&
      prev !== undefined &&
      isClaudeCodeAssistant(prev) &&
      assistantMessageId(prev) === id &&
      // Only merge when both hold block arrays. mapClaudeCodeAssistantMessage
      // guards non-array content with String(content); spreading a string here
      // would shatter it into chars and lose the text, so leave off-schema
      // content for the mapper's own guard (unreachable today —
      // createAssistantMessage normalizes all content to an array).
      Array.isArray(prev.message?.content) &&
      Array.isArray(message.message?.content)
    ) {
      // Merge into the accumulating sibling. Keeping the FIRST sibling's fields (and
      // id) means 3+ siblings chain: X<-Y makes XY (id X), then XY<-Z makes XYZ.
      out[out.length - 1] = {
        ...prev,
        message: {
          ...prev.message,
          content: [
            ...(prev.message?.content ?? []),
            ...(message.message?.content ?? []),
          ],
        },
      }
    } else {
      out.push(message)
    }
  }
  return out
}
