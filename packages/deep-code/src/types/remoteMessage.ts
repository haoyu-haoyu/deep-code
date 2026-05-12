/**
 * Remote message content envelope. Originally lived in
 * src/utils/teleport/api.ts; moved to a neutral location so non-teleport
 * remote modes (useDirectConnect, useSSHSession) can continue using
 * the type after teleport directory deletion in a later P1.2 sub-PR.
 *
 * The type is intentionally a simple discriminated union with no
 * runtime dependencies — it's a wire-protocol envelope only.
 */
export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>
