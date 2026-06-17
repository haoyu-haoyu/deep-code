// A plan slug read from a (resumed) transcript flows unsanitized into
// `join(getPlansDirectory(), `${slug}.md`)` and on to getPlan() reads (injected
// into the model input) and ExitPlanMode / fork writes. A slug like
// `../../../../tmp/evil` therefore escapes the plans directory — arbitrary file
// read/write driven by opening an untrusted session file (`--resume`/`--fork`).
//
// Constrain it to a single safe path segment, the same defense the worktree-slug
// surface already applies (validateWorktreeSlug), but intentionally stricter:
// no `.` either, so a lone `.`/`..` segment — the traversal vector — can never
// pass. Legitimate slugs are `adjective-verb-noun` from generateWordSlug (letters
// + hyphens), so this rejects nothing real. The `-agent-<id>` suffix is appended
// AFTER the validated base, so it is unaffected.
const VALID_PLAN_SLUG = /^[A-Za-z0-9_-]+$/

/**
 * @param {unknown} slug
 * @returns {boolean} true iff `slug` is a safe single-segment plan slug.
 */
export function isValidPlanSlug(slug) {
  return typeof slug === 'string' && VALID_PLAN_SLUG.test(slug)
}
