import React, { useCallback, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  mergeDeepSeekConfigPartial,
  resolveDeepSeekConfigPath,
  saveDeepSeekConfigFile,
} from '../services/providers/deepseek-config-store.mjs'
import { logForDebugging } from '../utils/debug.js'
import { Select } from './CustomSelect/select.js'
import { Byline } from './design-system/Byline.js'
import { Dialog } from './design-system/Dialog.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import TextInput from './TextInput.js'

type StepId = 'api-key' | 'base-url' | 'model' | 'effort' | 'confirm'

type WizardState = {
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: 'max' | 'high'
}

type Props = {
  defaultBaseUrl: string
  defaultModel: string
  initialApiKey?: string
  initialBaseUrl?: string
  initialModel?: string
  initialEffort?: WizardState['reasoningEffort']
  onDone: (saved: boolean) => void
}

const MODEL_OPTIONS = [
  {
    label: 'DeepSeek V4 Pro (recommended)',
    value: 'deepseek-v4-pro',
    description: 'Reasoning + tool use; default model for Deep Code sessions',
  },
  {
    label: 'DeepSeek V4 Flash',
    value: 'deepseek-v4-flash',
    description: 'Faster, lower latency; great for quick tasks',
  },
  {
    label: 'Use a custom model name',
    value: '__custom__',
    description: 'Type a model identifier on the next step',
  },
]

const EFFORT_OPTIONS = [
  {
    label: 'Max — full reasoning, deepest quality',
    value: 'max' as const,
    description: 'Recommended for complex tasks',
  },
  {
    label: 'High — balanced reasoning depth',
    value: 'high' as const,
    description: 'Faster turnarounds with shorter reasoning chains',
  },
]

const CONFIRM_OPTIONS = [
  { label: 'Save and continue', value: 'save' as const },
  { label: 'Cancel and skip setup', value: 'cancel' as const },
]

