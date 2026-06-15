import assert from 'node:assert/strict'
import { test } from 'node:test'

import { tokenize } from '../src/ink/termio/tokenizeCore.mjs'

const ESC = '\x1b'

// Drive a fresh stateful run across one or more input chunks, then flush.
function run(chunks, { metaInput = false, x10Mouse = false, flush = true } = {}) {
  let state = 'ground'
  let buffer = ''
  const tokens = []
  for (const chunk of chunks) {
    const r = tokenize(chunk, state, buffer, false, x10Mouse, metaInput)
    state = r.state.state
    buffer = r.state.buffer
    tokens.push(...r.tokens)
  }
  if (flush) {
    const r = tokenize('', state, buffer, true, x10Mouse, metaInput)
    tokens.push(...r.tokens)
  }
  return tokens
}

const seqs = toks => toks.filter(t => t.type === 'sequence').map(t => t.value)

// ---------------------------------------------------------------------------
// #3 — ESC ESC [ A (Option/Alt + Arrow) must be ONE meta-prefixed token, not a
// phantom Escape + a plain arrow.
// ---------------------------------------------------------------------------
test('metaInput: ESC ESC [ A is a single meta-prefixed CSI token', () => {
  const toks = run([ESC + ESC + '[A'], { metaInput: true })
  assert.deepEqual(toks, [{ type: 'sequence', value: ESC + ESC + '[A' }])
})

test('metaInput: ESC ESC O P (meta-prefixed SS3) is a single token', () => {
  const toks = run([ESC + ESC + 'OP'], { metaInput: true })
  assert.deepEqual(toks, [{ type: 'sequence', value: ESC + ESC + 'OP' }])
})

test('metaInput: ESC ESC [ A split across chunks still merges into one token', () => {
  for (const split of [1, 2, 3]) {
    const full = ESC + ESC + '[A'
    const toks = run([full.slice(0, split), full.slice(split)], {
      metaInput: true,
    })
    assert.deepEqual(
      toks,
      [{ type: 'sequence', value: full }],
      `split at ${split}`,
    )
  }
})

test('metaInput: a lone double-Escape (no following key) flushes as ONE token', () => {
  // parse-keypress decodes ESC ESC as Alt+Escape (s === "\x1b\x1b").
  const toks = run([ESC + ESC], { metaInput: true })
  assert.deepEqual(toks, [{ type: 'sequence', value: ESC + ESC }])
})

test('metaInput: ESC ESC + a (Escape then Alt+a) stays SPLIT into two tokens', () => {
  // A 2nd ESC NOT followed by a CSI/SS3 introducer is a real Escape press
  // followed by a meta key — must not be merged.
  const toks = run([ESC + ESC + 'a'], { metaInput: true })
  assert.deepEqual(seqs(toks), [ESC, ESC + 'a'])
})

// ---------------------------------------------------------------------------
// #4 — ESC + 0x20-0x2f (Alt + punctuation) must be a complete 2-byte meta key,
// not buffered as a charset-designation intermediate that eats the next key.
// ---------------------------------------------------------------------------
test('metaInput: ESC + "-" (Alt+-) is a complete 2-byte token', () => {
  const toks = run([ESC + '-'], { metaInput: true })
  assert.deepEqual(toks, [{ type: 'sequence', value: ESC + '-' }])
})

test('metaInput: ESC + space (Alt+Space) is one token and does not eat the next key', () => {
  const toks = run([ESC + ' ' + 'x'], { metaInput: true })
  // ESC+space is the meta key; 'x' is plain text after it.
  assert.deepEqual(toks, [
    { type: 'sequence', value: ESC + ' ' },
    { type: 'text', value: 'x' },
  ])
})

test('metaInput: every ESC + 0x20-0x2f is a standalone 2-byte token', () => {
  for (let c = 0x20; c <= 0x2f; c++) {
    const ch = String.fromCharCode(c)
    const toks = run([ESC + ch + 'Z'], { metaInput: true })
    assert.deepEqual(
      toks,
      [
        { type: 'sequence', value: ESC + ch },
        { type: 'text', value: 'Z' },
      ],
      `ESC+0x${c.toString(16)}`,
    )
  }
})

// ---------------------------------------------------------------------------
// metaInput OFF (output parsing) must preserve the ORIGINAL behavior exactly.
// ---------------------------------------------------------------------------
test('metaInput OFF: ESC ESC [ A splits (lone ESC, then CSI) as before', () => {
  const toks = run([ESC + ESC + '[A'], { metaInput: false })
  assert.deepEqual(seqs(toks), [ESC, ESC + '[A'])
})

test('metaInput OFF: ESC ( B is a 3-byte charset designation as before', () => {
  const toks = run([ESC + '(B'], { metaInput: false })
  assert.deepEqual(toks, [{ type: 'sequence', value: ESC + '(B' }])
})

// ---------------------------------------------------------------------------
// Differential fuzz: with metaInput OFF, tokenizeCore must be byte-identical to
// an independent transcription of the original tokenizer, over random inputs
// fed in random chunk splits. This proves the .ts -> .mjs extraction is faithful.
// ---------------------------------------------------------------------------

