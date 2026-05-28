import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageDir = resolve(testDir, '..')
const repoRoot = resolve(packageDir, '../..')

test('build-binaries script defines the three supported bun compile targets', async () => {
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

test('release workflow builds binary artifacts and creates GitHub releases from tag pushes', async () => {
  const workflow = await readFile(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')

  assert.match(workflow, /tags:\n\s+- 'v\*'/)
  assert.match(workflow, /\n  build-binaries:\n/)
  assert.match(workflow, /\n    needs: pack-and-validate\n/)
  assert.match(workflow, /\n    runs-on: \$\{\{ matrix\.os \}\}/)
  assert.match(workflow, /os: ubuntu-latest\n\s+target: bun-linux-x64\n\s+name: deepcode-linux-x64/)
  assert.match(workflow, /os: macos-latest\n\s+target: bun-darwin-x64\n\s+name: deepcode-darwin-x64/)
  assert.match(workflow, /os: macos-14\n\s+target: bun-darwin-arm64\n\s+name: deepcode-darwin-arm64/)
  assert.match(workflow, /bun build dist\/deepcode-full\.mjs --compile --target=\$\{\{ matrix\.target \}\} --outfile=\$\{\{ matrix\.name \}\}/)
  assert.match(workflow, /uses: actions\/upload-artifact@v4/)
  assert.match(workflow, /path: packages\/deep-code\/\$\{\{ matrix\.name \}\}/)

  assert.match(workflow, /\n  create-release:\n/)
  assert.match(workflow, /\n    needs: build-binaries\n/)
  assert.match(workflow, /\n      contents: write\n/)
  assert.match(workflow, /uses: actions\/download-artifact@v4/)
  assert.match(workflow, /uses: softprops\/action-gh-release@v2/)
  assert.match(workflow, /files: artifacts\/\*\*\/*/)
  assert.match(workflow, /draft: false/)
  assert.match(workflow, /prerelease: \$\{\{ contains\(github\.ref_name, '-rc'\) \}\}/)
  assert.match(workflow, /generate_release_notes: true/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /PERSONAL_ACCESS_TOKEN|PAT|GH_TOKEN/)
  assert.match(workflow, /# - name: npm publish/)
})

test('CI registers the P3.3 static binary-release test without compiling binaries', async () => {
  const ci = await readFile(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8')

  assert.match(ci, /test\/p3-3-binaries\.test\.mjs/)
  assert.doesNotMatch(ci, /bun build dist\/deepcode-full\.mjs --compile/)
})

test('install docs cover Release binaries, Docker, and deferred npm install', async () => {
  const docs = await readFile(resolve(repoRoot, 'docs/install.md'), 'utf8')

  assert.match(docs, /deepcode-darwin-arm64/)
  assert.match(docs, /deepcode-darwin-x64/)
  assert.match(docs, /deepcode-linux-x64/)
  assert.match(docs, /releases\/latest\/download/)
  assert.match(docs, /chmod \+x \/usr\/local\/bin\/deepcode/)
  assert.match(docs, /docker run -v "\$\(pwd\)":\/workspace ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
  assert.match(docs, /npm install -g @deepcode-ai\/deep-code/)
  assert.match(docs, /deferred/i)
})
