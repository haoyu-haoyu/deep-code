import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function initializeSideGit(gitDir, workTree) {
  const resolvedGitDir = resolve(gitDir)
  const resolvedWorkTree = resolve(workTree)
  assertSideGitIsSeparate(resolvedGitDir, resolvedWorkTree)

  await mkdir(dirname(resolvedGitDir), { recursive: true })
  await runSideGit(resolvedGitDir, resolvedWorkTree, ['init'])
  await runSideGit(resolvedGitDir, resolvedWorkTree, [
    'config',
    'user.name',
    'deepcode-bot',
  ])
  await runSideGit(resolvedGitDir, resolvedWorkTree, [
    'config',
    'user.email',
    'deepcode-bot@example.invalid',
  ])
  await runSideGit(resolvedGitDir, resolvedWorkTree, [
    'config',
    'commit.gpgsign',
    'false',
  ])
}

export async function runSideGit(gitDir, workTree, args) {
  try {
    const result = await execFileAsync(
      'git',
      [`--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    return result.stdout
  } catch (error) {
    const command = ['git', `--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args]
      .map(part => JSON.stringify(part))
      .join(' ')
    throw new Error(
      `Snapshot git command failed: ${command}\n${error.stderr ?? error.message}`,
    )
  }
}

function assertSideGitIsSeparate(gitDir, workTree) {
  const userGitDir = findUserGitDir(workTree)
  if (!userGitDir) return
  if (normalizeExistingPath(gitDir) === normalizeExistingPath(userGitDir)) {
    throw new Error("Snapshot side-git directory must not be the user's .git")
  }
}

function findUserGitDir(startPath) {
  let current = resolve(startPath)
  while (true) {
    const candidate = join(current, '.git')
    if (existsSync(candidate)) {
      const stat = statSync(candidate)
      if (stat.isDirectory()) return candidate
      if (stat.isFile()) {
        const raw = readFileSync(candidate, 'utf8').trim()
        const match = raw.match(/^gitdir:\s*(.+)$/)
        if (!match) return candidate
        const gitDir = match[1]
        return isAbsolute(gitDir) ? gitDir : resolve(current, gitDir)
      }
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function normalizeExistingPath(path) {
  const resolved = resolve(path)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}
