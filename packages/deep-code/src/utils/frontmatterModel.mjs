// Resolve a skill/command frontmatter `model:` value to the string that should
// be handed to parseUserSpecifiedModel, or undefined when no model is specified.
//
// The skill and plugin-command loaders previously did:
//   frontmatter.model === 'inherit'
//     ? undefined
//     : frontmatter.model
//       ? parseUserSpecifiedModel(frontmatter.model as string)
//       : undefined
// The `frontmatter.model ?` test is a plain truthiness check, so a NON-string
// truthy value — `model: 4`, `model: true`, or a YAML list `model: [a, b]` —
// reaches parseUserSpecifiedModel, whose first line is `modelInput.trim()`. A
// number/boolean/array has no `.trim()`, so it throws a TypeError that the
// per-entry try/catch swallows, and the WHOLE skill/command silently disappears
// from the menu. The agent loader already guards with `typeof === 'string'`;
// this brings the skill and command loaders in line.
//
// Behaviour is otherwise identical: 'inherit' → undefined (skills/commands map
// inherit to "no override", unlike agents which keep the literal 'inherit'),
// every non-empty string is returned verbatim (including whitespace-only, which
// the old truthiness check also passed through), and all falsy values
// (undefined, null, '', 0, false) → undefined. The only change is that a truthy
// NON-string now yields undefined instead of throwing.
export function resolveFrontmatterModel(raw) {
  if (raw === 'inherit') return undefined
  if (typeof raw === 'string' && raw.length > 0) return raw
  return undefined
}
