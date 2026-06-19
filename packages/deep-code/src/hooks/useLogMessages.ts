import type { UUID } from 'crypto'
import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js'
import {
  cleanMessagesForLogging,
  isChainParticipant,
  recordTranscript,
} from '../utils/sessionStorage.js'
import { resolveRecordPlan } from './recordPlan.mjs'

/**
 * Hook that logs messages to the transcript
 * conversation ID that only changes when a new conversation is started.
 *
 * @param messages The current conversation messages
 * @param ignore When true, messages will not be recorded to the transcript
 */
export function useLogMessages(messages: Message[], ignore: boolean = false) {
  const teamContext = useAppState(s => s.teamContext)

  // messages is append-only between compactions, so track where we left off
  // and only pass the new tail to recordTranscript. Avoids O(n) filter+scan
  // on every setMessages (~20x/turn, so n=3000 was ~120k wasted iterations).
  const lastRecordedLengthRef = useRef(0)
  const lastParentUuidRef = useRef<UUID | undefined>(undefined)
  // First-uuid change = compaction or /clear rebuilt the array; length alone
  // can't detect this since post-compact [CB,summary,...keep,new] may be longer.
  const firstMessageUuidRef = useRef<UUID | undefined>(undefined)
  // The uuid we last recorded at the tail index (prevLength-1). A pure append
  // leaves it unchanged; a fullscreen `from` partial-compact splices a boundary
  // at an interior index < prevLength (keeping messages[0]), which shifts it —
  // the signal that an otherwise-incremental render actually rewrote the recorded
  // prefix and must be re-recorded in full so the boundary is persisted.
  const lastRecordedTailUuidRef = useRef<UUID | undefined>(undefined)
  // Guard against stale async .then() overwriting a fresher sync update when
  // an incremental render fires before the compaction .then() resolves.
  const callSeqRef = useRef(0)

  useEffect(() => {
    if (ignore) return

    const currentFirstUuid = messages[0]?.uuid as UUID | undefined
    const prevLength = lastRecordedLengthRef.current

    // First-render: firstMessageUuidRef is undefined. Compaction: first uuid changes.
    // Both are !isIncremental, but first-render sync-walk is safe (no messagesToKeep).
    const wasFirstRender = firstMessageUuidRef.current === undefined
    // Same-head shrink (tombstone filter, rewind, snip, partial-compact) is
    // distinguished from compaction (first uuid changes); the prefix-rewrite guard
    // (uuidAtPrevTailIndex vs prevRecordedTailUuid) demotes a fullscreen `from`
    // partial-compact — which keeps messages[0] and grows but splices an interior
    // boundary — from incremental to a full rebuild so the boundary is persisted.
    const { startIndex, isIncremental, isSameHeadShrink } = resolveRecordPlan({
      wasFirstRender,
      currentFirstUuid,
      prevFirstUuid: firstMessageUuidRef.current,
      prevLength,
      currentLength: messages.length,
      uuidAtPrevTailIndex: messages[prevLength - 1]?.uuid as UUID | undefined,
      prevRecordedTailUuid: lastRecordedTailUuidRef.current,
    })
    if (startIndex === messages.length) return

    // Full array on first call + after compaction: recordTranscript's own
    // O(n) dedup loop handles messagesToKeep interleaving correctly there.
    const slice = startIndex === 0 ? messages : messages.slice(startIndex)
    const parentHint = isIncremental ? lastParentUuidRef.current : undefined

    // Fire and forget - we don't want to block the UI.
    const seq = ++callSeqRef.current
    void recordTranscript(
      slice,
      isAgentSwarmsEnabled()
        ? {
            teamName: teamContext?.teamName,
            agentName: teamContext?.selfAgentName,
          }
        : {},
      parentHint,
      messages,
    ).then(lastRecordedUuid => {
      // For compaction/full array case (!isIncremental): use the async return
      // value. After compaction, messagesToKeep in the array are skipped
      // (already in transcript), so the sync loop would find a wrong UUID.
      // Skip if a newer effect already ran (stale closure would overwrite the
      // fresher sync update from the subsequent incremental render).
      if (seq !== callSeqRef.current) return
      if (lastRecordedUuid && !isIncremental) {
        lastParentUuidRef.current = lastRecordedUuid
      }
    })

    // Sync-walk safe for: incremental (pure new-tail slice), first-render
    // (no messagesToKeep interleaving), and same-head shrink. Shrink is the
    // subtle one: the picked uuid is either already on disk (tombstone/rewind
    // — survivors were written before) or is being written by THIS effect's
    // recordTranscript(fullArray) call (snip boundary / partial-compact tail
    // — enqueueWrite ordering guarantees it lands before any later write that
    // chains to it). Without this, the ref stays stale at a tombstoned uuid:
    // the async .then() correction is raced out by the next effect's seq bump
    // on large sessions where recordTranscript(fullArray) is slow. Only the
    // compaction case (first uuid changed) remains unsafe — tail may be
    // messagesToKeep whose last-actually-recorded uuid differs.
    if (isIncremental || wasFirstRender || isSameHeadShrink) {
      // Match EXACTLY what recordTranscript persists: cleanMessagesForLogging
      // applies both the isLoggableMessage filter and (for external users) the
      // REPL-strip + isVirtual-promote transform. Using the raw predicate here
      // would pick a UUID that the transform drops, leaving the parent hint
      // pointing at a message that never reached disk. Pass full messages as
      // replId context — REPL tool_use and its tool_result land in separate
      // render cycles, so the slice alone can't pair them.
      const last = cleanMessagesForLogging(slice, messages).findLast(
        isChainParticipant,
      )
      if (last) lastParentUuidRef.current = last.uuid as UUID
    }

    lastRecordedLengthRef.current = messages.length
    firstMessageUuidRef.current = currentFirstUuid
    // Remember the tail uuid so the next render can detect a prefix rewrite
    // (interior boundary insert) that an append-only length check would miss.
    lastRecordedTailUuidRef.current = messages[messages.length - 1]?.uuid as
      | UUID
      | undefined
  }, [messages, ignore, teamContext?.teamName, teamContext?.selfAgentName])
}
