/**
 * Provenance gate for leader → teammate control messages delivered over the
 * teammate mailbox (e.g. `team_permission_update`, which auto-applies a session
 * allow-rule to the receiving teammate's permission context).
 *
 * A control message is trusted ONLY when its `from` field is EXACTLY the
 * team-lead identity. A worker-to-worker forged message — any other sender, an
 * empty/missing sender, or a non-string — is rejected, so a prompt-injected
 * teammate cannot spoof a leader-issued control message to escalate another
 * teammate's permissions. The match is case-sensitive with no prefix match, so
 * a sender like 'team-lead-x' is NOT treated as the leader.
 *
 * Pure value-in/value-out predicate (the canonical leader name is passed in by
 * the caller, which owns the `TEAM_LEAD_NAME` SSOT) so it is node-testable.
 *
 * @param {unknown} from - the message's claimed sender
 * @param {unknown} leaderName - the canonical team-lead identity (TEAM_LEAD_NAME)
 * @returns {boolean} true iff `from` is exactly the team-lead
 */
export function isTrustedLeaderControlMessage(from, leaderName) {
  return (
    typeof from === 'string' &&
    typeof leaderName === 'string' &&
    leaderName.length > 0 &&
    from === leaderName
  )
}
