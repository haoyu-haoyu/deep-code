#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Single-binary distribution. We compile from the SELF-CONTAINED inline bundle
// (dist/deepcode-full-inline.mjs, built via `build:full-cli-inline`) rather than
// the lean npm bundle: `bun --compile` produces an executable with no runtime
// node_modules, so the lean bundle's externalized pure-JS deps (cssfilter, etc.)
// would fail to resolve. The inline bundle inlines those and stubs the
// optional/native/stripped-feature modules, so the binary is standalone.
export const TARGETS = [
  { target: 'bun-linux-x64', name: 'deepcode-linux-x64' },
  { target: 'bun-darwin-x64', name: 'deepcode-darwin-x64' },
  { target: 'bun-darwin-arm64', name: 'deepcode-darwin-arm64' },
]

const INLINE_BUNDLE = 'dist/deepcode-full-inline.mjs'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

export async function buildInlineBundle() {
  await run('bun', ['scripts/build-full-cli.mjs', '--inline-requires'])
}

export async function buildBinary({ target, name }) {
  await run('bun', [
    'build',
    INLINE_BUNDLE,
    '--compile',
    `--target=${target}`,
    `--outfile=binaries/${name}`,
  ])
}

// Map a `bun-<os>-<arch>` target to whether it can run on the current host, so
// we only smoke-test natively-runnable binaries (cross-compiled artifacts are
// validated by the CI matrix runner whose OS matches them).
export function isNativeTarget(target) {
  const match = /^bun-([a-z0-9]+)-([a-z0-9]+)$/.exec(target)
  if (!match) return false
  const [, os, arch] = match
  return os === process.platform && arch === process.arch
}

// A standalone binary that can't resolve a dependency prints "Cannot find
// package" / "Could not resolve" — the exact failure that deferred P3.3. The
// smoke gate fails the build instead of shipping a broken binary.
export function smokeTestBinary(name) {
  const result = spawnSync(`./binaries/${name}`, ['--version'], {
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) {
    throw new Error(
      `smoke test failed for ${name}: --version exited ${result.status}\n${output}`,
    )
  }
  if (/cannot find package|could not resolve/i.test(output)) {
    throw new Error(`smoke test failed for ${name}: unresolved dependency\n${output}`)
  }
  console.log(`smoke ${name}: ${output.trim()}`)
}

export async function buildBinaries(targets = TARGETS) {
  await mkdir('binaries', { recursive: true })
  await buildInlineBundle()
  for (const target of targets) {
    await buildBinary(target)
    if (isNativeTarget(target.target)) {
      smokeTestBinary(target.name)
    } else {
      console.log(`skip smoke ${target.name}: not runnable on ${process.platform}-${process.arch}`)
    }
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  // Optional single-target filter (CI matrix sets DEEPCODE_BINARY_TARGET so each
  // runner compiles + smokes only its own platform).
  const only = process.env.DEEPCODE_BINARY_TARGET
  const targets = only ? TARGETS.filter(t => t.target === only) : TARGETS
  if (only && targets.length === 0) {
    throw new Error(`unknown DEEPCODE_BINARY_TARGET: ${only}`)
  }
  await buildBinaries(targets)
}
