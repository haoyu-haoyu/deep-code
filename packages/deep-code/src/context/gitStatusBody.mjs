// The git-status body rendered in the "git status at the start of the
// conversation" context block that is injected into the system prompt.
//
// CRITICAL: only report "(clean)" when `git status` actually SUCCEEDED. The
// status is fetched with preserveOutputOnError:false, so a non-zero exit
// (corrupt or locked .git/index, a failing status hook, or an ancient git that
// rejects --no-optional-locks) resolves to an EMPTY string — which is
// INDISTINGUISHABLE from a genuinely clean tree unless we also consult the exit
// code. The previous code collapsed any empty status to "(clean)", so a DIRTY
// tree whose status command errored was reported to the model as clean — a
// wrong-state that can change the model's actions (e.g. it may skip committing
// or overwrite work it believes is absent). Threading the exit code lets us
// distinguish "empty because clean" (code 0) from "empty because the read
// failed" (code != 0) and tell the model the truth in the latter case.
//
// @param {string} statusText the trimmed (and possibly truncated) status output
// @param {number} statusCode the `git status` exit code (0 = success)
// @returns {string} the body to render after "Status:\n"
export function formatGitStatusBody(statusText, statusCode) {
  if (statusText) return statusText
  return statusCode === 0
    ? '(clean)'
    : '(unable to read git status — run "git status" to see the working tree state)'
}
