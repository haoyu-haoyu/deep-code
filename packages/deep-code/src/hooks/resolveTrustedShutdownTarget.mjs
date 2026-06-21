/**
 * Resolve the trusted shutdown target for a `shutdown_approved` mailbox message.
 *
 * When the leader receives a `shutdown_approved`, it KILLS a pane and EVICTS a
 * teammate. Both the target identity and the pane to kill MUST be derived from
 * the leader's own authoritative state, keyed by the AUTHENTICATED envelope
 * sender (mailbox `m.from`, stamped from the sender's runtime identity) — NEVER
 * from the message payload (`parsed.from` / `parsed.paneId`), which a
 * prompt-injected worker fully controls. Otherwise a worker could forge an
 * approval naming ANOTHER teammate and an ARBITRARY pane, evicting that
 * teammate and killing any pane (a cross-teammate / user-session DoS).
 *
 * This looks up the envelope sender in `teamContext.teammates` and returns that
 * teammate's id + own recorded pane, or `null` when the sender is not a known
 * teammate — in which case the leader must take NO destructive action. A
 * forged approval therefore resolves only to the sender's OWN record: a worker
 * can shut down itself and nothing else.
 *
 * Pure value-in/value-out so it is node-testable.
 *
 * @param {unknown} envelopeFrom - the authenticated sender (mailbox `m.from`)
 * @param {unknown} teammates - `teamContext.teammates`: Record<id,{name,tmuxPaneId,...}>
 * @returns {{ teammateId: string, name: string, paneId: string | undefined } | null}
 */
export function resolveTrustedShutdownTarget(envelopeFrom, teammates) {
  if (typeof envelopeFrom !== 'string' || envelopeFrom.length === 0) return null
  if (!teammates || typeof teammates !== 'object') return null
  for (const [teammateId, t] of Object.entries(teammates)) {
    if (t && typeof t === 'object' && t.name === envelopeFrom) {
      const paneId =
        typeof t.tmuxPaneId === 'string' && t.tmuxPaneId.length > 0
          ? t.tmuxPaneId
          : undefined
      return { teammateId, name: t.name, paneId }
    }
  }
  return null
}
