import React, { useCallback, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { getMessage } from '../i18n/index.js'
import { useTranslation } from '../i18n/useTranslation.js'
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
    label: getMessage('setup.deepseek.model.proLabel'),
    value: 'deepseek-v4-pro',
    description: getMessage('setup.deepseek.model.proDescription'),
  },
  {
    label: getMessage('setup.deepseek.model.flashLabel'),
    value: 'deepseek-v4-flash',
    description: getMessage('setup.deepseek.model.flashDescription'),
  },
  {
    label: getMessage('setup.deepseek.model.customLabel'),
    value: '__custom__',
    description: getMessage('setup.deepseek.model.customDescription'),
  },
]

const EFFORT_OPTIONS = [
  {
    label: getMessage('setup.deepseek.effort.maxLabel'),
    value: 'max' as const,
    description: getMessage('setup.deepseek.effort.maxDescription'),
  },
  {
    label: getMessage('setup.deepseek.effort.highLabel'),
    value: 'high' as const,
    description: getMessage('setup.deepseek.effort.highDescription'),
  },
]

const CONFIRM_OPTIONS = [
  { label: getMessage('setup.deepseek.confirm.saveLabel'), value: 'save' as const },
  { label: getMessage('setup.deepseek.confirm.cancelLabel'), value: 'cancel' as const },
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
  const { t } = useTranslation()
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
        setBaseUrlError(t('setup.deepseek.baseUrlErrorInvalid'))
        return
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setBaseUrlError(t('setup.deepseek.baseUrlErrorProtocol'))
        return
      }
      if (parsed.search || parsed.hash) {
        setBaseUrlError(t('setup.deepseek.baseUrlErrorQuery'))
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
    [defaultBaseUrl, t],
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
          <KeyboardShortcutHint shortcut="Enter" action={t('setup.deepseek.hint.continue')} />
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Settings"
            fallback="Esc"
            description={t('setup.deepseek.hint.cancel')}
          />
        </Byline>
      )
    }
    return (
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description={t('setup.deepseek.hint.cancel')}
      />
    )
  }

  let body: React.ReactNode = null
  let subtitle = t('setup.deepseek.subtitleDefault')

  if (step === 'api-key') {
    subtitle = t('setup.deepseek.subtitleApiKey')
    const [apiKeyPromptA, apiKeyPromptB] = t('setup.deepseek.apiKeyPrompt').split('{configPath}')
    body = (
      <Box flexDirection="column">
        <Text>
          {apiKeyPromptA}<Text bold>{configPath}</Text>{apiKeyPromptB}
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
            {t('setup.deepseek.apiKeyHelp')}
          </Text>
        </Box>
      </Box>
    )
  } else if (step === 'base-url') {
    subtitle = t('setup.deepseek.subtitleBaseUrl')
    const [baseUrlPromptA, baseUrlPromptB] = t('setup.deepseek.baseUrlPrompt').split('{defaultBaseUrl}')
    body = (
      <Box flexDirection="column">
        <Text>
          {baseUrlPromptA}<Text bold>{defaultBaseUrl}</Text>{baseUrlPromptB}
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
    subtitle = t('setup.deepseek.subtitleModel')
    if (pickingCustomModel) {
      body = (
        <Box flexDirection="column">
          <Text>{t('setup.deepseek.customModelPrompt')}</Text>
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
    subtitle = t('setup.deepseek.subtitleEffort')
    body = (
      <Select
        options={EFFORT_OPTIONS}
        defaultFocusValue={state.reasoningEffort}
        onChange={handleEffortSelect}
        onCancel={handleCancel}
      />
    )
  } else if (step === 'confirm') {
    subtitle = t('setup.deepseek.subtitleConfirm')
    body = (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold>{t('setup.deepseek.review.apiKeyLabel')}</Text>{' '}
            <Text>
              {state.apiKey.slice(0, 4)}…{state.apiKey.slice(-4)}{' '}
              {t('setup.deepseek.review.apiKeyChars', { count: state.apiKey.length })}
            </Text>
          </Text>
          <Text>
            <Text bold>{t('setup.deepseek.review.baseUrlLabel')}</Text> <Text>{state.baseUrl}</Text>
          </Text>
          <Text>
            <Text bold>{t('setup.deepseek.review.modelLabel')}</Text> <Text>{state.model}</Text>
          </Text>
          <Text>
            <Text bold>{t('setup.deepseek.review.effortLabel')}</Text>{' '}
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
      title={t('setup.deepseek.title')}
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
