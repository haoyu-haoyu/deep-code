import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageDir = resolve(testDir, '..')
const repoRoot = resolve(packageDir, '../..')

test('Dockerfile defines a two-stage Node 22 image with DeepCode entrypoint', async () => {
  const dockerfile = await readFile(resolve(repoRoot, 'Dockerfile'), 'utf8')

  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1/m)
  assert.match(dockerfile, /^FROM node:22-slim AS builder/m)
  assert.match(dockerfile, /^FROM node:22-slim AS runtime/m)
  assert.match(dockerfile, /RUN npm ci/)
  assert.match(dockerfile, /RUN npm install -g bun@latest/)
  assert.match(dockerfile, /RUN cd packages\/deep-code && bun run build:full-cli/)
  assert.match(dockerfile, /COPY --from=builder \/build\/packages\/deep-code\/dist \/app\/dist/)
  assert.match(dockerfile, /COPY --from=builder \/build\/packages\/deep-code\/src \/app\/src/)
  assert.match(dockerfile, /COPY --from=builder \/build\/packages\/deep-code\/deepcode\.js \/app\/deepcode\.js/)
  assert.match(dockerfile, /VOLUME \["\/workspace"\]/)
  assert.match(dockerfile, /WORKDIR \/workspace/)
  assert.match(dockerfile, /ENTRYPOINT \["node", "\/app\/deepcode\.js"\]/)
  assert.match(dockerfile, /CMD \["--help"\]/)
})

test('.dockerignore excludes local-only and rebuilt artifacts', async () => {
  const dockerignore = await readFile(resolve(repoRoot, '.dockerignore'), 'utf8')
  const entries = new Set(
    dockerignore
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')),
  )

  for (const expected of [
    'node_modules/',
    'packages/deep-code/node_modules/',
    '.git/',
    '.github/',
    'packages/deep-code/test/',
    'packages/deep-code/dist/',
    'audit/',
    'docs/',
    '*.md',
    '.deepcode/',
    'P1_*.md',
    'P2_*.md',
    'P3_*.md',
    'EXECUTION_LOG.md',
    'TODO.md',
  ]) {
    assert.ok(entries.has(expected), `missing .dockerignore entry ${expected}`)
  }
})

test('release workflow publishes Docker image to GHCR after pack validation', async () => {
  const workflow = await readFile(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')

  assert.match(workflow, /\n  docker-publish:\n/)
  assert.match(workflow, /\n    needs: pack-and-validate\n/)
  assert.match(workflow, /\n\s+packages: write\n/)
  assert.match(workflow, /uses: docker\/login-action@v3/)
  assert.match(workflow, /registry: ghcr\.io/)
  assert.match(workflow, /username: \$\{\{ github\.actor \}\}/)
  assert.match(workflow, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(workflow, /uses: docker\/setup-qemu-action@v3/)
  assert.match(workflow, /platforms: linux\/arm64/)
  assert.match(workflow, /uses: docker\/setup-buildx-action@v3/)
  assert.match(workflow, /uses: docker\/build-push-action@v5/)
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/)
  assert.ok(
    workflow.indexOf('uses: docker/setup-qemu-action@v3') <
      workflow.indexOf('uses: docker/setup-buildx-action@v3'),
    'QEMU setup must run before Docker Buildx',
  )
  assert.match(workflow, /ghcr\.io\/haoyu-haoyu\/deepcode:\$\{\{ steps\.version\.outputs\.version \}\}/)
  assert.match(workflow, /ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
  assert.doesNotMatch(workflow, /GHCR_TOKEN|PERSONAL_ACCESS_TOKEN|DOCKERHUB_TOKEN/)
  assert.match(workflow, /# - name: npm publish/)
})

test('install docs describe multi-arch Docker pull behavior', async () => {
  const docs = await readFile(resolve(repoRoot, 'docs/install.md'), 'utf8')

  assert.match(docs, /Docker \(multi-arch: linux\/amd64 \+ linux\/arm64\)/)
  assert.match(docs, /Auto-selects matching platform/)
  assert.match(docs, /docker pull ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
  assert.match(docs, /docker pull --platform linux\/arm64 ghcr\.io\/haoyu-haoyu\/deepcode:latest/)
})

test('CI registers the P3.2 static Docker test without running docker build', async () => {
  const ci = await readFile(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8')

  assert.match(ci, /test\/p3-2-docker\.test\.mjs/)
  assert.doesNotMatch(ci, /docker build -t deepcode:test/)
})
