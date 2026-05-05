import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(packageRoot, 'dist')
const outFile = join(outDir, 'deepcode-full.mjs')

const launcher = `#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.1.0-deepseek-native'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceEntrypoint = join(packageRoot, 'src', 'entrypoints', 'cli.tsx')
const macroPreload = join(packageRoot, 'src', 'deepcode', 'runtime-macro.mjs')

if (process.argv.length === 3 && ['--version', '-v', '-V'].includes(process.argv[2])) {
  console.log(\`\${VERSION} (Deep Code)\`)
  process.exit(0)
}

if (!existsSync(sourceEntrypoint)) {
  console.error(\`Deep Code source CLI entrypoint is missing at \${sourceEntrypoint}\`)
  process.exit(1)
}

const child = spawn(process.env.BUN_BIN ?? 'bun', [
  '--preload',
  macroPreload,
  sourceEntrypoint,
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEEPCODE_PROVIDER: process.env.DEEPCODE_PROVIDER ?? 'deepseek',
    NODE_PATH: [packageRoot, process.env.NODE_PATH].filter(Boolean).join(':'),
  },
  stdio: 'inherit',
})

child.once('error', error => {
  console.error(\`Failed to launch Deep Code full CLI through Bun: \${error.message}\`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1
})
`

await mkdir(outDir, { recursive: true })
await writeFile(outFile, launcher)
await chmod(outFile, 0o755)
console.log(`Built ${outFile}`)
