// DeepSeek's own API returns integer token counts, but a non-strict
// OpenAI-compatible gateway (a LiteLLM / proxy front) can emit a usage field as a
// STRING ("200") or another non-number. Left uncoerced, such a value flows into
// the per-message usage and then into getTokenCountFromUsage's
// `input_tokens + cache_creation + cache_read + output_tokens` sum, where ONE
// string turns `+` into string CONCATENATION (1000 + "200" => "1000200") —
// inflating the reported context size ~1000x and mis-firing autocompact / the
// /context + StatusLine percentage. The runtime sibling mapper (usage.ts
// updateUsage) already guards with a number check; the provider mappers did not,
// so the two live paths diverged.
//
// Coerce every token field to a finite number at the wire boundary (the usage
// mappers) so all downstream arithmetic stays numeric. A numeric string is parsed
// to its value, so the real count is preserved rather than dropped; anything
// non-finite (NaN, a non-numeric string, null/undefined, an object) falls back to
// the fallback (0). A genuine integer is returned unchanged, so a conformant
// DeepSeek usage maps byte-identically.
export function coerceTokenCount(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
