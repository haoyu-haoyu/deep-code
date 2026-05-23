/**
 * Neutral remote message content type.
 * Original source module: utils/teleport/api.ts.
 * Added during P1.3.G.a so direct-connect / REPL paths can keep
 * their imports after utils/teleport/* is mass deleted in P1.3.G.b.
 *
 * Type byte-identical to the original utils/teleport/api.ts
 * RemoteMessageContent.
 */
export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

/**
 * Neutral remote permission result type.
 * Original source module: remote session manager.
 * Added during P1.3.G.b2 so direct-connect / SSH paths can keep
 * their imports after remote session manager deletion.
 */
export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      message: string
    }
