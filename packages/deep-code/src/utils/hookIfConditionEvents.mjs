// Hook events whose input carries {tool_name, tool_input} and therefore
// support an `if` condition (evaluated against the tool-input pattern, e.g.
// `if: "Bash(git *)"`). These are exactly the events that resolve matchQuery to
// `hookInput.tool_name` in executeHooks' event switch.
//
// PermissionDenied belongs here — it shares that tool_name branch and its input
// carries tool_input — but was historically omitted from the guard in
// prepareIfConditionMatcher, so any PermissionDenied hook that carried an `if`
// was silently dropped and never fired (the retry nudge was lost). Keeping the
// canonical set in one place keeps that guard in sync with the matchQuery
// switch.
export const IF_CONDITION_TOOL_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
])

export function eventSupportsIfCondition(eventName) {
  return IF_CONDITION_TOOL_EVENTS.has(eventName)
}
