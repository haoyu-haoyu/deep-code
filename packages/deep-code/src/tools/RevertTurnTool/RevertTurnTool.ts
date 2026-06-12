import { z } from 'zod/v4'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  buildRevertTurnPermissionResult,
  performRevertTurn,
  validateRevertTurnInput,
} from './revert-turn.mjs'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    turn_id: z
      .number()
      .int()
      .positive()
      .describe('The numeric turn id to revert. No file path or git SHA input is accepted.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    turnId: z.number(),
    phase: z.string(),
    snapshotId: z.string(),
    affectedFileCount: z.number(),
    affectedFiles: z.array(z.string()),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const RevertTurnTool: Tool<InputSchema, Output> = buildTool({
  name: 'revert_turn',
  searchHint: 'restore workspace files to a previous turn snapshot',
  maxResultSizeChars: 100_000,
  async description({ turn_id }) {
    return `Revert workspace files to the pre-turn snapshot for turn ${turn_id}`
  },
  async prompt() {
    return [
      'Use revert_turn to undo the workspace file changes from a previous turn.',
      'Input must be exactly { "turn_id": number }; never pass paths or git SHAs.',
      'The tool restores through DeepCode side-git snapshots: it overwrites local workspace changes and removes files created after the snapshot (except files ignored by .gitignore), so it requires confirmation.',
    ].join('\n')
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    return `Reverting turn ${input?.turn_id ?? ''}`.trim()
  },
  shouldDefer: true,
  requiresUserInteraction() {
    return true
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return true
  },
  toAutoClassifierInput(input) {
    return `revert turn ${input.turn_id}`
  },
  async checkPermissions(input) {
    return buildRevertTurnPermissionResult(input)
  },
  async validateInput(input) {
    try {
      validateRevertTurnInput(input)
      return { result: true }
    } catch (error) {
      return {
        result: false,
        message: error instanceof Error ? error.message : String(error),
        errorCode: 1,
      }
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input) {
    const result = await performRevertTurn({
      workspaceRoot: getOriginalCwd(),
      sessionId: getSessionId(),
      input,
    })
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
