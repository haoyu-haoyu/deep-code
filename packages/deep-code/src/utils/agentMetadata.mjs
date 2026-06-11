/**
 * Parse a persisted agent-metadata sidecar (`agent-<id>.meta.json`).
 *
 * `writeAgentMetadata` writes the sidecar non-atomically, so a crash mid-write
 * can leave a truncated or garbled file. `readAgentMetadata` is built to
 * degrade gracefully when the sidecar is ABSENT — `resumeAgent` is null-safe
 * everywhere (a missing `agentType` falls back to the general-purpose agent, a
 * missing `worktreePath` to the parent cwd). But a corrupt-but-present sidecar
 * would otherwise throw a `SyntaxError` out of `JSON.parse` and abort the whole
 * resume, defeating that careful degradation. Mapping a parse failure — or a
 * non-object payload (`null`, a primitive, an array), which is never valid
 * metadata — to `null` routes corruption down the exact same graceful path as a
 * missing file. Mirrors the sibling `getAgentTranscript`, which returns `null`
 * on a malformed transcript.
 *
 * @param {string} raw - the sidecar file contents
 * @returns {object | null} the parsed metadata object, or `null` when `raw` is
 *   not valid JSON describing an object
 */
export function parseAgentMetadata(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  return parsed
}
