// Correctly parse an HTTP Content-Type header and decode a fetched web body using
// its DECLARED character encoding.
//
// WebFetch previously did rawBuffer.toString('utf-8') unconditionally, discarding
// the Content-Type charset / <meta charset> / BOM — so any UTF-16 / Latin-1 /
// Shift-JIS / GBK / Big5 / EUC-KR page reached the model as mojibake (every high
// byte became U+FFFD). It also dispatched HTML vs non-HTML by a raw substring scan
// (contentType.includes('text/html')), which false-matches a parameter value like
// `application/json; x=text/html`. These helpers fix both by parsing the header.
//
// Pure value-in/value-out (TextDecoder is a deterministic global) so node-testable.

/**
 * Parse a Content-Type header into its bare media type and charset.
 * Mirrors mcpOutputStorage.ts's extensionForMimeType/isBinaryContentType parsing
 * (split on ';', take the type, lowercase) so media-type checks are consistent.
 *
 * @param {string | undefined | null} header
 * @returns {{ mediaType: string, charset: string | null }}
 */
export function parseContentType(header) {
  if (!header || typeof header !== 'string') {
    return { mediaType: '', charset: null }
  }
  const parts = header.split(';')
  const mediaType = (parts[0] ?? '').trim().toLowerCase()
  let charset = null
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i]
    const eq = param.indexOf('=')
    if (eq === -1) continue
    const name = param.slice(0, eq).trim().toLowerCase()
    if (name === 'charset') {
      // Strip surrounding quotes and lowercase; TextDecoder labels are case-insensitive.
      charset = param
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase()
      if (charset === '') charset = null
      break
    }
  }
  return { mediaType, charset }
}

// HTML media types whose body is run through turndown.
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml'])

/**
 * @param {string | undefined | null} contentType
 * @returns {boolean} true iff the bare media type is HTML (turndown should run)
 */
export function isHtmlContentType(contentType) {
  return HTML_MEDIA_TYPES.has(parseContentType(contentType).mediaType)
}

// Return a TextDecoder label if `label` is one TextDecoder accepts, else null.
function validDecoderLabel(label) {
  if (!label) return null
  try {
    // Constructing throws RangeError for an unknown label.
    return new TextDecoder(label).encoding
  } catch {
    return null
  }
}

// Detect an authoritative byte-order mark. Returns a TextDecoder label or null.
function bomCharset(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return 'utf-8'
  }
  return null
}

// Sniff a <meta charset> / <meta http-equiv="content-type" content="...charset=">
// declaration in the first 1024 bytes of an HTML document (the WHATWG "prescan"
// window). The prescan reads bytes as ASCII, so decode that slice as latin1 (1:1
// byte->char) to scan. Attributes are tokenized so `charset=` appearing INSIDE an
// unrelated quoted attribute value (e.g. <meta property="og:x" content="...charset=
// ...">) is NOT mistaken for the charset attribute.
function metaCharset(buf) {
  const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 1024))
    .toString('latin1')
    .toLowerCase()
  const metaTag = /<meta\b([^>]*)>/g
  const attrRe = /([a-z0-9:_.\-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g
  let m
  while ((m = metaTag.exec(head)) !== null) {
    const attrs = {}
    let a
    attrRe.lastIndex = 0
    while ((a = attrRe.exec(m[1])) !== null) {
      attrs[a[1]] = a[2].replace(/^["']|["']$/g, '')
    }
    // Form 1: <meta charset="x"> — read the charset ATTRIBUTE by name.
    if (typeof attrs.charset === 'string' && attrs.charset.trim() !== '') {
      return attrs.charset.trim()
    }
    // Form 2: <meta http-equiv="content-type" content="...; charset=x">
    if (
      attrs['http-equiv'] === 'content-type' &&
      typeof attrs.content === 'string'
    ) {
      const cs = /charset\s*=\s*([a-z0-9_:.\-]+)/.exec(attrs.content)
      if (cs) return cs[1]
    }
  }
  return null
}

/**
 * Decode a fetched body buffer to a string using its declared encoding, with
 * precedence BOM > HTTP charset > <meta charset> (HTML only) > UTF-8.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {string | undefined | null} contentType
 * @returns {string}
 */
export function decodeHttpBody(buffer, contentType) {
  const { mediaType, charset } = parseContentType(contentType)

  let label =
    validDecoderLabel(bomCharset(buffer)) ||
    validDecoderLabel(charset) ||
    (HTML_MEDIA_TYPES.has(mediaType) ? validDecoderLabel(metaCharset(buffer)) : null) ||
    'utf-8'

  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    // Defensive: any decode failure falls back to UTF-8 (lossy but never throws).
    return new TextDecoder('utf-8').decode(buffer)
  }
}
