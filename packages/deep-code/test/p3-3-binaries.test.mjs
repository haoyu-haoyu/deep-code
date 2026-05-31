import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageDir = resolve(testDir, '..')
const repoRoot = resolve(packageDir, '../..')

test('build-binaries compiles each target from the self-contained inline bundle', async () => {
  const script = await readFile(resolve(packageDir, 'scripts/build-binaries.mjs'), 'utf8')

  for (const [target, name] of [
    ['bun-linux-x64', 'deepcode-linux-x64'],
    ['bun-darwin-x64', 'deepcode-darwin-x64'],
    ['bun-darwin-arm64', 'deepcode-darwin-arm64'],
  ]) {
    assert.match(script, new RegExp(`target: '${target}'`))
    assert.match(script, new RegExp(`name: '${name}'`))
  }

  // Compiles from the inline (self-contained) bundle, not the lean npm bundle.
  assert.match(script, /dist\/deepcode-full-inline\.mjs/)
  assert.doesNotMatch(script, /'dist\/deepcode-full\.mjs'/)
  // Builds the inline bundle first.
  assert.match(script, /--inline-requires/)
  assert.match(script, /--compile/)
  assert.match(script, /--target=\$\{target\}/)
  assert.match(script, /--outfile=binaries\/\$\{name\}/)
  assert.match(script, /mkdir\('binaries', \{ recursive: true \}\)/)

  // Smoke gate: a broken binary (unresolved dep) must fail the build.
  assert.match(script, /--version/)
  assert.match(script, /cannot find package/i)
  assert.match(script, /smokeTestBinary/)

  // No Windows target (bun --compile Windows support is unstable).
  assert.doesNotMatch(script, /windows/i)
})

test('package.json exposes the inline-bundle and binary build scripts', async () => {
  const pkg = JSON.parse(
    await readFile(resolve(packageDir, 'package.json'), 'utf8'),
  )
  assert.equal(
    pkg.scripts['build:full-cli-inline'],
    'bun scripts/build-full-cli.mjs --inline-requires',
  )
  assert.equal(pkg.scripts['build:binaries'], 'node scripts/build-binaries.mjs')
  // The lean bundle build is unchanged.
  assert.equal(pkg.scripts['build:full-cli'], 'bun scripts/build-full-cli.mjs')
})

test('build-full-cli supports --inline-requires for a self-contained bundle', async () => {
  const script = await readFile(
    resolve(packageDir, 'scripts/build-full-cli.mjs'),
    'utf8',
  )
  assert.match(script, /--inline-requires/)
  assert.match(script, /deepcode-full-inline\.mjs/)
  // Inline mode stubs optional/native modules instead of leaving them external,
  // so no unresolvable literal remains for `bun --compile`.
  assert.match(script, /INLINE_STUB_NAMESPACE/)
  assert.match(script, /function externalOrStub/)
})

test('release workflow builds + publishes smoke-gated binaries with checksums', async () => {
  const workflow = await readFile(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')

  assert.match(workflow, /tags:\n\s+- 'v\*'/)
  assert.match(workflow, /\n  pack-and-validate:\n/)
  assert.match(workflow, /\n  docker-publish:\n/)

  // Binary jobs are ACTIVE (real job keys at 2-space indent, not commented).
  assert.match(workflow, /^  build-binaries:\s*$/m)
  assert.match(workflow, /^  create-release:\s*$/m)

  // Compiles from the inline bundle via the smoke-gated build:binaries script.
  assert.match(workflow, /DEEPCODE_BINARY_TARGET=\$\{\{ matrix\.target \}\} npm run build:binaries/)
  assert.match(workflow, /dist\/deepcode-full-inline\.mjs/)
  // Old broken invocation (lean bundle) must be gone.
  assert.doesNotMatch(workflow, /bun build dist\/deepcode-full\.mjs --compile/)

  // Matrix targets (no Windows).
  for (const [os, target] of [
    ['ubuntu-latest', 'bun-linux-x64'],
    ['macos-13', 'bun-darwin-x64'],
    ['macos-14', 'bun-darwin-arm64'],
  ]) {
    assert.match(workflow, new RegExp(`os: ${os}`))
    assert.match(workflow, new RegExp(`target: ${target}`))
  }
  assert.doesNotMatch(workflow, /bun-windows/)

  // Release publishes a SHA256SUMS manifest via the standard action + token.
  assert.match(workflow, /SHA256SUMS/)
  assert.match(workflow, /shasum -a 256/)
  assert.match(workflow, /uses: softprops\/action-gh-release@v2/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /PERSONAL_ACCESS_TOKEN|PAT|GH_TOKEN/)

  // npm publish remains gated (separate from binaries).
  assert.match(workflow, /# - name: npm publish/)
})

test('CI registers the binary-release test without compiling binaries', async () => {
  const ci = await readFile(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8')

  assert.match(ci, /test\/p3-3-binaries\.test\.mjs/)
  assert.doesNotMatch(ci, /--compile/)
})

test('install docs document binary downloads with checksum verification', async () => {
  const docs = await readFile(resolve(repoRoot, 'docs/install.md'), 'utf8')

  assert.match(docs, /## Pre-built binaries/)
  assert.doesNotMatch(docs, /## Pre-built binaries \(deferred\)/)
  assert.match(docs, /releases\/latest\/download\/deepcode-darwin-arm64/)
  assert.match(docs, /deepcode-linux-x64/)
  assert.match(docs, /deepcode-darwin-x64/)
  assert.match(docs, /SHA256SUMS/)
  // Docker + npm sections remain.
  assert.match(docs, /docker run -v "\$\(pwd\)":\/workspace ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
  assert.match(docs, /npm install -g @deepcode-ai\/deep-code/)
})
