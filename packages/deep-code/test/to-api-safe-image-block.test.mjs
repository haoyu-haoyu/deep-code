import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toApiSafeImageBlock } from '../src/utils/toApiSafeImageBlock.mjs'

// Stub deps. detectImageFormat returns a SENTINEL so we can prove the media_type
// always comes from the FINAL bytes' magic — never the resizer's echoed format.
function makeDeps({ resizedBuffer, resizedDims, supported, transcodedBuffer }) {
  const calls = { maybeResize: 0, getImageProcessor: 0, png: 0, detect: [] }
  return {
    calls,
    deps: {
      maybeResize: async (buf, size, ext) => {
        calls.maybeResize++
        calls.maybeResizeArgs = { size, ext, bufLen: buf.length }
        return { buffer: resizedBuffer, dimensions: resizedDims }
      },
      isApiSupportedImageFormat: buf => {
        // supported is keyed by buffer identity to distinguish pre/post transcode
        return supported(buf)
      },
      detectImageFormat: buf => {
        calls.detect.push(buf)
        // Echo which buffer we were asked about so tests can assert the SOURCE.
        return buf === transcodedBuffer ? 'image/png' : 'image/jpeg'
      },
      getImageProcessor: async () => {
        calls.getImageProcessor++
        return input => {
          calls.sharpInput = input
          return {
            png: () => {
              calls.png++
              return { toBuffer: async () => transcodedBuffer }
            },
          }
        }
      },
    },
  }
}

test('API-supported resized bytes: no transcode, media_type from final bytes magic', async () => {
  const resizedBuffer = Buffer.from('jpeg-bytes')
  const { calls, deps } = makeDeps({
    resizedBuffer,
    resizedDims: { originalWidth: 10, originalHeight: 20 },
    supported: buf => buf === resizedBuffer, // resized bytes already supported
    transcodedBuffer: Buffer.from('png-bytes'),
  })
  const out = await toApiSafeImageBlock({
    buffer: Buffer.from('orig'),
    ext: 'jpg',
    ...deps,
  })
  assert.equal(calls.maybeResize, 1)
  assert.equal(calls.getImageProcessor, 0, 'no transcode for supported format')
  assert.equal(calls.png, 0)
  assert.equal(out.base64, resizedBuffer.toString('base64'))
  assert.equal(out.mediaType, 'image/jpeg', 'media_type derived from final bytes')
  assert.deepEqual(out.dimensions, { originalWidth: 10, originalHeight: 20 })
})

test('non-API resized bytes (e.g. tiff): transcode to PNG, media_type from transcoded bytes', async () => {
  const resizedBuffer = Buffer.from('tiff-bytes')
  const transcodedBuffer = Buffer.from('png-bytes')
  const { calls, deps } = makeDeps({
    resizedBuffer,
    resizedDims: { originalWidth: 4, originalHeight: 4 },
    // Resized tiff is NOT supported; the transcoded png IS.
    supported: buf => buf === transcodedBuffer,
    transcodedBuffer,
  })
  const out = await toApiSafeImageBlock({
    buffer: Buffer.from('orig-tiff'),
    ext: 'tiff',
    ...deps,
  })
  assert.equal(calls.maybeResize, 1)
  assert.equal(calls.getImageProcessor, 1, 'transcode invoked for non-API format')
  assert.equal(calls.png, 1)
  assert.equal(calls.sharpInput, resizedBuffer, 'transcodes the RESIZED buffer')
  assert.equal(out.base64, transcodedBuffer.toString('base64'))
  assert.equal(out.mediaType, 'image/png', 'media_type derived from transcoded bytes')
  assert.deepEqual(out.dimensions, { originalWidth: 4, originalHeight: 4 })
})

test('media_type is NEVER the resizer-echoed format — always re-derived from final bytes', async () => {
  // Even if resize echoes a bogus format, the output media_type comes from detectImageFormat.
  const resizedBuffer = Buffer.from('final')
  const { deps } = makeDeps({
    resizedBuffer,
    resizedDims: undefined,
    supported: () => true,
    transcodedBuffer: Buffer.from('unused'),
  })
  // detectImageFormat is asked about resizedBuffer -> returns 'image/jpeg' (sentinel)
  const out = await toApiSafeImageBlock({
    buffer: Buffer.from('orig'),
    ext: 'svg', // bogus/echoed ext must NOT leak into media_type
    ...deps,
  })
  assert.equal(out.mediaType, 'image/jpeg')
  assert.ok(!String(out.mediaType).includes('svg'))
  assert.equal(out.dimensions, undefined)
})

test('resizer throw propagates (caller degrades it via per-block try/catch)', async () => {
  await assert.rejects(
    () =>
      toApiSafeImageBlock({
        buffer: Buffer.alloc(0),
        ext: 'png',
        maybeResize: async () => {
          throw new Error('Image file is empty (0 bytes)')
        },
        isApiSupportedImageFormat: () => true,
        detectImageFormat: () => 'image/png',
        getImageProcessor: async () => {
          throw new Error('should not be called')
        },
      }),
    /Image file is empty/,
  )
})

test('passes the decoded buffer length and ext hint to the resizer', async () => {
  const resizedBuffer = Buffer.from('x')
  const { calls, deps } = makeDeps({
    resizedBuffer,
    resizedDims: undefined,
    supported: () => true,
    transcodedBuffer: Buffer.from('y'),
  })
  const input = Buffer.from('twelve-bytes')
  await toApiSafeImageBlock({ buffer: input, ext: 'webp', ...deps })
  assert.equal(calls.maybeResizeArgs.bufLen, input.length)
  assert.equal(calls.maybeResizeArgs.size, input.length)
  assert.equal(calls.maybeResizeArgs.ext, 'webp')
})
