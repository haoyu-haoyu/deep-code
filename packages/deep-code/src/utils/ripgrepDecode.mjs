// Streaming UTF-8 decode + ripgrep error classification for the ripgrep spawn
// paths. Pure & node-testable; the .ts caller owns the child-process plumbing.

import { StringDecoder } from 'node:string_decoder'

// A UTF-8-safe streaming accumulator. Feed it raw Buffer chunks from a child's
// stdout/stderr; a multibyte sequence (2-4 bytes) that straddles a chunk
// boundary is held until the next chunk completes it, instead of being decoded
// independently into one or more U+FFFD replacement chars in each half.
//
// This is the project's established idiom for child-stream decoding (see
// stdin.mjs and the setEncoding('utf8') calls in hooks.ts / ShellCommand.ts).
// The embedded `bun --compile` ripgrep path emits raw Buffers (no setEncoding),
// so without this a CJK/accented path or match line landing on a ~64KB chunk
// boundary reaches the model as mojibake it cannot Read back.
//
// Usage: write() per 'data' event, end() once on 'close'/'error' to flush any
// bytes still held from an incomplete trailing sequence.
export function createUtf8ChunkDecoder() {
  const decoder = new StringDecoder('utf8')
  return {
    /** @param {Buffer} chunk @returns {string} safely-decoded text so far */
    write: chunk => decoder.write(chunk),
    /** @returns {string} the final remainder (U+FFFD if the tail was incomplete) */
    end: () => decoder.end(),
  }
}

/**
 * Whether a finished ripgrep invocation failed with a usage error that must be
 * surfaced (an invalid regex or glob, bad arguments) rather than swallowed into
 * an empty "no matches" result — which would mislead the caller into concluding
 * a symbol/file does not exist when the pattern was actually rejected.
 *
 * ripgrep exits 2 on ANY error. Crucially, exit 2 can also accompany a
 * SUCCESSFUL partial search (e.g. it matched files but hit one unreadable
 * directory), in which case stdout carries real matches and must be kept. So the
 * discriminator is exit-2 AND no output: a usage/regex error emits no stdout.
 *
 * @param {{ code: number | string | undefined | null, hasOutput: boolean }} result
 * @returns {boolean}
 */
export function isRipgrepUsageError({ code, hasOutput }) {
  return code === 2 && !hasOutput
}
