/**
 * True iff a FORMATTED compact summary carries actual content.
 *
 * formatCompactSummary strips the <analysis> drafting scratchpad and unwraps
 * <summary>body</summary> into a "Summary:\n<body>" block. If the summary
 * response was truncated by the output-token limit before it wrote the <summary>
 * section (the prompt asks for a long, multi-section summary and analysis is a
 * scratchpad that burns output tokens first), or emitted an empty
 * <summary></summary>, the formatted result is "" or just the bare "Summary:"
 * header — a content-free summary.
 *
 * The raw-text guard (`if (!summary)`) does NOT catch this: the raw response
 * still contains the non-empty <analysis> block (and/or the empty summary tags),
 * so getAssistantMessageText returns a truthy string. Accepting such a summary
 * replaces the older conversation with boilerplate framing and nothing else —
 * silent history loss (the failure the #435 guard was meant to prevent, via a
 * path that guard does not see).
 *
 * Strip a leading "Summary:" header and surrounding whitespace; any real summary
 * content remains. A summary that simply has text before the header still counts
 * (the strip only no-ops there).
 *
 * @param {string} formattedSummary  the output of formatCompactSummary
 * @returns {boolean} true when there is substantive content beyond the header
 */
export function compactSummaryHasContent(formattedSummary) {
  return formattedSummary.replace(/^Summary:/, '').trim().length > 0
}
