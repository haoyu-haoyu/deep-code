import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageDir = resolve(testDir, '..')
const repoRoot = resolve(packageDir, '../..')

test('build-binaries script is preserved as deferred reference', async () => {
  const script = await readFile(resolve(packageDir, 'scripts/build-binaries.mjs'), 'utf8')

  for (const [target, name] of [
    ['bun-linux-x64', 'deepcode-linux-x64'],
    ['bun-darwin-x64', 'deepcode-darwin-x64'],
    ['bun-darwin-arm64', 'deepcode-darwin-arm64'],
  ]) {
    assert.match(script, new RegExp(`target: '${target}'`))
    assert.match(script, new RegExp(`name: '${name}'`))
  }

  assert.match(script, /spawn\('bun'/)
  assert.match(script, /dist\/deepcode-full\.mjs/)
  assert.match(script, /--compile/)
  assert.match(script, /--target=\$\{target\}/)
  assert.match(script, /--outfile=binaries\/\$\{name\}/)
  assert.match(script, /mkdir\('binaries', \{ recursive: true \}\)/)
  assert.doesNotMatch(script, /windows/i)
})

test('release workflow keeps binary jobs disabled with deferred rationale', async () => {
  const workflow = await readFile(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')

  assert.match(workflow, /tags:\n\s+- 'v\*'/)
  assert.match(workflow, /\n  pack-and-validate:\n/)
  assert.match(workflow, /\n  docker-publish:\n/)
  assert.doesNotMatch(workflow, /^\s{2}build-binaries:\s*$/m)
  assert.doesNotMatch(workflow, /^\s{2}create-release:\s*$/m)
  assert.doesNotMatch(workflow, /^[^#\n]*bun build dist\/deepcode-full\.mjs --compile/m)
  assert.match(workflow, /DEFERRED: Binary distribution path/)
  assert.match(workflow, /Cannot find package 'cssfilter'/)
  assert.match(workflow, /Docker \(GHCR\) .* working via docker-publish job/)
  assert.match(workflow, /^# build-binaries:/m)
  assert.match(workflow, /^# create-release:/m)
  assert.match(workflow, /^#\s+bun build dist\/deepcode-full\.mjs --compile --target=\$\{\{ matrix\.target \}\} --outfile=\$\{\{ matrix\.name \}\}/m)
  assert.match(workflow, /^#\s+uses: softprops\/action-gh-release@v2/m)
  assert.match(workflow, /^#\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/m)
  assert.doesNotMatch(workflow, /PERSONAL_ACCESS_TOKEN|PAT|GH_TOKEN/)
  assert.match(workflow, /# - name: npm publish/)
})

test('CI registers the P3.3 static binary-release test without compiling binaries', async () => {
  const ci = await readFile(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8')

  assert.match(ci, /test\/p3-3-binaries\.test\.mjs/)
  assert.doesNotMatch(ci, /bun build dist\/deepcode-full\.mjs --compile/)
})

test('install docs mark binaries deferred while keeping Docker and npm paths', async () => {
  const docs = await readFile(resolve(repoRoot, 'docs/install.md'), 'utf8')

  assert.match(docs, /## Pre-built binaries \(deferred\)/)
  assert.match(docs, /P3\.3 binary distribution is currently deferred/)
  assert.match(docs, /\.github\/workflows\/release\.yml/)
  assert.doesNotMatch(docs, /releases\/latest\/download\/deepcode-/)
  assert.doesNotMatch(docs, /deepcode-darwin-arm64|deepcode-darwin-x64|deepcode-linux-x64/)
  assert.match(docs, /docker run -v "\$\(pwd\)":\/workspace ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
  assert.match(docs, /npm install -g @deepcode-ai\/deep-code/)
  assert.match(docs, /deferred/i)
})
