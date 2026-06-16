/**
 * Follow an MCP list endpoint's `nextCursor` pagination to completion.
 *
 * The MCP spec lets a server return a page of results plus an opaque
 * `nextCursor`; the client must re-request with `{ cursor }` until `nextCursor`
 * is absent. DeepCode's `tools/list`, `resources/list`, and `prompts/list`
 * fetchers each issued a SINGLE request and ignored `nextCursor`, so every
 * tool / resource / prompt past page 1 was silently invisible for the whole
 * session (the model couldn't invoke a dropped tool; the user couldn't
 * @-mention or /-invoke a dropped resource/prompt) — with no error or warning.
 *
 * This leaf is dependency-injected so it is unit-testable without the SDK or a
 * network: `requestPage(cursor)` performs one page request (cursor is
 * `undefined` for the first page), and `pickArray(result)` extracts that page's
 * items. The first call passes `undefined`, so a caller that builds a
 * cursor-less request object for the first page keeps it byte-identical to the
 * pre-change single request (servers that don't paginate are unaffected).
 *
 * Safety rails for a buggy/malicious server: stop after `maxPages`, after
 * `maxItems` accumulated, or when a `nextCursor` repeats one already followed
 * (a cycle) — never loop forever.
 *
 * @template T
 * @param {(cursor: string | undefined) => Promise<any>} requestPage
 * @param {(result: any) => T[]} pickArray
 * @param {{ maxPages?: number, maxItems?: number }} [opts]
 * @returns {Promise<T[]>}
 */
export async function paginateMcpList(
  requestPage,
  pickArray,
  { maxPages = 100, maxItems = 10000 } = {},
) {
  const items = []
  let cursor
  const followed = new Set()
  for (let page = 0; page < maxPages; page++) {
    const result = await requestPage(cursor)
    const pageItems = pickArray(result) ?? []
    for (const item of pageItems) {
      items.push(item)
      if (items.length >= maxItems) return items
    }
    const next = result == null ? undefined : result.nextCursor
    if (next == null || next === '') break
    // Cycle guard: a server that keeps returning the same cursor must not spin.
    if (followed.has(next)) break
    followed.add(next)
    cursor = next
  }
  return items
}
