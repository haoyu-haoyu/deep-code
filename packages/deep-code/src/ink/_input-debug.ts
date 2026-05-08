/**
 * Centralized stderr+file debug log for diagnosing the Ink input dispatch
 * pipeline. Gated on DEEPCODE_INPUT_DEBUG=1 so it has zero overhead in
 * production. Output goes to DEEPCODE_INPUT_DEBUG_FILE (default
 * /tmp/dc_input_debug.log) — using a file because expect/pty stderr
 * capture is unreliable.
 *
 * REMOVE BEFORE COMMITTING. This file is for Phase 1 diagnosis only.
 */
import { appendFileSync } from 'node:fs'

const enabled = process.env.DEEPCODE_INPUT_DEBUG === '1'
const logFile =
  process.env.DEEPCODE_INPUT_DEBUG_FILE ?? '/tmp/dc_input_debug.log'

const startedAt = Date.now()

function fmtBytes(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  return JSON.stringify(
    Array.from(value)
      .map(c => {
        const code = c.charCodeAt(0)
        if (code < 32 || code === 127) {
          return '\\x' + code.toString(16).padStart(2, '0')
        }
        return c
      })
      .join(''),
  )
}

export function dlog(tag: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  try {
    const dt = (Date.now() - startedAt).toString().padStart(6, ' ')
    const parts = Object.entries(data).map(([k, v]) => {
      if (k === 'input' || k === 'chunk' || k === 'bytes') {
        return `${k}=${fmtBytes(v)}`
      }
      return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`
    })
    appendFileSync(logFile, `+${dt}ms [${tag}] ${parts.join(' ')}\n`)
  } catch {
    // ignore - diagnosis logging shouldn't break anything
  }
}

export const inputDebugEnabled = enabled
