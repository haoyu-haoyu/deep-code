// Replace matches of `search` (a literal string, or a GLOBAL RegExp) in `content`
// with `value` inserted LITERALLY.
//
// String.prototype.replace / replaceAll interpret `$$`, `$&`, `` $` ``, `$'`, and
// `$<n>` as special replacement patterns when the replacement is a STRING — so
// passing a user-controlled value as the replacement silently corrupts any value
// containing those sequences (a price like `$$5`, a file path, a regex, a hook
// payload). A FUNCTION replacer's return value is inserted verbatim, with no
// `$`-pattern interpretation, so this is the safe way to splice user text in.
//
// Used for $ARGUMENTS / named-argument substitution in slash-command, skill, and
// hook prompts. (Note: `replaceAll` with a string `search` replaces every literal
// occurrence; with a RegExp the RegExp must be global — both behave as before,
// only the `$`-interpretation of `value` changes.)
export function replaceAllLiteral(content, search, value) {
  return content.replaceAll(search, () => value)
}
