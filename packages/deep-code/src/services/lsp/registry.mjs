import { accessSync, constants } from 'node:fs'
import * as path from 'node:path'

export const BUILT_IN_LSP_SERVERS = Object.freeze({
  '.ts': Object.freeze({
    serverName: 'builtin:typescript',
    command: 'typescript-language-server',
    args: Object.freeze(['--stdio']),
    languageId: 'typescript',
  }),
  '.tsx': Object.freeze({
    serverName: 'builtin:typescript',
    command: 'typescript-language-server',
    args: Object.freeze(['--stdio']),
    languageId: 'typescriptreact',
  }),
  '.rs': Object.freeze({
    serverName: 'builtin:rust-analyzer',
    command: 'rust-analyzer',
    args: Object.freeze([]),
    languageId: 'rust',
  }),
  '.go': Object.freeze({
    serverName: 'builtin:gopls',
    command: 'gopls',
    args: Object.freeze(['serve']),
    languageId: 'go',
  }),
  '.py': Object.freeze({
    serverName: 'builtin:pyright',
    command: 'pyright-langserver',
    args: Object.freeze(['--stdio']),
    languageId: 'python',
  }),
  '.c': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'c',
  }),
  '.cpp': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'cpp',
  }),
  '.cc': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'cpp',
  }),
  '.cxx': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'cpp',
  }),
  '.hpp': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'cpp',
  }),
  '.h': Object.freeze({
    serverName: 'builtin:clangd',
    command: 'clangd',
    args: Object.freeze([]),
    languageId: 'c',
  }),
})

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
  const groupedBuiltIns = new Map()

  for (const extension of Object.keys(BUILT_IN_LSP_SERVERS)) {
    if (findServerForExtension(pluginRegistry, extension)) {
      continue
    }

    const config = resolveLspServer(extension, {}, options)
    if (!config) {
      continue
    }

    const serverName = BUILT_IN_LSP_SERVERS[extension].serverName
    if (!groupedBuiltIns.has(serverName)) {
      groupedBuiltIns.set(serverName, {
        command: config.command,
        args: config.args,
        extensionToLanguage: {},
        scope: 'builtin',
        source: 'deepcode',
      })
    }

    Object.assign(
      groupedBuiltIns.get(serverName).extensionToLanguage,
      config.extensionToLanguage,
    )
  }

  for (const [serverName, config] of groupedBuiltIns.entries()) {
    merged[serverName] = config
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
