import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { executeCacheCommand } from './cache-command.mjs'

type CacheInspectDialogProps = {
  report: string
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void
}

function CacheInspectDialog({
  report,
  onDone,
}: CacheInspectDialogProps): React.ReactNode {
  const lines = report.split('\n')
  return (
    <Dialog
      title="DeepSeek cache"
      subtitle="Prompt cache telemetry for the current session"
      onCancel={() => onDone(undefined, { display: 'skip' })}
    >
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} dimColor={index > 0}>
            {line}
          </Text>
        ))}
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const result = await executeCacheCommand(args, {
    context,
  })

  if (result.kind === 'inspect') {
    return <CacheInspectDialog report={result.report} onDone={onDone} />
  }

  onDone(result.value, { display: 'system' })
  return null
}
