/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * This implementation provides comprehensive protection by:
 * 1. Applying NFKC Unicode normalization to handle composed character sequences
 * 2. Removing dangerous Unicode categories while preserving legitimate text and formatting
 * 3. Supporting recursive sanitization of complex nested data structures
 * 4. Maintaining performance with efficient regex processing
 *
 * The sanitization is always enabled to protect against these attacks.
 *
 * Pure logic lives here (a .mjs sibling) so it is unit-testable under
 * `node --test`. The .ts wrapper re-exports these with the public type
 * overloads for `recursivelySanitizeUnicode`.
 */

/**
 * @param {string} prompt
 * @returns {string}
 */
export function partiallySanitizeUnicode(prompt) {
  let current = prompt
  let previous = ''
  let iterations = 0
  const MAX_ITERATIONS = 10 // Safety limit to prevent infinite loops

  // Iteratively sanitize until no more changes occur or max iterations reached
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current

    // Apply NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC')

    // Remove dangerous Unicode categories using explicit character ranges

    // Method 1: Strip dangerous Unicode property classes
    // This is the primary defence and is the solution that is widely used in OSS libraries.
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')

    // Method 2: Explicit character ranges. There are some subtle issues with the above method
    // failing in certain environments that don't support regexes for unicode property classes,
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '') // Directional formatting characters
      .replace(/[\u2066-\u2069]/g, '') // Directional isolates
      .replace(/[\uFEFF]/g, '') // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, '') // Basic Multilingual Plane private use

    iterations++
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
    )
  }

  return current
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function recursivelySanitizeUnicode(value) {
  // Fast path for the overwhelmingly common scalar inputs (a single string, or a
  // primitive) — return without allocating a work stack.
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value)
  }
  if (value === null || typeof value !== 'object') {
    // numbers, booleans, null, undefined, bigint, symbol — returned unchanged
    return value
  }

  // Iterative (explicit heap-stack) post-order tree transform. The previous
  // version recursed on the NATIVE call stack, so a deeply-nested value — e.g. a
  // hostile or pathological MCP server's `tools/list` inputSchema — overflowed
  // the stack with a RangeError. In fetchToolsForClient that RangeError is caught
  // and the WHOLE server's tools are silently dropped (`return []`). JSON.parse is
  // iterative and survives such depth, so the recursive sanitizer was the weakest
  // link. A heap work-stack walks arbitrary depth (bounded only by the already-
  // bounded input size) while producing a byte-identical result: same key
  // insertion order, sparse-array holes, and key-collision last-wins semantics.
  const root = { out: undefined }
  const stack = [{ src: value, assign: v => (root.out = v) }]
  while (stack.length > 0) {
    const { src, assign } = stack.pop()

    if (typeof src === 'string') {
      assign(partiallySanitizeUnicode(src))
    } else if (Array.isArray(src)) {
      const arr = new Array(src.length)
      assign(arr)
      for (let i = 0; i < src.length; i++) {
        // Preserve holes exactly like Array.prototype.map (the previous impl).
        if (!(i in src)) continue
        const index = i
        stack.push({ src: src[index], assign: v => (arr[index] = v) })
      }
    } else if (src !== null && typeof src === 'object') {
      const obj = {}
      assign(obj)
      // Keys returned by Object.keys are always strings → sanitize directly
      // (recursivelySanitizeUnicode(string) === partiallySanitizeUnicode(string)).
      // Reserve each sanitized slot in the original iteration order so the output
      // key order is identical regardless of the stack's LIFO processing order; a
      // later key that sanitizes to an existing slot overwrites the source value
      // (last-write-wins) while keeping the first slot's position — matching the
      // recursive `sanitized[key] = val` assignment exactly.
      const orderedKeys = []
      const srcByKey = new Map()
      for (const key of Object.keys(src)) {
        const sanitizedKey = partiallySanitizeUnicode(key)
        if (!srcByKey.has(sanitizedKey)) {
          obj[sanitizedKey] = undefined
          orderedKeys.push(sanitizedKey)
        }
        srcByKey.set(sanitizedKey, src[key])
      }
      for (const sanitizedKey of orderedKeys) {
        const slot = sanitizedKey
        stack.push({ src: srcByKey.get(slot), assign: v => (obj[slot] = v) })
      }
    } else {
      assign(src)
    }
  }
  return root.out
}
