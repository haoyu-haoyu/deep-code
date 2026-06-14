/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */
import { splitEnvVarDefault } from './splitEnvVarDefault.mjs'

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Split on the FIRST ':-' only; the default may itself contain ':-'
    // (varContent.split(':-', 2) would DISCARD the tail, not preserve it).
    const { varName, defaultValue } = splitEnvVarDefault(varContent)
    const envValue = process.env[varName]

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}
