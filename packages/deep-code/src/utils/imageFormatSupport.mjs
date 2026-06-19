// Whether a buffer's MAGIC BYTES are one of the image formats the API can decode
// (png, jpeg, gif, webp). Used to decide whether a pasted/attached image must be
// transcoded to PNG: a file whose filename extension mislabels its true content
// (e.g. photo.png that is really HEIC/TIFF/SVG/AVIF/BMP) would otherwise be sent
// with a wrong/defaulted media_type over un-decodable bytes — an API 400.
//
// Pure & node-testable. Content sniffing, not extension-based.

/**
 * @param {Uint8Array | Buffer | null | undefined} buf
 * @returns {boolean} true iff the bytes start with a PNG/JPEG/GIF/WebP signature
 */
export function isApiSupportedImageFormat(buf) {
  if (!buf || buf.length < 4) return false

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return true
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // GIF: "GIF8" (47 49 46 38)
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return true
  }
  // WebP: "RIFF" .... "WEBP" (52 49 46 46 ?? ?? ?? ?? 57 45 42 50)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true
  }

  return false
}
