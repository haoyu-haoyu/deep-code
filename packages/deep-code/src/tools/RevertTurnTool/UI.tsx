import * as React from 'react'
import { Text } from '../../ink.js'
import type { Output } from './RevertTurnTool.js'

export function renderToolUseMessage(input: Partial<{ turn_id: number }>): React.ReactNode {
  const turnId = input.turn_id ?? '?'
  return <Text>Reverting turn {turnId} (snapshot pre-)</Text>
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  return <Text>{output.message}</Text>
}
