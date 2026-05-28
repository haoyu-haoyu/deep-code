import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(testDir, '..')
const repoRoot = resolve(packageDir, '..', '..')

test('npm pack dry-run includes required runtime files', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'deepcode-npm-cache-'))
  t.after(() => rm(cacheDir, { force: true, recursive: true }))

  const result = await runNpm(['pack', '--dry-run'], {
    npm_config_cache: cacheDir,
    NPM_CONFIG_CACHE: cacheDir,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  })

  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.code, 0, output)
  assert.match(output, /dist\/deepcode-full\.mjs/)
  assert.match(output, /deepcode\.js/)
  assert.match(output, /package\.json/)
})

test('release workflow keeps npm publish disabled', async () => {
  const workflow = await readFile(
    join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  )
  const activePublishLines = workflow
    .split('\n')
    .filter(line => line.includes('npm publish'))
    .filter(line => !line.trimStart().startsWith('#'))

  assert.deepEqual(activePublishLines, [])
  assert.match(workflow, /npm pack --dry-run/)
  assert.match(workflow, /Real publish step disabled until P3\.1\.b\/c/)
})

function runNpm(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', args, {
      cwd: packageDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => {
      resolvePromise({ code, stdout, stderr })
    })
  })
}