export function DeepSeekSetupDialog({
  defaultBaseUrl,
  defaultModel,
  initialApiKey = '',
  initialBaseUrl,
  initialModel,
  initialEffort = 'max',
  onDone,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize()
  const configPath = resolveDeepSeekConfigPath()
  const [step, setStep] = useState<StepId>('api-key')
  const [state, setState] = useState<WizardState>({
    apiKey: initialApiKey,
    baseUrl: initialBaseUrl ?? defaultBaseUrl,
    model: initialModel ?? defaultModel,
    reasoningEffort: initialEffort,
  })
  const [apiKeyDraft, setApiKeyDraft] = useState(state.apiKey)
  const [apiKeyCursor, setApiKeyCursor] = useState(state.apiKey.length)
  const [baseUrlDraft, setBaseUrlDraft] = useState(state.baseUrl)
  const [baseUrlCursor, setBaseUrlCursor] = useState(state.baseUrl.length)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)
  const [customModelDraft, setCustomModelDraft] = useState('')
  const [customModelCursor, setCustomModelCursor] = useState(0)
  const [pickingCustomModel, setPickingCustomModel] = useState(false)

  const handleCancel = useCallback(() => {
    onDone(false)
  }, [onDone])

  const handleApiKeySubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return
      setState(prev => ({ ...prev, apiKey: trimmed }))
      setApiKeyDraft(trimmed)
      setApiKeyCursor(trimmed.length)
      setStep('base-url')
    },
    [],
  )

  const handleBaseUrlSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim() || defaultBaseUrl
      let parsed: URL
      try {
        parsed = new URL(trimmed)
      } catch {
        setBaseUrlError('Invalid URL — must look like https://api.deepseek.com')
        return
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setBaseUrlError('Base URL must use http:// or https://')
        return
      }
      if (parsed.search || parsed.hash) {
        setBaseUrlError('Base URL must not include a query string or fragment')
        return
      }
      // Normalize to origin + pathname (no trailing slash). The request
      // builder concatenates `${baseUrl}/chat/completions`, so any extra
      // characters here corrupt the endpoint.
      const pathname = parsed.pathname.replace(/\/+$/, '')
      const normalized = `${parsed.origin}${pathname}`
      setBaseUrlError(null)
      setState(prev => ({ ...prev, baseUrl: normalized }))
      setBaseUrlDraft(normalized)
      setBaseUrlCursor(normalized.length)
      setStep('model')
    },
    [defaultBaseUrl],
  )

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        setPickingCustomModel(true)
        return
      }
      setState(prev => ({ ...prev, model: value }))
      setStep('effort')
    },
    [],
  )

  const handleCustomModelSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return
      setState(prev => ({ ...prev, model: trimmed }))
      setCustomModelDraft(trimmed)
      setCustomModelCursor(trimmed.length)
      setPickingCustomModel(false)
      setStep('effort')
    },
    [],
  )

  const handleEffortSelect = useCallback(
    (value: WizardState['reasoningEffort']) => {
      setState(prev => ({ ...prev, reasoningEffort: value }))
      setStep('confirm')
    },
    [],
  )

  const handleConfirm = useCallback(
    (value: 'save' | 'cancel') => {
      if (value === 'cancel') {
        onDone(false)
        return
      }
      try {
        // Merge over any existing persisted fields (smallModel, thinking,
        // etc.) so re-running the wizard never silently drops keys the
        // current screens don't ask about.
        const merged = mergeDeepSeekConfigPartial({
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
          model: state.model,
          reasoningEffort: state.reasoningEffort,
        })
        saveDeepSeekConfigFile(merged)
        onDone(true)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logForDebugging(`DeepSeek setup save failed: ${reason}`, {
          level: 'error',
        })
        onDone(false)
      }
    },
    [onDone, state.apiKey, state.baseUrl, state.model, state.reasoningEffort],
  )

  const isTextStep =
    step === 'api-key' || step === 'base-url' || pickingCustomModel

  // While a TextInput owns the keyboard, take over the cancel keybinding
  // ourselves under the Settings context so the user can type 'n'/Esc into
  // the input. The Dialog's confirm:no binding only stays active for the
  // pure Select-driven steps (model picker, effort, confirm).
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: isTextStep,
  })

  function renderInputGuide(): React.ReactNode {
    if (step === 'api-key' || step === 'base-url' || pickingCustomModel) {
      return (
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="continue" />
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Settings"
            fallback="Esc"
            description="cancel"
          />
        </Byline>
      )
    }
    return (
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description="cancel"
      />
    )
  }

  let body: React.ReactNode = null
  let subtitle = 'Configure DeepSeek credentials and defaults'

  if (step === 'api-key') {
    subtitle = 'Step 1 of 4 — DeepSeek API key'
    body = (
      <Box flexDirection="column">
        <Text>
          Paste your DeepSeek API key (saved to <Text bold>{configPath}</Text>):
        </Text>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text>&gt;</Text>
          <TextInput
            value={apiKeyDraft}
            onChange={setApiKeyDraft}
            onSubmit={handleApiKeySubmit}
            focus={true}
            showCursor={true}
            columns={columns}
            cursorOffset={apiKeyCursor}
            onChangeCursorOffset={setApiKeyCursor}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Get a key from https://platform.deepseek.com/api_keys
          </Text>
        </Box>
      </Box>
    )
  } else if (step === 'base-url') {
    subtitle = 'Step 2 of 4 — API base URL'
    body = (
      <Box flexDirection="column">
        <Text>
          Base URL (Enter to keep default <Text bold>{defaultBaseUrl}</Text>):
        </Text>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text>&gt;</Text>
          <TextInput
            value={baseUrlDraft}
            onChange={value => {
              setBaseUrlDraft(value)
              if (baseUrlError) setBaseUrlError(null)
            }}
            onSubmit={handleBaseUrlSubmit}
            focus={true}
            showCursor={true}
            columns={columns}
            cursorOffset={baseUrlCursor}
            onChangeCursorOffset={setBaseUrlCursor}
          />
        </Box>
        {baseUrlError ? (
          <Box marginTop={1}>
            <Text color="error">{baseUrlError}</Text>
          </Box>
        ) : null}
      </Box>
    )
  } else if (step === 'model') {
    subtitle = 'Step 3 of 4 — Default model'
    if (pickingCustomModel) {
      body = (
        <Box flexDirection="column">
          <Text>Type a custom DeepSeek model identifier:</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput
              value={customModelDraft}
              onChange={setCustomModelDraft}
              onSubmit={handleCustomModelSubmit}
              focus={true}
              showCursor={true}
              columns={columns}
              cursorOffset={customModelCursor}
              onChangeCursorOffset={setCustomModelCursor}
            />
          </Box>
        </Box>
      )
    } else {
      const knownModelValues = MODEL_OPTIONS.map(opt => opt.value)
      const modelFocusValue = knownModelValues.includes(state.model)
        ? state.model
        : '__custom__'
      body = (
        <Select
          options={MODEL_OPTIONS}
          defaultFocusValue={modelFocusValue}
          onChange={handleModelSelect}
          onCancel={handleCancel}
        />
      )
    }
  } else if (step === 'effort') {
    subtitle = 'Step 4 of 4 — Reasoning effort'
    body = (
      <Select
        options={EFFORT_OPTIONS}
        defaultFocusValue={state.reasoningEffort}
        onChange={handleEffortSelect}
        onCancel={handleCancel}
      />
    )
  } else if (step === 'confirm') {
    subtitle = 'Review and save'
    body = (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold>API key:</Text>{' '}
            <Text>
              {state.apiKey.slice(0, 4)}…{state.apiKey.slice(-4)} (
              {state.apiKey.length} chars)
            </Text>
          </Text>
          <Text>
            <Text bold>Base URL:</Text> <Text>{state.baseUrl}</Text>
          </Text>
          <Text>
            <Text bold>Model:</Text> <Text>{state.model}</Text>
          </Text>
          <Text>
            <Text bold>Reasoning effort:</Text>{' '}
            <Text>{state.reasoningEffort}</Text>
          </Text>
        </Box>
        <Select
          options={CONFIRM_OPTIONS}
          onChange={handleConfirm}
          onCancel={handleCancel}
        />
      </Box>
    )
  }

  return (
    <Dialog
      title="Deep Code · DeepSeek setup"
      subtitle={subtitle}
      color="permission"
      onCancel={handleCancel}
      inputGuide={renderInputGuide}
      isCancelActive={!isTextStep}
    >
      {body}
    </Dialog>
  )
}
