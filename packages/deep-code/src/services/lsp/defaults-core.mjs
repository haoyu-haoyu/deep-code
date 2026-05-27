export const LSP_DEFAULTS = Object.freeze({
  enabled: true,
  poll_after_edit_ms: 500,
  max_diagnostics_per_file: 10,
  include_warnings: true,
})

export function mergeLspConfig(settings = {}) {
  const lsp = settings?.lsp ?? {}

  return {
    enabled:
      typeof lsp.enabled === 'boolean' ? lsp.enabled : LSP_DEFAULTS.enabled,
    poll_after_edit_ms: positiveInteger(
      lsp.poll_after_edit_ms,
      LSP_DEFAULTS.poll_after_edit_ms,
    ),
    max_diagnostics_per_file: positiveInteger(
      lsp.max_diagnostics_per_file,
      LSP_DEFAULTS.max_diagnostics_per_file,
    ),
    include_warnings:
      typeof lsp.include_warnings === 'boolean'
        ? lsp.include_warnings
        : LSP_DEFAULTS.include_warnings,
  }
}

export function resolvePostEditDiagnosticsConfig({
  settings = {},
  pollDelay,
  maxDiagnostics,
} = {}) {
  const config = mergeLspConfig(settings)
  return {
    ...config,
    poll_after_edit_ms: positiveInteger(pollDelay, config.poll_after_edit_ms),
    max_diagnostics_per_file: positiveInteger(
      maxDiagnostics,
      config.max_diagnostics_per_file,
    ),
  }
}

export function applyLspDiagnosticConfig(result, config) {
  const maxDiagnostics = positiveInteger(
    config.max_diagnostics_per_file,
    LSP_DEFAULTS.max_diagnostics_per_file,
  )
  const diagnostics = (result?.diagnostics ?? []).filter(diagnostic =>
    shouldIncludeDiagnostic(diagnostic, config),
  )
  const truncated =
    Boolean(result?.truncated) || diagnostics.length > maxDiagnostics

  return {
    diagnostics: diagnostics.slice(0, maxDiagnostics),
    elapsed: result?.elapsed ?? 0,
    truncated,
  }
}

export function emptyPostEditResult(started = Date.now()) {
  return {
    diagnostics: [],
    elapsed: Math.max(0, Date.now() - started),
    truncated: false,
  }
}

function shouldIncludeDiagnostic(diagnostic, config) {
  if (config.include_warnings !== false) {
    return true
  }

  const severity = diagnostic?.severity
  return severity === 'Error' || severity === 1 || severity === undefined
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
