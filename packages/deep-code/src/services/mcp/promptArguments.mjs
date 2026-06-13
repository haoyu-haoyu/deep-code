import { parse as shellParse } from 'shell-quote'

// Parse a slash-command argument string into the ordered token array used for an
// MCP `prompts/get` request's `arguments`.
//
// The MCP prompt path previously did `args.split(' ')`, which (a) does not honor
// quotes — a quoted multi-word value is split on its internal spaces AND keeps the
// literal quote characters — and (b) emits empty tokens for runs of whitespace and a
// spurious `['']` for empty input. The corrupted tokens were then zipped into the
// `arguments` Record sent verbatim to the MCP server.
//
// This mirrors the project's canonical parseArguments (src/utils/argumentSubstitution.ts),
// which the plugin and skill prompt paths already use: shell-quote tokenization that
// honors quotes and collapses whitespace, `$VAR` preserved literally (the env callback
// returns the token unchanged), and a whitespace-split fallback if parsing throws.
// (argumentSubstitution.ts is TypeScript and not directly node-loadable; this is the
// node-testable .mjs the MCP client imports — keep the two in sync.)
export function parseShellArguments(argsString) {
  if (!argsString || !argsString.trim()) return []
  let tokens
  try {
    tokens = shellParse(argsString, key => `$${key}`)
  } catch {
    return argsString.split(/\s+/).filter(Boolean)
  }
  // shell-quote returns operator objects ({op:'|'} etc.) alongside string tokens;
  // keep only the literal string arguments, matching parseArguments.
  return tokens.filter(token => typeof token === 'string')
}
