#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const TARGETS = [
  { target: 'bun-linux-x64', name: 'deepcode-linux-x64' },
  { target: 'bun-darwin-x64', name: 'deepcode-darwin-x64' },
  { target: 'bun-darwin-arm64', name: 'deepcode-darwin-arm64' },
]

export async function buildBinary({ target, name }) {
  const args = [
    'build',
    'dist/deepcode-full.mjs',
    '--compile',
    `--target=${target}`,
    `--outfile=binaries/${name}`,
  ]

  await new Promise((resolve, reject) => {
    const child = spawn('bun', args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`bun build failed for ${target} with exit code ${code}`))
    })
  })
}

export async function buildBinaries(targets = TARGETS) {
  await mkdir('binaries', { recursive: true })
  for (const target of targets) {
    await buildBinary(target)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  await buildBinaries()
}
