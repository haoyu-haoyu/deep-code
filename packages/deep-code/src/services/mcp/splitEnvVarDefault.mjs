// Split a `${...}` env-var reference's inner text into the variable name and an
// optional `:-default` value, for MCP config expansion.
//
// The default may itself contain ':-' (e.g. `${FLAG:-30:-fallback}`). The old
// `varContent.split(':-', 2)` was meant to preserve that, but
// String.prototype.split(sep, limit) TRUNCATES and DISCARDS everything past the
// limit — so `${VAR:-30:-fallback}` yielded the default '30' instead of
// '30:-fallback', silently chopping the value. Split on the FIRST ':-' only and
// keep the whole remainder as the default.
//
// `defaultValue` is undefined when there is no ':-' (so the caller's
// `defaultValue !== undefined` no-default branch is byte-identical); an empty
// default (`${VAR:-}`) yields '' as before.
export function splitEnvVarDefault(varContent) {
  const sepIdx = varContent.indexOf(':-')
  if (sepIdx === -1) return { varName: varContent, defaultValue: undefined }
  return {
    varName: varContent.slice(0, sepIdx),
    defaultValue: varContent.slice(sepIdx + 2),
  }
}
