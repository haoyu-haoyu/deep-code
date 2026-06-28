import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the directory for Node's persistent V8 compile cache
 * (NODE_COMPILE_CACHE) used by the spawned full-CLI bundle child.
 *
 * The full CLI is a single ~15MB bundle that Node re-parses+re-compiles on every
 * launch. Pointing NODE_COMPILE_CACHE at a persistent dir lets Node reuse the
 * compiled bytecode across launches (measured ~0.21s -> ~0.08s top-level eval on
 * Node 22, a one-time ~2.4MB cache). NODE_COMPILE_CACHE is read by Node >=22.1
 * and is a silent no-op on older Node, so setting it is always safe.
 *
 * Semantics:
 *  - a user-set NODE_COMPILE_CACHE wins (returned unchanged) — never override an
 *    explicit choice;
 *  - otherwise the dir lives under the DeepCode config home (DEEPCODE_CONFIG_DIR
 *    or ~/.deepcode), matching the rest of the launcher's paths;
 *  - it is scoped per Node version: Node content+version keys entries internally,
 *    but a per-version dir also stops a Node upgrade from accumulating stale
 *    cross-version entries in one directory.
 *
 * @param {{ env?: Record<string, string | undefined>, homeDir?: string, nodeVersion?: string }} [opts]
 * @returns {string}
 */
export function resolveCompileCacheDir({
  env = process.env,
  homeDir = homedir(),
  nodeVersion = process.version,
} = {}) {
  if (env.NODE_COMPILE_CACHE) return env.NODE_COMPILE_CACHE
  const base = env.DEEPCODE_CONFIG_DIR || join(homeDir, '.deepcode')
  return join(base, 'compile-cache', nodeVersion)
}
