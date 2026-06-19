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
// (IdP client secrets), pluginSecrets (per-plugin/per-server sensitive options).

/**
 * Return a new blob with `patch` MERGED into `blob[subtree][key]`, preserving
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
 * Return a new blob with `blob[subtree][key]` REPLACED by `value` exactly (no
 * merge with the previous entry), preserving all siblings. Use this where the
 * caller already computed the entry's complete new contents (e.g. a scrub that
 * intentionally drops fields the previous entry had).
 *
 * @param {Record<string, any>} blob
 * @param {string} subtree
 * @param {string} key
 * @param {Record<string, any>} value
 * @returns {Record<string, any>} a new blob
 */
export function replaceBlobEntry(blob, subtree, key, value) {
  const base = blob && typeof blob === 'object' ? blob : {}
  const tree =
    base[subtree] && typeof base[subtree] === 'object' ? base[subtree] : {}
  return {
    ...base,
    [subtree]: {
      ...tree,
      [key]: value,
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
 * Compare-and-delete: remove `blob[subtree][key]` ONLY when its `field` still
 * equals `expected`, preserving all siblings; otherwise return the blob
 * unchanged (the caller can skip the write). Like deleteBlobEntry, it is meant
 * to run INSIDE the credentials lock against a freshly-read blob — so the
 * comparison is against the CURRENT stored value. This guards a read→(slow
 * network)→clear sequence: when the entry was concurrently replaced with a
 * different value (e.g. a fresh re-login wrote a new id_token while this caller
 * was failing an exchange for the OLD one), the stale clear matches nothing and
 * the new value survives, instead of being wiped value-blind by key.
 *
 * @param {Record<string, any>} blob
 * @param {string} subtree
 * @param {string} key
 * @param {string} field
 * @param {unknown} expected  the field value that must still be present to delete
 * @returns {Record<string, any>}
 */
export function deleteBlobEntryIfFieldEquals(blob, subtree, key, field, expected) {
  const base = blob && typeof blob === 'object' ? blob : {}
  const tree = base[subtree]
  if (!tree || typeof tree !== 'object' || !(key in tree)) return base
  const entry = tree[key]
  if (!entry || typeof entry !== 'object' || entry[field] !== expected) return base
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
