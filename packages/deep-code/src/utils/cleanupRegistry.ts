/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */
import { runCleanupsSettled } from './runCleanupsSettled.mjs'

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown.
 *
 * Uses allSettled (not Promise.all) so one rejecting cleanup — e.g. a slow or
 * unreachable telemetry backend — cannot short-circuit the awaited completion
 * of the others (most importantly the session-transcript and prompt-history
 * flushes) within the shutdown budget.
 */
export async function runCleanupFunctions(): Promise<void> {
  await runCleanupsSettled(Array.from(cleanupFunctions))
}
