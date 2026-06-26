/**
 * Normalize a tool name parsed from a permission rule: trim surrounding
 * whitespace, then map any legacy alias to its canonical name.
 *
 * The permission matcher compares rule.toolName === tool.name with STRICT
 * equality, so a stray leading/trailing space silently makes the whole rule
 * INERT — a deny that looks active in a settings/policy file but never fires
 * (fail-open): `" Bash(rm:*)"` parses to tool name `" Bash"`, which never equals
 * the canonical `"Bash"`. CLI-supplied rules are already trimmed (permissionSetup
 * trims both the tool name and the content), so without this the SAME deny rule
 * works on the CLI but is dropped from settings — an asymmetry, not intent.
 *
 * Trimming here makes every source parse consistently. A whitespace-only name
 * collapses to "" so the parser's empty-name handling / validation's empty check
 * rejects it instead of storing an inert rule.
 *
 * @param {string} name  the raw tool name as parsed from the rule string
 * @param {Record<string, string>} legacyAliases  legacy -> canonical name map
 * @returns {string} the trimmed, alias-resolved tool name
 */
export function normalizeRuleToolName(name, legacyAliases) {
  const trimmed = name.trim()
  return legacyAliases[trimmed] ?? trimmed
}
