// Produce an Anthropic-API-safe image payload (base64 bytes + a media_type that is
// one of image/png|jpeg|gif|webp) from UNTRUSTED image bytes — e.g. an MCP server's
// `image` content block or a resource `blob` whose mimeType claims to be an image.
//
// Why this exists: sharp/libvips decodes MANY formats the Anthropic API cannot accept
// (tiff, avif, svg, heif, jp2, bmp, ...). The resizer (maybeResizeAndDownsampleImageBuffer)
// echoes the DETECTED input format on its success path (`metadata.format`), so a small,
// in-bounds TIFF/SVG/AVIF returns mediaType='tiff'/'svg'/'avif'. The MCP transform then
// emitted `image/${that}` and sent it to the API, which 400s the ENTIRE request — taking
// down every VALID sibling block in the same tool_result and breaking the turn. Crucially
// this block did NOT throw, so the per-block "degrade one bad block to a placeholder" net
// never fired for it.
//
// This mirrors (and slightly hardens) the paste path's existing protection
// (imagePaste.ts: transcode non-API formats to PNG, then derive media_type from the FINAL
// bytes' magic rather than the resizer's echoed input format):
//   1. resize FIRST — maybeResize header-gates pixel bombs (metadata-only) before any full
//      decode, and rejects oversized images by throwing (which the caller's per-block
//      try/catch degrades to a text placeholder);
//   2. if the resized bytes are STILL not an API-decodable format, transcode them to PNG
//      (sharp/libvips can encode PNG from any format it decoded);
//   3. derive the media_type from the FINAL bytes' MAGIC BYTES (detectImageFormat), never
//      from the resizer's echoed `mediaType` string — so the label always matches the bytes
//      and is always one of the 4 API-accepted types.
//
// All impure dependencies are injected so this is pure value-in/value-out and node-testable
// (client.ts is bun/sharp-tainted).
//
// @template R
// @param {object} args
// @param {Buffer} args.buffer                                    decoded image bytes (untrusted)
// @param {string} args.ext                                       format hint for the resizer
// @param {(buf: Buffer, size: number, ext: string) => Promise<{ buffer: Buffer, dimensions?: R }>} args.maybeResize
// @param {(buf: Buffer) => boolean} args.isApiSupportedImageFormat  magic-byte sniff: png/jpeg/gif/webp?
// @param {(buf: Buffer) => string} args.detectImageFormat          magic-byte -> 'image/png'|'image/jpeg'|'image/gif'|'image/webp'
// @param {() => Promise<(input: Buffer) => { png: () => { toBuffer: () => Promise<Buffer> } }>} args.getImageProcessor
// @returns {Promise<{ base64: string, mediaType: string, dimensions?: R }>}
export async function toApiSafeImageBlock({
  buffer,
  ext,
  maybeResize,
  isApiSupportedImageFormat,
  detectImageFormat,
  getImageProcessor,
}) {
  const resized = await maybeResize(buffer, buffer.length, ext)
  let finalBuffer = resized.buffer

  if (!isApiSupportedImageFormat(finalBuffer)) {
    const sharp = await getImageProcessor()
    finalBuffer = await sharp(finalBuffer).png().toBuffer()
  }

  return {
    base64: finalBuffer.toString('base64'),
    mediaType: detectImageFormat(finalBuffer),
    dimensions: resized.dimensions,
  }
}
