/**
 * Core of $ARGUMENTS substitution: a SINGLE left-to-right pass over `content`
 * that replaces every placeholder with its value verbatim.
 *
 * Why one pass (and not four sequential .replace calls): the placeholders share
 * a keyspace with the VALUES being spliced in. A skill/command argument can
 * itself contain a literal '$1', '$ARGUMENTS', or '$ARGUMENTS[0]' (e.g. the user
 * runs `/cmd '$ARGUMENTS'`). With sequential passes, an earlier pass inserts such
 * a value and a LATER pass re-scans it and expands it again — a double-expansion
 * that leaks one placeholder's value into another's slot. Resolving every
 * placeholder in one scan, with a function replacer that returns each value
 * verbatim, makes substituted text inert: it is never re-examined.
 *
 * The function replacer is also what makes the splice safe against '$$', '$&',
 * a backtick-dollar, and "$'" inside a value (String#replace would interpret
 * those as replacement patterns if the replacement were a string).
 *
 * Precedence mirrors the original sequential order so behavior is unchanged for
 * every realistic template (placeholders separated by ordinary text):
 *   1. named arguments  ($foo)            -- matched first, like the original
 *      first pass; a name is only a whole token: not $foo[..] and not $foobar
 *   2. indexed          ($ARGUMENTS[0])   -- before bare $ARGUMENTS so the
 *                                            longer form wins
 *   3. bare             ($ARGUMENTS)      -- literal, no trailing boundary
 *                                            (matches the old literal replace)
 *   4. shorthand index  ($0, $1, ...)     -- not followed by a word char
 *
 * One intentional improvement over the old code: when two placeholders are
 * GLUED with no separator and the right one expands to a word-starting value
 * (e.g. '$1$ARGUMENTS[0]' with args ['a','b']), each now resolves to its own
 * value ('ba'). The old four passes mutated the string, so expanding the right
 * placeholder first shifted the '$1' shorthand's trailing (?!word) boundary and
 * left '$1' LITERAL ('$1a') -- an ordering artifact, not intent. Resolving every
 * placeholder against the untouched template removes it.
 *
 * @param {string} content        the prompt body containing placeholders
 * @param {string[]} parsedArgs    positionally-parsed arguments (parsedArgs[i]
 *                                  is the value for argumentNames[i] and for $i)
 * @param {string} fullArgs        the raw arguments string (value of bare $ARGUMENTS)
 * @param {string[]} argumentNames named-argument names, by position
 * @returns {string} content with every placeholder resolved in one pass
 */
export function substituteArgumentsCore(
  content,
  parsedArgs,
  fullArgs,
  argumentNames = [],
) {
  // Escape a name so it is a literal alternative in the combined pattern. The
  // names come from third-party command/skill/plugin frontmatter, so without
  // escaping a name like `(a+)+` would be a catastrophic-backtracking pattern
  // and a name like `[` would make `new RegExp` throw.
  const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Build the named-argument alternative only from non-empty names (the original
  // loop `continue`d empty entries). indexOf below maps a matched name back to
  // its ORIGINAL position in argumentNames (which aligns with parsedArgs), so the
  // unfiltered array is what we search.
  const nonEmptyNames = argumentNames.filter(name => name)

  const namedAlt =
    nonEmptyNames.length > 0
      ? `\\$(?<name>${nonEmptyNames.map(escapeRegExp).join('|')})(?![[\\w])|`
      : ''

  const combined = new RegExp(
    namedAlt +
      // indexed before bare so $ARGUMENTS[0] is not shadowed by $ARGUMENTS
      '\\$ARGUMENTS\\[(?<idx>\\d+)\\]' +
      '|\\$ARGUMENTS' +
      '|\\$(?<sidx>\\d+)(?!\\w)',
    'g',
  )

  return content.replace(combined, (...matchArgs) => {
    const groups = matchArgs[matchArgs.length - 1]
    if (groups.name !== undefined) {
      const i = argumentNames.indexOf(groups.name)
      return parsedArgs[i] ?? ''
    }
    if (groups.idx !== undefined) {
      return parsedArgs[parseInt(groups.idx, 10)] ?? ''
    }
    if (groups.sidx !== undefined) {
      return parsedArgs[parseInt(groups.sidx, 10)] ?? ''
    }
    // bare $ARGUMENTS
    return fullArgs
  })
}
