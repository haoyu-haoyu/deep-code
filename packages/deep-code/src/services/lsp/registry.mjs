import { accessSync, constants } from 'node:fs'
import * as path from 'node:path'

export const BUILT_IN_LSP_SERVERS = Object.freeze({
  '.ts': Object.freeze({
    command: 'typescript-language-server',
    args: Object.freeze(['--stdio']),
    languageId: 'typescript',
  }),
  '.tsx': Object.freeze({
    command: 'typescript-language-server',
    args: Object.freeze(['--stdio']),
    languageId: 'typescriptreact',
  }),
})

const BUILT_IN_TYPESCRIPT_SERVER_NAME = 'builtin:typescript'

export function resolveLspServer(
  extension,
  pluginRegistry = {},
  { isCommandAvailable: commandAvailable = isCommandAvailable } = {},
) {
  const normalized = normalizeExtension(extension)
  const pluginServer = findServerForExtension(pluginRegistry, normalized)
  if (pluginServer) {
    return cloneServerConfig(pluginServer)
  }

  const builtIn = BUILT_IN_LSP_SERVERS[normalized]
  if (!builtIn || !commandAvailable(builtIn.command)) {
    return undefined
  }

  return {
    command: builtIn.command,
    args: [...builtIn.args],
    extensionToLanguage: {
      [normalized]: builtIn.languageId,
    },
    scope: 'builtin',
    source: 'deepcode',
  }
}

export function mergeBuiltInLspServers(
  pluginRegistry = {},
  options = {},
) {
  const merged = { ...pluginRegistry }
  const extensionToLanguage = {}
  let command
  let args

  for (const extension of Object.keys(BUILT_IN_LSP_SERVERS)) {
    if (findServerForExtension(pluginRegistry, extension)) {
      continue
    }

    const config = resolveLspServer(extension, {}, options)
    if (!config) {
      continue
    }

    command = config.command
    args = config.args
    Object.assign(extensionToLanguage, config.extensionToLanguage)
  }

  if (Object.keys(extensionToLanguage).length > 0 && command) {
    merged[BUILT_IN_TYPESCRIPT_SERVER_NAME] = {
      command,
      args,
      extensionToLanguage,
      scope: 'builtin',
      source: 'deepcode',
    }
  }

  return merged
}

export function isCommandAvailable(command, envPath = process.env.PATH || '') {
  if (!command || command.includes(path.sep)) {
    return isExecutable(command)
  }

  const pathExts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']

  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue
    for (const ext of pathExts) {
      if (isExecutable(path.join(dir, `${command}${ext}`))) {
        return true
      }
    }
  }

  return false
}

function findServerForExtension(registry, extension) {
  for (const config of Object.values(registry)) {
    if (config.extensionToLanguage?.[extension]) {
      return config
    }
  }
  return undefined
}

function normalizeExtension(extension) {
  const normalized = String(extension || '').toLowerCase()
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

function cloneServerConfig(config) {
  return {
    ...config,
    args: config.args ? [...config.args] : undefined,
    env: config.env ? { ...config.env } : undefined,
    extensionToLanguage: { ...config.extensionToLanguage },
  }
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}
