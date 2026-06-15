// Pure escape-sequence boundary tokenizer, extracted from tokenize.ts so it can
// be unit-tested directly under `node --test` (the .ts can't be). tokenize.ts
// imports `tokenize` from here and keeps the stateful createTokenizer wrapper.
//
// The byte constants below mirror ansi.ts (C0 / ESC_TYPE / isEscFinal) and
// csi.ts (CSI_RANGE / isCSI*). They are frozen ECMA-48 / ANSI X3.64 values; the
// extraction is proven byte-identical to the original tokenize() by a
// differential fuzz (see test/tokenizer-meta-input.test.mjs) with metaInput off.
const ESC = 0x1b // C0.ESC
const BEL = 0x07 // C0.BEL
const CSI = 0x5b // ESC_TYPE.CSI — '['
const OSC = 0x5d // ESC_TYPE.OSC — ']'
const DCS = 0x50 // ESC_TYPE.DCS — 'P'
const APC = 0x5f // ESC_TYPE.APC — '_'
const ST = 0x5c // ESC_TYPE.ST  — '\'
const SS3 = 0x4f // 'O' — SS3 introducer
const MOUSE_M = 0x4d // 'M' — X10 mouse prefix

const isEscFinal = b => b >= 0x30 && b <= 0x7e
const isCSIFinal = b => b >= 0x40 && b <= 0x7e
const isCSIIntermediate = b => b >= 0x20 && b <= 0x2f
const isCSIParam = b => b >= 0x30 && b <= 0x3f

/**
 * @param {string} input
 * @param {string} initialState
 * @param {string} initialBuffer
 * @param {boolean} flush
 * @param {boolean} x10Mouse
 * @param {boolean} [metaInput] stdin only: decode ESC-prefixed meta keys
 *   (Alt/Option). OFF for output parsing, where ESC ESC and ESC+intermediate
 *   carry terminal-control meaning rather than a Meta modifier.
 * @returns {{ tokens: Array<{type:string,value:string}>, state: {state:string, buffer:string} }}
 */
export function tokenize(
  input,
  initialState,
  initialBuffer,
  flush,
  x10Mouse,
  metaInput = false,
) {
  const tokens = []
  const result = {
    state: initialState,
    buffer: '',
  }

  const data = initialBuffer + input
  let i = 0
  let textStart = 0
  let seqStart = 0

  const flushText = () => {
    if (i > textStart) {
      const text = data.slice(textStart, i)
      if (text) {
        tokens.push({ type: 'text', value: text })
      }
    }
    textStart = i
  }

  const emitSequence = seq => {
    if (seq) {
      tokens.push({ type: 'sequence', value: seq })
    }
    result.state = 'ground'
    textStart = i
  }

  while (i < data.length) {
    const code = data.charCodeAt(i)

    switch (result.state) {
      case 'ground':
        if (code === ESC) {
          flushText()
          seqStart = i
          result.state = 'escape'
          i++
        } else {
          i++
        }
        break

      case 'escape':
        if (code === CSI) {
          result.state = 'csi'
          i++
        } else if (code === OSC) {
          result.state = 'osc'
          i++
        } else if (code === DCS) {
          result.state = 'dcs'
          i++
        } else if (code === APC) {
          result.state = 'apc'
          i++
        } else if (code === SS3) {
          // 'O' - SS3
          result.state = 'ss3'
          i++
        } else if (isCSIIntermediate(code)) {
          if (metaInput) {
            // stdin: ESC + 0x20-0x2f is Alt+punctuation — a complete 2-byte meta
            // key. (Charset-designation sequences like `ESC ( B` only arrive in
            // OUTPUT streams, never from the keyboard.) Without this it buffers as
            // escapeIntermediate and swallows the next key into garbage.
            i++
            emitSequence(data.slice(seqStart, i))
          } else {
            // Intermediate byte (e.g., ESC ( for charset) - continue buffering
            result.state = 'escapeIntermediate'
            i++
          }
        } else if (isEscFinal(code)) {
          // Two-character escape sequence
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (code === ESC) {
          const next = i + 1 < data.length ? data.charCodeAt(i + 1) : -1
          if (metaInput && i > seqStart && (next === CSI || next === SS3 || next === -1)) {
            // stdin: a 2nd ESC after we've buffered the 1st is a Meta (Alt/Option)
            // prefix on a following CSI/SS3 key — ESC ESC [ A (Option+Up), ESC ESC
            // O P, etc. — NOT two Escape presses. Keep the leading ESC so the whole
            // thing emits as ONE token; parse-keypress then sets option=true
            // instead of firing a phantom Escape that wipes the prompt. When the
            // 2nd ESC ends the chunk (next === -1) keep accumulating and decide on
            // the next feed / flush. A 2nd ESC followed by anything else falls to
            // the split below (lone Escape, then the meta key). The i === seqStart
            // case (re-entry of a single buffered ESC) also falls below, where the
            // slice is empty so emitSequence is a no-op.
            i++
          } else {
            // Double escape - emit first, start new
            emitSequence(data.slice(seqStart, i))
            seqStart = i
            result.state = 'escape'
            i++
          }
        } else {
          // Invalid - treat ESC as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'escapeIntermediate':
        // After intermediate byte(s), wait for final byte
        if (isCSIIntermediate(code)) {
          // More intermediate bytes
          i++
        } else if (isEscFinal(code)) {
          // Final byte - complete the sequence
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          // Invalid - treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'csi':
        // X10 mouse: CSI M + 3 raw payload bytes (Cb+32, Cx+32, Cy+32).
        // M immediately after [ (offset 2) means no params — SGR mouse
        // (CSI < … M) has a `<` param byte first and reaches M at offset > 2.
        if (
          x10Mouse &&
          code === MOUSE_M &&
          i - seqStart === 2 &&
          (i + 1 >= data.length || data.charCodeAt(i + 1) >= 0x20) &&
          (i + 2 >= data.length || data.charCodeAt(i + 2) >= 0x20) &&
          (i + 3 >= data.length || data.charCodeAt(i + 3) >= 0x20)
        ) {
          if (i + 4 <= data.length) {
            i += 4
            emitSequence(data.slice(seqStart, i))
          } else {
            // Incomplete — exit loop; end-of-input buffers from seqStart.
            i = data.length
          }
          break
        }
        if (isCSIFinal(code)) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (isCSIParam(code) || isCSIIntermediate(code)) {
          i++
        } else {
          // Invalid CSI - abort, treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'ss3':
        // SS3 sequences: ESC O followed by a single final byte
        if (code >= 0x40 && code <= 0x7e) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else {
          // Invalid - treat as text
          result.state = 'ground'
          textStart = seqStart
        }
        break

      case 'osc':
        if (code === BEL) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (
          code === ESC &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === ST
        ) {
          i += 2
          emitSequence(data.slice(seqStart, i))
        } else {
          i++
        }
        break

      case 'dcs':
      case 'apc':
        if (code === BEL) {
          i++
          emitSequence(data.slice(seqStart, i))
        } else if (
          code === ESC &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === ST
        ) {
          i += 2
          emitSequence(data.slice(seqStart, i))
        } else {
          i++
        }
        break
    }
  }

  // Handle end of input
  if (result.state === 'ground') {
    flushText()
  } else if (flush) {
    // Force output incomplete sequence
    const remaining = data.slice(seqStart)
    if (remaining) tokens.push({ type: 'sequence', value: remaining })
    result.state = 'ground'
  } else {
    // Buffer incomplete sequence for next call
    result.buffer = data.slice(seqStart)
  }

  return { tokens, state: result }
}
