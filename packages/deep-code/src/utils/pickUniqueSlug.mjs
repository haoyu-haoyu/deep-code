// Pick a slug that does not collide with an existing plan file.
//
// `getPlanSlug` draws a random word slug and retries up to N times if the file
// already exists. The previous loop, when ALL N draws collided, fell through
// holding the LAST (colliding) slug and cached/returned it anyway — so a plan
// write would clobber an existing session's plan file. The collision run is
// astronomically unlikely (the word-slug space is huge), but the function's
// contract is "a unique slug", so honor it: on exhaustion, force uniqueness
// with a suffix instead of returning a slug known to collide.
//
/**
 * @param {() => string} generate draw a candidate slug.
 * @param {(slug: string) => boolean} exists whether a slug already collides.
 * @param {(slug: string) => string} uniquify make a colliding slug unique
 *   (e.g. append a random suffix). Called at most once, only on exhaustion.
 * @param {number} maxRetries how many draws to try before uniquifying.
 * @returns {string} a slug that does not collide (best-effort on exhaustion).
 */
export function pickUniqueSlug(generate, exists, uniquify, maxRetries) {
  let slug = ''
  for (let i = 0; i < maxRetries; i++) {
    slug = generate()
    if (!exists(slug)) {
      return slug
    }
  }
  // Every draw collided (astronomically rare): suffix the last one so the
  // caller never persists over an existing plan file.
  return uniquify(slug)
}
