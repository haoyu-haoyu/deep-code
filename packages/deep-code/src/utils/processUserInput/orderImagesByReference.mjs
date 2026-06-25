/**
 * Order pasted image attachments to match the order their `[Image #N]`
 * placeholders appear in the prompt TEXT, rather than by numeric paste id.
 *
 * The image content blocks and their paste-id list are parallel arrays appended
 * to the message in this order, and the model associates each `[Image #N]` text
 * reference with an image positionally. The old code built the list from
 * `Object.values(pastedContents)`, which iterates integer-like keys in ASCENDING
 * numeric order (per the JS spec) — NOT paste/text order. So when the ids are
 * non-sequential (gaps after a deleted image, or a resumed draft) or the user
 * rearranges the placeholders, the blocks were emitted in a different order than
 * the text references, and the model mapped the wrong image to each reference.
 *
 * Ordering by first text-reference appearance restores the correspondence. Any
 * image not referenced in the text (defensive — callers normally pre-filter to
 * referenced images) is appended afterwards in its original order, so no image
 * is ever dropped. When there are no references (e.g. a non-text prompt), the
 * original order is preserved unchanged.
 *
 * @template {{ id: number }} T
 * @param {number[]} refIdsInTextOrder  ids of [..#N] refs in the order they appear in the text
 * @param {T[]} imagePastes             image PastedContent entries (any order)
 * @returns {T[]} imagePastes ordered by first text-reference appearance
 */
export function orderImagePastesByReference(refIdsInTextOrder, imagePastes) {
  const byId = new Map(imagePastes.map(img => [img.id, img]))
  const ordered = []
  const used = new Set()
  for (const id of refIdsInTextOrder) {
    if (used.has(id)) continue
    const img = byId.get(id)
    if (img) {
      ordered.push(img)
      used.add(id)
    }
  }
  // Keep any image not referenced in the text (defensive; never drop an image).
  for (const img of imagePastes) {
    if (!used.has(img.id)) {
      ordered.push(img)
      used.add(img.id)
    }
  }
  return ordered
}
