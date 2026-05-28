import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

test('package metadata is ready for public npm dry-run', async () => {
  const metadata = JSON.parse(
    await readFile(join(packageDir, 'package.json'), 'utf8'),
  )

  assert.equal(metadata.name, '@deepcode-ai/deep-code')
  assert.equal(metadata.version, '0.3.0')
  assert.equal(
    metadata.description,
    'DeepSeek-native Deep Code terminal coding assistant for agentic software development.',
  )
  assert.equal(metadata.license, 'AGPL-3.0-only')
  assert.equal(metadata.repository.type, 'git')
  assert.equal(
    metadata.repository.url,
    'git+https://github.com/haoyu-haoyu/deep-code.git',
  )
  assert.equal(metadata.homepage, 'https://github.com/haoyu-haoyu/deep-code#readme')
  assert.equal(metadata.bugs.url, 'https://github.com/haoyu-haoyu/deep-code/issues')
  assert.deepEqual(metadata.publishConfig, {
    access: 'public',
    provenance: true,
  })
  assert.notEqual(metadata.private, true)

  for (const keyword of [
    'deepseek',
    'cli',
    'coding-assistant',
    'agent',
    'ai',
  ]) {
    assert.ok(metadata.keywords.includes(keyword), `missing keyword ${keyword}`)
  }
})

test('real npm pack in a temp directory creates expected tarball', async t => {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepcode-npm-pack-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'deepcode-npm-cache-'))
  t.after(() => rm(tempDir, { force: true, recursive: true }))
  t.after(() => rm(cacheDir, { force: true, recursive: true }))

  const result = await runCommand('npm', ['pack', packageDir], tempDir, {
    npm_config_cache: cacheDir,
    NPM_CONFIG_CACHE: cacheDir,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  })
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.code, 0, output)

  const tarballs = (await readdir(tempDir)).filter(name => name.endsWith('.tgz'))
  assert.equal(tarballs.length, 1)
  assert.match(tarballs[0], /^deepcode-ai-deep-code-0\.3\.0\.tgz$/)

  const tarballPath = join(tempDir, tarballs[0])
  const contents = await runCommand('tar', ['-tzf', tarballPath], tempDir)
  assert.equal(contents.code, 0, `${contents.stdout}\n${contents.stderr}`)
  const files = contents.stdout.split('\n').filter(Boolean)
  assert.ok(files.includes('package/dist/deepcode-full.mjs'))
  assert.ok(files.includes('package/src/deepcode/deepseek-native.mjs'))
  assert.ok(files.includes('package/deepcode.js'))
  assert.ok(files.includes('package/package.json'))
  assert.ok(files.includes('package/LICENSE.md'))
  assert.equal(files.some(file => file.startsWith('package/test/')), false)

  const packedJson = await runCommand(
    'tar',
    ['-xOf', tarballPath, 'package/package.json'],
    tempDir,
  )
  assert.equal(packedJson.code, 0, `${packedJson.stdout}\n${packedJson.stderr}`)
  const metadata = JSON.parse(packedJson.stdout)
  assert.equal(metadata.name, '@deepcode-ai/deep-code')
  assert.equal(metadata.version, '0.3.0')
  assert.equal(metadata.publishConfig.access, 'public')
  assert.equal(metadata.publishConfig.provenance, true)
  assert.notEqual(metadata.private, true)
})

function runNpm(args, env) {
  return runCommand('npm', args, packageDir, env)
}

function runCommand(command, args, cwd, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
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
