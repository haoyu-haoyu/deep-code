// Clamp a streamed hook-output chunk so a single hook invocation can't
// accumulate unbounded stdout/stderr and OOM the process. The hook execution
// timeout (TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 min) is far too long to bound a
// fast-emitting runaway — a misconfigured statusLine command that loops, or a
// hook that pipes a large stream — reaches gigabytes of retained string within
// seconds. statusLine in particular runs continuously, and every hook (PreТoolUse,
// PostToolUse, statusLine, fileSuggestion) routes its output through the same
// accumulator.
//
// Returns the leading portion of `chunk` that still fits under `max`, and whether
// the cap was reached so the caller can SIGTERM the child. A legitimate hook
// emits far below the cap, so `keep === chunk` and `exceeded === false` on the
// happy path (byte-identical behavior under the limit).
//
// `currentLength`/`chunk.length` are string lengths (the stream is decoded utf8),
// so the cap bounds retained chars (each ≤ a few bytes) — an approximate but
// sufficient memory bound.
//
// @param {number} currentLength  chars already accumulated in this stream
// @param {string} chunk          the new chunk
// @param {number} max            the per-stream cap (chars)
// @returns {{ keep: string, exceeded: boolean }}
export function clampHookChunk(currentLength, chunk, max) {
  const remaining = max - currentLength
  if (remaining <= 0) return { keep: '', exceeded: true }
  if (chunk.length <= remaining) return { keep: chunk, exceeded: false }
  return { keep: chunk.slice(0, remaining), exceeded: true }
}
