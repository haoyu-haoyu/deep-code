// The non-atomic write fallback taken after the atomic temp-write + rename failed.
//
// The atomic path (write content to a sibling temp, fsync, renameSync over the
// target) never truncates the live file. Its fallback used to be a direct
// `fsWriteFileSync(targetPath, content)` — but writeFileSync opens with O_TRUNC,
// so it EMPTIES the target the instant it opens, BEFORE any bytes are written.
// When the target already held data, an ENOSPC (or any mid-write failure / crash
// / EROFS / EACCES) then leaves the file empty AND the original unrecoverable AND
// the new content never written: total data loss of a file that was intact a
// moment ago. No crash is even required — a full disk alone does it (the atomic
// temp write throws ENOSPC, the fallback truncates the target and immediately
// fails ENOSPC too).
//
// So the fallback must NEVER truncate an EXISTING target. When the target exists,
// re-throw the atomic error: the file on disk is left untouched, so the caller's
// read-then-write retry (or the surfaced error) keeps the original safe. A NEW
// file has nothing to lose, so the direct write still creates it (preserving the
// create path on the exotic filesystems where temp+rename isn't available).
//
// Pure decision logic with the side-effecting write injected, so the data-safety
// invariant (an existing file is never truncated here) is node-testable.
//
// @param {object} p
// @param {boolean} p.targetExists    did the target already hold data?
// @param {unknown} p.atomicError     the error the atomic path threw
// @param {() => void} p.writeInPlace performs the direct (truncating) write
// @returns {void} throws atomicError if the target exists; otherwise creates the
//   new file (propagating any write error)
export function nonAtomicWriteFallback({ targetExists, atomicError, writeInPlace }) {
  if (targetExists) {
    throw atomicError
  }
  writeInPlace()
}
