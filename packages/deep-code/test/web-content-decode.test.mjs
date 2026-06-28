import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeHttpBody,
  isHtmlContentType,
  parseContentType,
} from '../src/tools/WebFetchTool/webContentDecode.mjs'

test('parseContentType: bare media type + charset, robust to params/case/quotes', () => {
  assert.deepEqual(parseContentType('text/html; charset=UTF-8'), {
    mediaType: 'text/html',
    charset: 'utf-8',
  })
  assert.deepEqual(parseContentType('Text/HTML ; Charset="Shift_JIS"'), {
    mediaType: 'text/html',
    charset: 'shift_jis',
  })
  assert.deepEqual(parseContentType('application/json'), {
    mediaType: 'application/json',
    charset: null,
  })
  assert.deepEqual(parseContentType(undefined), { mediaType: '', charset: null })
  assert.deepEqual(parseContentType(''), { mediaType: '', charset: null })
  // charset with no value -> null
  assert.equal(parseContentType('text/html; charset=').charset, null)
})

test('isHtmlContentType matches the bare media type, not a substring (fixes false-match)', () => {
  assert.equal(isHtmlContentType('text/html'), true)
  assert.equal(isHtmlContentType('text/html; charset=utf-8'), true)
  assert.equal(isHtmlContentType('application/xhtml+xml'), true)
  // The old contentType.includes('text/html') WRONGLY matched these:
  assert.equal(isHtmlContentType('application/json; x=text/html'), false)
  assert.equal(isHtmlContentType('text/html-summary'), false)
  assert.equal(isHtmlContentType('multipart/related; type=text/html'), false)
  assert.equal(isHtmlContentType('application/octet-stream; x=text/html'), false)
})

test('THE FIX: header charset is honored (Latin-1, Shift-JIS, GBK, EUC-KR, Big5)', () => {
  // Latin-1 'Café £5'
  const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35]) // Café £5 in latin1
  assert.equal(
    decodeHttpBody(latin1, 'text/html; charset=iso-8859-1'),
    'Café £5',
  )
  // Shift-JIS 日本 (93 fa 96 7b)
  const sjis = Buffer.from([0x93, 0xfa, 0x96, 0x7b])
  assert.equal(decodeHttpBody(sjis, 'text/plain; charset=shift_jis'), '日本')
  // GBK 中文 (d6 d0 ce c4)
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  assert.equal(decodeHttpBody(gbk, 'text/html; charset=gbk'), '中文')
})

test('THE FIX: UTF-16 BOM is honored (LE and BE), BOM wins over a wrong header', () => {
  // "Hi" in UTF-16LE with BOM: FF FE 48 00 69 00
  const u16le = Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
  assert.equal(decodeHttpBody(u16le, 'text/html'), 'Hi')
  // BOM is authoritative even if header lies (says utf-8)
  assert.equal(decodeHttpBody(u16le, 'text/html; charset=utf-8'), 'Hi')
  // UTF-16BE BOM: FE FF 00 48 00 69
  const u16be = Buffer.from([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69])
  assert.equal(decodeHttpBody(u16be, 'text/plain'), 'Hi')
})

test('THE FIX: <meta charset> sniffed for HTML when no header charset / BOM', () => {
  // Shift-JIS body with a <meta charset> declaration in ASCII head.
  const head = Buffer.from('<html><head><meta charset="shift_jis"></head><body>', 'latin1')
  const sjisBody = Buffer.from([0x93, 0xfa, 0x96, 0x7b]) // 日本
  const tail = Buffer.from('</body></html>', 'latin1')
  const doc = Buffer.concat([head, sjisBody, tail])
  const out = decodeHttpBody(doc, 'text/html') // no header charset
  assert.ok(out.includes('日本'), `expected 日本 in decoded output, got: ${out}`)
})

test('<meta> sniff reads the charset ATTRIBUTE, not charset= inside another attr value', () => {
  // An og:description whose VALUE contains "charset=utf-8" must NOT be mistaken for
  // the real <meta charset="shift_jis"> that follows.
  const doc = Buffer.concat([
    Buffer.from(
      '<meta property="og:description" content="charset=utf-8 explained">',
      'latin1',
    ),
    Buffer.from('<meta charset="shift_jis">', 'latin1'),
    Buffer.from([0x93, 0xfa, 0x96, 0x7b]), // 日本
  ])
  assert.ok(decodeHttpBody(doc, 'text/html').includes('日本'))
})

test('<meta http-equiv="content-type" content="...charset="> form is honored', () => {
  const doc = Buffer.concat([
    Buffer.from(
      '<meta http-equiv="Content-Type" content="text/html; charset=gbk">',
      'latin1',
    ),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), // 中文
  ])
  assert.ok(decodeHttpBody(doc, 'text/html').includes('中文'))
})

test('a content attribute with charset= but NO http-equiv is ignored', () => {
  // content="...charset=utf-16" without http-equiv must not force utf-16.
  const doc = Buffer.concat([
    Buffer.from('<meta name="x" content="charset=utf-16">', 'latin1'),
    Buffer.from('Hello world', 'utf-8'),
  ])
  assert.equal(decodeHttpBody(doc, 'text/html'), '<meta name="x" content="charset=utf-16">Hello world')
})

test('header charset takes precedence over <meta> (HTTP header is authoritative)', () => {
  // body is real Shift-JIS but a bogus <meta charset=utf-8> — header says shift_jis -> wins
  const doc = Buffer.concat([
    Buffer.from('<meta charset="utf-8">', 'latin1'),
    Buffer.from([0x93, 0xfa, 0x96, 0x7b]),
  ])
  assert.ok(decodeHttpBody(doc, 'text/html; charset=shift_jis').includes('日本'))
})

test('<meta> sniff does NOT apply to non-HTML content types', () => {
  // A JSON body that happens to contain a <meta charset> string must NOT be
  // re-decoded as that charset; it defaults to utf-8.
  const json = Buffer.from('{"x":"<meta charset=shift_jis>","y":"café"}', 'utf-8')
  assert.equal(
    decodeHttpBody(json, 'application/json'),
    '{"x":"<meta charset=shift_jis>","y":"café"}',
  )
})

test('default UTF-8 when nothing declared; valid UTF-8 unaffected', () => {
  const utf8 = Buffer.from('héllo 日本 🎉', 'utf-8')
  assert.equal(decodeHttpBody(utf8, 'text/html'), 'héllo 日本 🎉')
  assert.equal(decodeHttpBody(utf8, undefined), 'héllo 日本 🎉')
})

test('unknown/garbage charset label falls back to UTF-8 (never throws)', () => {
  const utf8 = Buffer.from('plain text', 'utf-8')
  assert.equal(decodeHttpBody(utf8, 'text/html; charset=not-a-real-charset'), 'plain text')
  assert.doesNotThrow(() => decodeHttpBody(Buffer.from([0xff, 0xfe, 0x00]), 'x/y; charset=??'))
})
