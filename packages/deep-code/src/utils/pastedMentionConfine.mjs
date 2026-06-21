// Collect the @-mentions that appear INSIDE pasted-text blobs so they can be
// confined downstream.
//
// A paste longer than the collapse threshold is stored in pastedContents and
// shown to the user only as a `[Pasted text #N +M lines]` placeholder — the body
// is INVISIBLE. At submit, expandPastedTextRefs splices the full body back into
// the input string, and processAtMentionedFiles then @-expands any `@<path>`
// token in that flat string as bodySourced=false (live user intent) → a default
// out-of-workspace path (e.g. a home-dir secret) is read SILENTLY into the model
// context with no permission prompt (shouldSuppressAttachmentRead only suppresses
// the out-of-workspace ask for body-sourced mentions). The trust model classifies
// pasted content as attacker-controlled, and the paste-collapse hides the token,
// so the "visible user intent" justification that legitimizes a TYPED
// out-of-workspace @-mention does not hold here. This reproduces the demonstrated
// private-key-leak class.
//
// The fix confines @-mentions that originate from a paste, symmetric with the
// #580 command/skill/MCP-body bodySourced confinement. We identify them by
// CONTENT, not offset: extract the @-file / @-resource mentions found within each
// pasted blob. A mention that fully appears inside an attacker-controlled paste is
// therefore in this set and gets confined; a purely TYPED mention is not (it stays
// allowed — visible user intent). Membership is exact-string against what
// extractAtMentionedFiles / extractMcpResourceMentions return for the full input,
// and expandPastedTextRefs splices each blob VERBATIM, so a mention wholly inside
// one blob produces a byte-identical string on both sides and the lookup matches.
//
// KNOWN RESIDUAL (low, follow-up): a mention SPLIT across a boundary — typed text
// abutting a paste, or two adjacent collapsed pastes (`@~/.ssh/id_rs` ending blob
// #1, `a_backup` starting blob #2) — forms only in the spliced full input, so it
// is in NEITHER blob's set and is not confined. The typed-abut case needs the user
// to type the completing text; the two-adjacent-paste case IS attacker-controlled
// (both blobs) but requires a precisely-split double consecutive paste. The
// complete fix is offset-based: confine any mention whose span overlaps a spliced
// paste region (expandPastedTextRefs knows each blob's offset+length). This
// content-based pass closes the dominant single-hidden-paste vector.
//
// Pure value-in/value-out (imports only the sibling .mjs extractors) so it is
// node-testable (attachments.ts / handlePromptSubmit.ts are bun-tainted).

import {
  extractAtMentionedFiles,
  extractMcpResourceMentions,
} from './atMentionParsing.mjs'

/**
 * @param {Record<number, {type?: string, content?: string}>|undefined} pastedContents
 * @returns {{ files: string[], resources: string[] }}
 */
export function extractPastedMentions(pastedContents) {
  const files = new Set()
  const resources = new Set()
  if (pastedContents) {
    for (const entry of Object.values(pastedContents)) {
      if (!entry || entry.type !== 'text' || typeof entry.content !== 'string') {
        continue
      }
      for (const f of extractAtMentionedFiles(entry.content)) files.add(f)
      for (const r of extractMcpResourceMentions(entry.content)) resources.add(r)
    }
  }
  return { files: [...files], resources: [...resources] }
}
