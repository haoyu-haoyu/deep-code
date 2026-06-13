// Paste IDs key the `pastedContents` map (images + long/truncated pasted text).
// TWO sites allocate into that one keyspace and historically used DIFFERENT,
// uncoordinated rules:
//   1. PromptInput's `nextPasteIdRef` counter (monotonic, seeded from prior
//      messages for --continue/--resume; advances synchronously so a
//      multi-image paste loop never collides before React commits the map).
//   2. maybeTruncateInput's `Math.max(...mapKeys) + 1` (recomputed from the
//      live map only, blind to the counter).
// Because neither consulted the other, they could mint the same id: e.g. a
// 20k-char raw paste truncates to id 1 (empty map → max+1 = 1), then an image
// paste reuses id 1 from the still-at-1 counter and OVERWRITES the truncated
// text in the map — the pasted text is silently lost on submit.
//
// reconcilePasteId is the single shared rule for BOTH sites. It returns an id
// strictly greater than every currently-live id, reconciling three sources:
//   - the caller's monotonic counter floor (keeps the synchronous-loop guarantee),
//   - every key already in the live `pastedContents` map (the cross-allocator
//     coordination point — the other allocator's output is visible here),
//   - every paste-ref id still present in the input text (covers the window
//     where a placeholder's setPastedContents has not yet committed but its
//     `[Image #N]` / `[...Truncated text #N]` ref is already in the field).
// The result collides with nothing live and never moves the counter backwards.
export function reconcilePasteId(counterNext, pastedContents, refIds = []) {
  let next = Number.isInteger(counterNext) && counterNext > 0 ? counterNext : 1
  for (const key of Object.keys(pastedContents ?? {})) {
    const n = Number(key)
    if (Number.isInteger(n) && n + 1 > next) next = n + 1
  }
  for (const id of refIds) {
    if (Number.isInteger(id) && id + 1 > next) next = id + 1
  }
  return next
}
