/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * The pure implementation lives in the .mjs sibling so it is unit-testable
 * under `node --test`; this wrapper preserves the `src/utils/sanitization`
 * import path and the public `recursivelySanitizeUnicode` type overloads.
 */
import { recursivelySanitizeUnicode as recursivelySanitizeUnicodeImpl } from './sanitization.mjs'

export { partiallySanitizeUnicode } from './sanitization.mjs'

export function recursivelySanitizeUnicode(value: string): string
export function recursivelySanitizeUnicode<T>(value: T[]): T[]
export function recursivelySanitizeUnicode<T extends object>(value: T): T
export function recursivelySanitizeUnicode<T>(value: T): T
export function recursivelySanitizeUnicode(value: unknown): unknown {
  return recursivelySanitizeUnicodeImpl(value)
}
