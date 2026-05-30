import * as React from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import { useTranslation } from '../../i18n/useTranslation.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  formatRestoreSnapshotLine,
  getRestoreSnapshotItems,
  performRestore,
} from './restore-command.mjs'

type RestoreDialogProps = {
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void
  workspaceRoot: string
  initialSnapshotId?: string
}

function RestoreDialog({
  onDone,
  workspaceRoot,
  initialSnapshotId,
}: RestoreDialogProps): React.ReactNode {
  const [items, setItems] = React.useState<Awaited<
    ReturnType<typeof getRestoreSnapshotItems>
  > | null>(null)
  const [selected, setSelected] = React.useState<string | undefined>(
    initialSnapshotId,
  )
  const [error, setError] = React.useState<string | undefined>()
  const [isRestoring, setIsRestoring] = React.useState(false)
  const { t } = useTranslation()

  React.useEffect(() => {
    let cancelled = false
    void getRestoreSnapshotItems({ workspaceRoot }).then(
      nextItems => {
        if (!cancelled) setItems(nextItems)
      },
      reason => {
        if (!cancelled) setError(reason?.message ?? String(reason))
      },
    )
    return () => {
      cancelled = true
    }
  }, [workspaceRoot])

  React.useEffect(() => {
    if (!initialSnapshotId) return
    setSelected(initialSnapshotId)
  }, [initialSnapshotId])

  async function confirmRestore(snapshotId: string) {
    setIsRestoring(true)
    const result = await performRestore({
      workspaceRoot,
      snapshotId,
      confirmed: true,
    })
    setIsRestoring(false)
    onDone(result.message, { display: 'system' })
  }

  if (error) {
    return <RestoreMessageDialog title={t('restore.unavailableTitle')} message={error} onDone={onDone} />
  }

  if (items === null) {
    return <RestoreMessageDialog title={t('restore.snapshotsTitle')} message={t('restore.loading')} onDone={onDone} />
  }

  if (items.length === 0) {
    return <RestoreMessageDialog title={t('restore.snapshotsTitle')} message={t('restore.empty')} onDone={onDone} />
  }

  if (selected) {
    const item = items.find(candidate => candidate.snapshotId === selected)
    return (
      <Dialog
        title={t('restore.confirmTitle')}
        subtitle={t('restore.confirmSubtitle')}
        color="warning"
        onCancel={() => setSelected(undefined)}
      >
        <Box flexDirection="column" gap={1}>
          <Text>{item ? formatRestoreSnapshotLine(item) : selected}</Text>
          <Text dimColor>
            {t('restore.confirmBody')}
          </Text>
          <Select<'yes' | 'no'>
            isDisabled={isRestoring}
            defaultValue="no"
            defaultFocusValue="no"
            onCancel={() => setSelected(undefined)}
            onChange={value => {
              if (value === 'yes') {
                void confirmRestore(selected)
              } else {
                setSelected(undefined)
              }
            }}
            options={[
              { label: t('restore.confirmLabel'), value: 'yes' },
              { label: t('restore.cancelLabel'), value: 'no' },
            ]}
          />
        </Box>
      </Dialog>
    )
  }

  return (
    <Dialog
      title={t('restore.title')}
      subtitle={t('restore.subtitle')}
      onCancel={() => onDone(undefined, { display: 'skip' })}
    >
      <Select<string>
        visibleOptionCount={Math.min(10, items.length)}
        onCancel={() => onDone(undefined, { display: 'skip' })}
        onChange={snapshotId => setSelected(snapshotId)}
        options={items.map(item => ({
          value: item.snapshotId,
          label: formatRestoreSnapshotLine(item),
        }))}
      />
    </Dialog>
  )
}

function RestoreMessageDialog({
  title,
  message,
  onDone,
}: {
  title: string
  message: string
  onDone: (result?: string, options?: { display?: 'skip' | 'system' | 'user' }) => void
}): React.ReactNode {
  return (
    <Dialog title={title} onCancel={() => onDone(undefined, { display: 'skip' })}>
      <Box flexDirection="column">
        <Text>{message}</Text>
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return (
    <RestoreDialog
      onDone={onDone}
      workspaceRoot={getOriginalCwd()}
      initialSnapshotId={args.trim() || undefined}
    />
  )
}