// Faithful transcription of the ORIGINAL tokenize (pre-metaInput). Constants are
// the same ECMA-48 values. No metaInput branch exists here.
function referenceTokenize(input, initialState, initialBuffer, flush, x10Mouse) {
  const E = 0x1b,
    BEL = 0x07,
    LBR = 0x5b,
    RBR = 0x5d,
    P = 0x50,
    US = 0x5f,
    BSL = 0x5c,
    O = 0x4f,
    M = 0x4d
  const escFinal = b => b >= 0x30 && b <= 0x7e
  const csiFinal = b => b >= 0x40 && b <= 0x7e
  const csiInter = b => b >= 0x20 && b <= 0x2f
  const csiParam = b => b >= 0x30 && b <= 0x3f
  const tokens = []
  const result = { state: initialState, buffer: '' }
  const data = initialBuffer + input
  let i = 0,
    textStart = 0,
    seqStart = 0
  const flushText = () => {
    if (i > textStart) {
      const t = data.slice(textStart, i)
      if (t) tokens.push({ type: 'text', value: t })
    }
    textStart = i
  }
  const emit = seq => {
    if (seq) tokens.push({ type: 'sequence', value: seq })
    result.state = 'ground'
    textStart = i
  }
  while (i < data.length) {
    const code = data.charCodeAt(i)
    switch (result.state) {
      case 'ground':
        if (code === E) {
          flushText()
          seqStart = i
          result.state = 'escape'
          i++
        } else i++
        break
      case 'escape':
        if (code === LBR) {
          result.state = 'csi'
          i++
        } else if (code === RBR) {
          result.state = 'osc'
          i++
        } else if (code === P) {
          result.state = 'dcs'
          i++
        } else if (code === US) {
          result.state = 'apc'
          i++
        } else if (code === O) {
          result.state = 'ss3'
          i++
        } else if (csiInter(code)) {
          result.state = 'escapeIntermediate'
          i++
        } else if (escFinal(code)) {
          i++
          emit(data.slice(seqStart, i))
        } else if (code === E) {
          emit(data.slice(seqStart, i))
          seqStart = i
          result.state = 'escape'
          i++
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break
      case 'escapeIntermediate':
        if (csiInter(code)) i++
        else if (escFinal(code)) {
          i++
          emit(data.slice(seqStart, i))
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break
      case 'csi':
        if (
          x10Mouse &&
          code === M &&
          i - seqStart === 2 &&
          (i + 1 >= data.length || data.charCodeAt(i + 1) >= 0x20) &&
          (i + 2 >= data.length || data.charCodeAt(i + 2) >= 0x20) &&
          (i + 3 >= data.length || data.charCodeAt(i + 3) >= 0x20)
        ) {
          if (i + 4 <= data.length) {
            i += 4
            emit(data.slice(seqStart, i))
          } else i = data.length
          break
        }
        if (csiFinal(code)) {
          i++
          emit(data.slice(seqStart, i))
        } else if (csiParam(code) || csiInter(code)) i++
        else {
          result.state = 'ground'
          textStart = seqStart
        }
        break
      case 'ss3':
        if (code >= 0x40 && code <= 0x7e) {
          i++
          emit(data.slice(seqStart, i))
        } else {
          result.state = 'ground'
          textStart = seqStart
        }
        break
      case 'osc':
        if (code === BEL) {
          i++
          emit(data.slice(seqStart, i))
        } else if (
          code === E &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === BSL
        ) {
          i += 2
          emit(data.slice(seqStart, i))
        } else i++
        break
      case 'dcs':
      case 'apc':
        if (code === BEL) {
          i++
          emit(data.slice(seqStart, i))
        } else if (
          code === E &&
          i + 1 < data.length &&
          data.charCodeAt(i + 1) === BSL
        ) {
          i += 2
          emit(data.slice(seqStart, i))
        } else i++
        break
    }
  }
  if (result.state === 'ground') flushText()
  else if (flush) {
    const remaining = data.slice(seqStart)
    if (remaining) tokens.push({ type: 'sequence', value: remaining })
    result.state = 'ground'
  } else result.buffer = data.slice(seqStart)
  return { tokens, state: result }
}

function runWith(fn, chunks, x10Mouse) {
  let state = 'ground'
  let buffer = ''
  const tokens = []
  for (const chunk of chunks) {
    const r = fn(chunk, state, buffer, false, x10Mouse)
    state = r.state.state
    buffer = r.state.buffer
    tokens.push(...r.tokens)
  }
  const r = fn('', state, buffer, true, x10Mouse)
  tokens.push(...r.tokens)
  return tokens
}

test('differential fuzz: metaInput OFF is byte-identical to the original tokenizer', () => {
  let seed = 0x1234abcd
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  // Alphabet rich in escape-sequence bytes so we exercise every state.
  const alphabet = [
    '\x1b',
    '[',
    ']',
    'P',
    '_',
    'O',
    'M',
    '\\',
    '\x07',
    ';',
    '<',
    '?',
    '0',
    '1',
    '9',
    'A',
    'a',
    'Z',
    '~',
    ' ',
    '!',
    '(',
    '-',
    '/',
    'x',
    '\n',
    '\x00',
  ]
  for (let t = 0; t < 200000; t++) {
    const n = Math.floor(rnd() * 10)
    let s = ''
    for (let k = 0; k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)]
    // random chunk split
    const splits = []
    let pos = 0
    while (pos < s.length) {
      const take = 1 + Math.floor(rnd() * 3)
      splits.push(s.slice(pos, pos + take))
      pos += take
    }
    const chunks = splits.length ? splits : ['']
    const x10 = rnd() < 0.5
    const got = runWith(
      (inp, st, buf, fl, x) => tokenize(inp, st, buf, fl, x, false),
      chunks,
      x10,
    )
    const want = runWith(referenceTokenize, chunks, x10)
    assert.deepEqual(got, want, `divergence on ${JSON.stringify(s)}`)
  }
})
