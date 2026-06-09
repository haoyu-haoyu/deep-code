// Return a shallow copy of `object` with every own enumerable key whose value is `undefined`
// removed, preserving the order of the remaining keys. Used across the request builders to
// drop optional fields so they never serialize into the JSON body — keeping the DeepSeek
// prefix-cache request byte-stable (insertion order is preserved by Object.entries/filter/
// fromEntries, so a kept key never moves). A `null`/`false`/`0`/`''` value is kept; only
// `undefined` is dropped. This was an identical inline copy in 7 modules; extracted to one
// leaf so it can't drift. Matches the prior behavior exactly, including throwing on a
// non-object argument (callers always pass an object literal).
export function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  )
}
