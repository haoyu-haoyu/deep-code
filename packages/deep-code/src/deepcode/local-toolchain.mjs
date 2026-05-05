import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  createDeepSeekCacheDiagnostics,
  runDeepSeekAgent,
} from './deepseek-native.mjs'

const execFileAsync = promisify(execFile)

export async function runDeepSeekLocalToolChain({
  prompt,
  cwd = process.cwd(),
  env = process.env,
  provider,
  maxTurns = 10,
} = {}) {
  const result = await runDeepSeekAgent({
    prompt,
    cwd,
    env,
    provider,
    maxTurns,
    systemPrompt: [
      'You are Deep Code running a DeepSeek-native local tool chain.',
      'Use the provided tools when the user asks you to inspect, edit, or verify files.',
      'For file update workflows, prefer this sequence: Read, Edit, Bash, Read, then answer concisely.',
    ],
    tools: createDeepSeekLocalTools({ cwd }),
  })

  return {
    ...result,
    cacheDiagnostics: result.usage
      ? createDeepSeekCacheDiagnostics(result.usage)
      : null,
  }
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
        await writeFile(filePath, current.replace(oldString, newString))
        return `Updated ${input.file_path}`
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

export function resolveWorkspacePath(workspaceRoot, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_path is required')
  }
  const root = resolve(workspaceRoot)
  const resolved = resolve(root, filePath)
  const rel = relative(root, resolved)
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))) {
    return resolved
  }
  throw new Error(`Path is outside workspace: ${filePath}`)
}
