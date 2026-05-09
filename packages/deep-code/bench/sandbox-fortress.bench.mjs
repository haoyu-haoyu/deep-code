import { realpathSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

export async function runSandboxFortressBenchmarks() {
  const startedAt = performance.now()

  return {
    name: 'sandbox-fortress',
    benchmarks: [],
    durationMs: performance.now() - startedAt,
  }
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  const result = await runSandboxFortressBenchmarks()
  console.log(JSON.stringify(result, null, 2))
}
