// Offline fallback classifier for auto-mode routing — used only when the LLM
// router times out / errors (the primary path is the ROUTER_SYSTEM model call).
// Maps the user's latest message to a {model, thinking} decision across the
// FULL DeepSeek effort ladder (off < low < medium < high < max < xhigh).
//
// Design (V4 adaptation — see deepcode-v4-audit): effort is chosen per TASK and
// held across the task's tool-loop turns, so it must match the task's overall
// difficulty. reasoning_effort is NOT in DeepSeek's prompt cache key
// (probe-confirmed), so varying it across tasks is cache-safe; the only real
// trade-off is quality vs latency/cost, which is ASYMMETRIC — under-reasoning a
// hard task is worse than over-spending on an easy one. Two consequences:
//   1. When unsure, lean to a capable tier (the catch-all is 'high', never low).
//   2. A read-only / lookup question (asking ABOUT code) is checked BEFORE the
//      complex-change branch, so an incidental "tests"/"debug"/"refactor" token
//      in a QUESTION (e.g. "are there any tests?") does not over-route to max.
// The top tier (xhigh ≈ 2x max) is reserved for the genuinely hardest reasoning.

const SPEED = /\b(quick|quickly|fast|brief|briefly|short|speed|tldr)\b/
const READ_ONLY =
  /\b(read|inspect|explain|summari[sz]e|describe|list|show|what|which|who|where|when|why|how)\b/
const HARDEST =
  /\b(architecture|architectural|distributed|concurren\w*|race[-\s]?condition|algorithm|formal|invariant|prove|proof|exhaustive\w*|rigorous\w*)\b/
const DEEP_REQUEST = /\b(deep|deeply|careful|carefully|reason|reasoning)\b/
const COMPLEX =
  /\b(refactor|rewrite|migrate|debug|debugging|tests?|test repair|multi[-\s]?file|several files|multiple files|across files|integration|implement)\b/
const EDIT = /\b(edit|modify|change|update|fix)\b/
const FILE_PATH =
  /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|cpp|c|h|hpp|css|scss|html|ya?ml)\b/i

/**
 * @param {string} latestUserMessage
 * @returns {{ model: 'flash' | 'pro', thinking: 'off'|'low'|'medium'|'high'|'max'|'xhigh', reason: string }}
 */
export function classifyRouteHeuristic(latestUserMessage) {
  const text = String(latestUserMessage ?? '').trim()
  const lower = text.toLowerCase()
  const readOnly = text.endsWith('?') || READ_ONLY.test(lower)

  // 1. Explicit speed request always wins — the user asked for fast.
  if (SPEED.test(lower)) return d('flash', 'off', 'speed_requested')

  // 2. Read-only / lookup intent (asking ABOUT something, not doing it).
  //    Checked BEFORE the complex-change branch so an incidental complex-topic
  //    token in a question does not over-route to max. Substantive topics still
  //    get some reasoning (asymmetric bias), trivial lookups stay cheap.
  if (readOnly && !EDIT.test(lower)) {
    if (HARDEST.test(lower)) return d('pro', 'medium', 'read_only_hard_topic')
    if (COMPLEX.test(lower)) return d('pro', 'low', 'read_only_complex_topic')
    if (text.length < 200) return d('flash', 'off', 'read_only_trivial')
    return d('flash', 'low', 'read_only_lookup')
  }

  // 3. Genuinely hardest reasoning → the top tier; explicit depth requests → max.
  if (HARDEST.test(lower)) return d('pro', 'xhigh', 'hardest_reasoning')
  if (DEEP_REQUEST.test(lower)) return d('pro', 'max', 'deep_reasoning_requested')

  // 4. Complex multi-step changes.
  if (COMPLEX.test(lower)) return d('pro', 'max', 'complex_change')

  // 5. Single-file edit.
  if (EDIT.test(lower) && FILE_PATH.test(text)) {
    return d('pro', 'high', 'single_file_edit')
  }

  // 6. Asymmetric default: when unsure, lean to a capable tier (NOT low).
  return d('pro', 'high', 'general_task')
}

function d(model, thinking, reason) {
  return { model, thinking, reason }
}
