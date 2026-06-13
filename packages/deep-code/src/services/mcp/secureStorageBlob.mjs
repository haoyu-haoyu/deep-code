// Pure helpers for updating ONE entry of a sub-tree in the secure-storage
// credentials blob while preserving that entry's other fields AND every sibling
// entry and sibling sub-tree. The whole blob is written as a unit, so a
// read-modify-write that rebuilds only its own entry would clobber a concurrent
// writer of a DIFFERENT entry/sub-tree; these helpers are always applied INSIDE
// the credentials lock (see mutateSecureStorage) against a freshly-read blob so
// no sibling is lost.
//
// Sub-trees in the blob: mcpOAuth (per-server tokens), mcpOAuthClientConfig
// (per-server client creds), mcpXaaIdp (IdP id_token cache), mcpXaaIdpConfig
// (IdP client secrets).

/**
 * Return a new blob with `patch` merged into `blob[subtree][key]`, preserving
 * that entry's untouched fields and all siblings. A field set to `undefined` in
 * the patch clears it (JSON.stringify drops it), matching the old in-place
 * `delete entry.field` writes. Computed keys use data-property semantics, so a
 * `__proto__` key is stored as data and never walks the prototype chain.
 *
 * @param {Record<string, any>} blob
 * @param {string} subtree
 * @param {string} key
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>} a new blob
 */
export function setBlobEntry(blob, subtree, key, patch) {
  const base = blob && typeof blob === 'object' ? blob : {}
  const tree =
    base[subtree] && typeof base[subtree] === 'object' ? base[subtree] : {}
  return {
    ...base,
    [subtree]: {
      ...tree,
      [key]: { ...tree[key], ...patch },
    },
  }
}

/**
 * Return a new blob with `blob[subtree][key]` removed, preserving all siblings.
 * When the sub-tree or key is absent the original blob is returned unchanged
 * (the caller can skip the write).
 *
 * @param {Record<string, any>} blob
 * @param {string} subtree
 * @param {string} key
 * @returns {Record<string, any>}
 */
export function deleteBlobEntry(blob, subtree, key) {
  const base = blob && typeof blob === 'object' ? blob : {}
  const tree = base[subtree]
  if (!tree || typeof tree !== 'object' || !(key in tree)) return base
  const nextTree = { ...tree }
  delete nextTree[key]
  return { ...base, [subtree]: nextTree }
}

/**
 * True when the sub-tree entry exists — lets a caller decide whether a delete
 * would change anything before taking the lock.
 *
 * @param {Record<string, any>} blob
 * @param {string} subtree
 * @param {string} key
 * @returns {boolean}
 */
export function hasBlobEntry(blob, subtree, key) {
  const tree = blob && typeof blob === 'object' ? blob[subtree] : undefined
  return !!tree && typeof tree === 'object' && key in tree
}
