import { getInitialSettings } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  applyLspDiagnosticConfig,
  emptyPostEditResult,
  LSP_DEFAULTS as LSP_DEFAULTS_CORE,
  mergeLspConfig,
  resolvePostEditDiagnosticsConfig,
} from './defaults-core.mjs'

export type LspConfig = {
  enabled: boolean
  poll_after_edit_ms: number
  max_diagnostics_per_file: number
  include_warnings: boolean
}

export const LSP_DEFAULTS = LSP_DEFAULTS_CORE as LspConfig

export function getLspConfig(
  settings: Pick<SettingsJson, 'lsp'> = getInitialSettings(),
): LspConfig {
  return mergeLspConfig(settings) as LspConfig
}

export {
  applyLspDiagnosticConfig,
  emptyPostEditResult,
  mergeLspConfig,
  resolvePostEditDiagnosticsConfig,
}
