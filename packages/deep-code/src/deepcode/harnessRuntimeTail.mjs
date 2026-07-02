// Append the per-turn DeepSeek harness-runtime context to the message TAIL as a
// transient reminder, instead of letting it ride prependUserContext's message[0].
//
// CACHE-MOAT (the #1 invariant, see deepcode/stable-prefix.mjs): the harness-runtime
// classification is recomputed from THIS turn's prompt (resolveDeepCodeHarnessRuntime),
// so its rendered block varies turn-to-turn AND flips present/absent as the task is
// classified active/inactive. When it is placed in userContext it lands in
// prependUserContext's message[0] — the cached PREFIX, before ALL conversation history.
// A per-turn-varying message[0] diverges DeepSeek's automatic byte-prefix cache
// immediately after the system block, re-billing the entire growing conversation as
// cache_creation every turn the classification changes — defeating the fork's core
// prompt-cache moat (and silent to /status, whose prefixHash never hashes messages).
// stable-prefix.mjs mandates that all per-turn TRANSIENT state ride the volatile
// latest-user-message TAIL, never the prefix (exactly how the date-change reminder and
// appendViolationFeedbackTail already behave). This routes the harness block there.
//
// Appended as a brand-new final message (earlier messages are NEVER mutated), so every
// turn's request stays a byte-identical PREFIX of the next. Default-inert: with no
// active harness context the SAME array is returned (object-identity), so the request is
// byte-identical to the no-harness baseline. Never throws — a bad factory returns the
// messages unchanged (the harness nudge is best-effort, must never break the turn).
//
// Pure + deterministic: the message factory is INJECTED (query.ts passes
// createUserMessage(wrapInSystemReminder(text), isMeta)), so it is unit-testable with a
// fake and mirrors appendViolationFeedbackTail's shape.
//
// @param {Array} messages the finalized per-turn messages (already prepend-context'd)
// @param {string|undefined|null} harnessContext the rendered harness-runtime block, if active
// @param {(text: string) => any} makeReminderMessage builds the trailing transient message
// @returns {Array} the same array reference when nothing is appended, else a new array
export function appendHarnessRuntimeTail(messages, harnessContext, makeReminderMessage) {
  if (!Array.isArray(messages)) return messages
  if (typeof harnessContext !== 'string' || harnessContext === '') return messages
  let reminder
  try {
    reminder = makeReminderMessage(harnessContext)
  } catch {
    return messages // fail-safe: bad factory → unchanged, never break the turn
  }
  if (reminder == null) return messages
  return [...messages, reminder]
}
