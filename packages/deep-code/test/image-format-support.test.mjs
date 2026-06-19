import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isApiSupportedImageFormat } from '../src/utils/imageFormatSupport.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
])

test('the four API-supported formats are recognized by magic bytes', () => {
  assert.equal(isApiSupportedImageFormat(png), true)
  assert.equal(isApiSupportedImageFormat(jpeg), true)
  assert.equal(isApiSupportedImageFormat(gif), true)
  assert.equal(isApiSupportedImageFormat(webp), true)
})

test('unsupported formats (BMP/TIFF/HEIC/AVIF/SVG) are NOT recognized → caller transcodes', () => {
  const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00])
  const tiffLE = Buffer.from([0x49, 0x49, 0x2a, 0x00])
  const tiffBE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a])
  const heic = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypheic'),
  ])
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')
  const xmlSvg = Buffer.from('<?xml version="1.0"?><svg>')
  for (const buf of [bmp, tiffLE, tiffBE, heic, svg, xmlSvg]) {
    assert.equal(isApiSupportedImageFormat(buf), false)
  }
})

test('a WEBP RIFF container is only accepted with the WEBP fourcc (not a WAV RIFF)', () => {
  const wav = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE'),
  ])
  assert.equal(isApiSupportedImageFormat(wav), false)
})

test('empty / too-short / nullish buffers are not supported (fail safe → transcode attempt)', () => {
  assert.equal(isApiSupportedImageFormat(Buffer.alloc(0)), false)
  assert.equal(isApiSupportedImageFormat(Buffer.from([0x89, 0x50])), false)
  assert.equal(isApiSupportedImageFormat(null), false)
  assert.equal(isApiSupportedImageFormat(undefined), false)
})
