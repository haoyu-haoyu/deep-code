import * as React from 'react'
import { Box, Text } from '../../ink.js'

export const DEEPSEEK_LOGO_ROWS = [
  '   ███████    ██ ',
  ' ██████████  ████',
  '██   ███◆█ ███  ',
  '██  ████  ███   ',
  '  ███   █████   ',
] as const

const DEEPSEEK_LOGO_COMPACT_ROWS = [
  ' ██████  ██',
  '█  ██◆████',
  ' ██  ███ ',
] as const

type Props = {
  compact?: boolean
}

export function DeepSeekLogo({ compact = false }: Props): React.ReactNode {
  const rows = compact ? DEEPSEEK_LOGO_COMPACT_ROWS : DEEPSEEK_LOGO_ROWS
  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, index) => (
        <LogoRow key={index} row={row} />
      ))}
    </Box>
  )
}

function LogoRow({ row }: { row: string }): React.ReactNode {
  return (
    <Text>
      {row.split(/(◆)/).map((part, index) => {
        if (part === '◆') {
          return (
            <Text key={index} color="text">
              █
            </Text>
          )
        }
        return (
          <Text key={index} color="clawd_body">
            {part}
          </Text>
        )
      })}
    </Text>
  )
}
