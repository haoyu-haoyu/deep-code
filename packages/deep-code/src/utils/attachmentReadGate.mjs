// Decide whether an @-mention file read must be SUPPRESSED. The @-mention /
// command-body attachment path expands file CONTENT into the prompt and cannot
// surface an interactive permission prompt, so a read the user gated — or one that
// is not the user's live intent — must be SKIPPED rather than read silently.
//
// `decision` is a checkReadPermissionForTool result: { behavior, decisionReason }.
//   - behavior 'deny'                        -> suppress (hard deny).
//   - behavior 'ask' from a CONFIGURED rule  -> suppress (a fortress fs-read / an
//       explicit read-ask rule / a UNC or suspicious-Windows guard; the attachment
//       path can't prompt, so a gated file must not be read silently).
//   - behavior 'ask' whose ONLY reason is the DEFAULT 'workingDir' (the path is
//       outside the working directory):
//       * a LIVE user-typed @-mention is the user's own intent -> ALLOW the read
//         (preserve the long-standing "read out-of-workspace mentions" behavior).
//       * a BODY-sourced @-mention (text from a slash-command / skill / plugin /
//         MCP-prompt body, NOT a live user action) is NOT user intent -> SUPPRESS,
//         confining body @-mentions to the workspace + additionalWorkingDirectories.
//         An untrusted plugin/marketplace skill, an opened repo's project skill, or
//         a connected MCP server's prompt body could otherwise embed `@~/.ssh/id_rsa`
//         (etc.) and silently read an out-of-workspace secret into the model context
//         with no prompt — a privilege escalation over the model's OWN Read tool,
//         which on the same path WOULD surface the workingDir ask. The MCP-resource
//         sibling (@server:uri) was already hardened against an untrusted body read;
//         this closes the parallel @-file path.
export function shouldSuppressAttachmentRead(
  decision,
  { bodySourced = false } = {},
) {
  if (!decision) return false
  if (decision.behavior === 'deny') return true
  if (decision.behavior !== 'ask') return false
  // a configured ask (anything other than the default out-of-workspace prompt)
  // can't be surfaced from the attachment path -> suppress
  if (decision.decisionReason?.type !== 'workingDir') return true
  // the lone remaining case: a default out-of-workspace ask. Read it only for a
  // live user @-mention; suppress it for a pre-written command/skill/plugin/MCP body.
  return bodySourced === true
}
