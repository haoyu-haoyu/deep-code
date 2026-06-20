import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  hasCommandsInQueue,
  peekAllInDispatchOrder,
  remove,
} from './messageQueueManager.js'
import { selectQueueDrainBatch } from './queueBatchSelection.mjs'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
}

type ProcessQueueResult = {
  processed: boolean
}

/**
 * Check if a queued command is a slash command (value starts with '/').
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
  if (typeof cmd.value === 'string') {
    return cmd.value.trim().startsWith('/')
  }
  // For ContentBlockParam[], check the first text block
  for (const block of cmd.value) {
    if (block.type === 'text') {
      return block.text.trim().startsWith('/')
    }
  }
  return false
}

/**
 * Processes commands from the queue.
 *
 * Slash commands (starting with '/') and bash-mode commands are processed
 * one at a time so each goes through the executeInput path individually.
 * Bash commands need individual processing to preserve per-command error
 * isolation, exit codes, and progress UI. Other non-slash commands are
 * batched: all items **with the same mode** as the highest-priority item
 * are drained at once and passed as a single array to executeInput — each
 * becomes its own user message with its own UUID. Different modes
 * (e.g. prompt vs task-notification) are never mixed because they are
 * treated differently downstream.
 *
 * The caller is responsible for ensuring no query is currently running
 * and for calling this function again after each command completes
 * until the queue is empty.
 *
 * @returns result with processed status
 */
export function processQueueIfReady({
  executeInput,
}: ProcessQueueParams): ProcessQueueResult {
  // This processor runs on the REPL main thread between turns. Restrict the
  // snapshot to main-thread commands — a subagent notification has agentId set
  // and is drained elsewhere; including it here would batch nothing for the main
  // thread and we'd return processed:false with the queue unchanged → the React
  // effect never re-fires and any queued user prompt stalls permanently.
  const isMainThread = (cmd: QueuedCommand) => cmd.agentId === undefined

  // Select the drain batch from a non-destructive, dispatch-ordered snapshot and
  // remove exactly those by reference. selectQueueDrainBatch takes only the
  // CONTIGUOUS leading run (a slash/bash head alone; a prompt head + its
  // same-mode prompt followers, stopping at the first sandwiched slash/bash so it
  // keeps its FIFO position). Using a position-agnostic whole-queue scan here
  // previously jumped a sandwiched /clear past later prompts.
  const commands = selectQueueDrainBatch(
    peekAllInDispatchOrder(isMainThread),
    isSlashCommand,
  )
  if (commands.length === 0) {
    return { processed: false }
  }

  remove(commands)
  void executeInput(commands)
  return { processed: true }
}

/**
 * Checks if the queue has pending commands.
 * Use this to determine if queue processing should be triggered.
 */
export function hasQueuedCommands(): boolean {
  return hasCommandsInQueue()
}
