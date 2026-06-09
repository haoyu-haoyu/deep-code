import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { atomicWriteFile } from '../utils/atomicWrite.mjs'
import {
  createDeepSeekCacheDiagnostics,
  runDeepSeekAgent,
} from './deepseek-native.mjs'
import { createDeepCodeStablePrefix } from './stable-prefix.mjs'

const execFileAsync = promisify(execFile)
const DEEPCODE_LOCAL_TOOLCHAIN_SYSTEM_PROMPT = [
  'You are Deep Code running a DeepSeek-native local tool chain.',
  'Use the provided tools when the user asks you to inspect, edit, or verify files.',
  'For file update workflows, prefer this sequence: Read, Edit, Bash, Read, then answer concisely.',
]

export async function runDeepSeekLocalToolChain({
  prompt,
  cwd = process.cwd(),
  env = process.env,
  provider,
  maxTurns = 10,
  repoSummary = 'Deep Code local toolchain workspace.',
} = {}) {
  const tools = createDeepCodeStableTools({ cwd })
  const stablePrefix = await createDeepCodeStablePrefix({
    systemPrompt: DEEPCODE_LOCAL_TOOLCHAIN_SYSTEM_PROMPT,
    tools,
    repoSummary,
  })
  const result = await runDeepSeekAgent({
    prompt,
    cwd,
    env,
    provider,
    maxTurns,
    systemPrompt: stablePrefix.systemPrompt,
    tools,
  })

  return {
    ...result,
    stablePrefix,
    cacheDiagnostics: result.usage
      ? createDeepSeekCacheDiagnostics(result.usage)
      : null,
  }
}

export function createDeepCodeStableTools({ cwd = process.cwd() } = {}) {
  return createDeepSeekLocalTools({ cwd })
}

export function createDeepSeekLocalTools({ cwd = process.cwd() } = {}) {
  const workspaceRoot = resolve(cwd)
  return [
    {
      name: 'Read',
      description: 'Read a UTF-8 text file from the current workspace.',
      inputJSONSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
        },
        required: ['file_path'],
      },
      async execute(input) {
        const filePath = resolveWorkspacePath(workspaceRoot, input.file_path)
        return await readFile(filePath, 'utf8')
      },
    },
    {
      name: 'Edit',
      description:
        'Replace the first exact string occurrence in a UTF-8 text file from the current workspace.',
      inputJSONSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
      async execute(input) {
        const filePath = resolveWorkspacePath(workspaceRoot, input.file_path)
        const oldString = String(input.old_string ?? '')
        const newString = String(input.new_string ?? '')
        const current = await readFile(filePath, 'utf8')
        if (!current.includes(oldString)) {
          throw new Error(`old_string not found in ${input.file_path}`)
        }
        await atomicWriteFile(filePath, current.replace(oldString, newString))
        return `Updated ${input.file_path}`
      },
    },
    {
      name: 'Write',
      description:
        'Create or overwrite a UTF-8 text file in the current workspace.',
      inputJSONSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['file_path', 'content'],
      },
      async execute(input) {
        const filePath = resolveWorkspacePath(workspaceRoot, input.file_path)
        await atomicWriteFile(filePath, String(input.content ?? ''))
        return `Wrote ${input.file_path}`
      },
    },
    {
      name: 'Bash',
      description:
        'Run a small allowlisted shell-style verification command in the current workspace.',
      inputJSONSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      async execute(input) {
        return await runAllowedBashCommand(workspaceRoot, input.command)
      },
    },
  ]
}

export async function runAllowedBashCommand(workspaceRoot, rawCommand) {
  const command = String(rawCommand ?? '').trim()
  const parts = command.split(/\s+/).filter(Boolean)
  const [program, ...args] = parts

  if (program === 'pwd' && args.length === 0) {
    return `${workspaceRoot}\n`
  }

  if (program === 'cat' && args.length === 1) {
    const filePath = resolveWorkspacePath(workspaceRoot, args[0])
    const { stdout, stderr } = await execFileAsync('cat', [filePath], {
      cwd: workspaceRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    return stdout + stderr
  }

  if (program === 'ls' && args.length <= 1) {
    const target = args.length === 1
      ? resolveWorkspacePath(workspaceRoot, args[0])
      : workspaceRoot
    const { stdout, stderr } = await execFileAsync('ls', ['-la', target], {
      cwd: workspaceRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    return stdout + stderr
  }

  throw new Error(`Bash command is not allowed: ${command}`)
}

function isWithin(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))
}

export function resolveWorkspacePath(workspaceRoot, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_path is required')
  }
  const root = resolve(workspaceRoot)
  const resolved = resolve(root, filePath)
  if (!isWithin(root, resolved)) {
    throw new Error(`Path is outside workspace: ${filePath}`)
  }
  // Canonicalize to defeat symlink escapes: the REAL path must still be inside
  // the REAL workspace root. We realpath the root too because the workspace
  // itself can sit under a symlink (e.g. macOS /tmp -> /private/tmp). When the
  // leaf does not exist yet (a new file), we canonicalize the DEEPEST EXISTING
  // ANCESTOR instead — so a symlinked parent directory pointing outside is
  // caught even before the leaf is created (closes the write-side TOCTOU).
  let realRoot
  try {
    realRoot = realpathSync(root)
  } catch {
    realRoot = root
  }
  let probe = resolved
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let realProbe
    try {
      realProbe = realpathSync(probe)
    } catch {
      const parent = dirname(probe)
      if (parent === probe) break // reached the filesystem root, nothing resolved
      probe = parent
      continue
    }
    if (!isWithin(realRoot, realProbe)) {
      throw new Error(`Path escapes workspace via symlink: ${filePath}`)
    }
    break
  }
  return resolved
}
