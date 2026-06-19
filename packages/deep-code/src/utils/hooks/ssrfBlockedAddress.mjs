// Pure IP-range classification for the SSRF guard, split out so it can be unit
// tested without the dns/axios plumbing in ssrfGuard.ts. Operates on validated
// IP literals (the caller passes results from dns.lookup or an isIP-checked host).

import { isIP } from 'net'

/**
 * Returns true if the address is in a range an outbound request should not reach.
 *
 * Blocked IPv4: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10 (CGNAT — some cloud metadata),
 *   169.254.0.0/16 (link-local, cloud metadata), 172.16.0.0/12, 192.168.0.0/16.
 * Blocked IPv6: :: (unspecified), fc00::/7 (ULA), fe80::/10 (link-local),
 *   ::ffff:<v4> mapped into a blocked range.
 * Loopback (127.0.0.0/8, ::1) is allowed UNLESS options.blockLoopback — HTTP
 *   hooks allow it (local dev policy servers); WebFetch, whose URL is
 *   model-controlled, blocks it too.
 *
 * @param {string} address
 * @param {{ blockLoopback?: boolean }} [options]
 * @returns {boolean}
 */
export function isBlockedAddress(address, options = {}) {
  const v = isIP(address)
  if (v === 4) return isBlockedV4(address, options)
  if (v === 6) return isBlockedV6(address, options)
  // Not a valid IP literal — let the real DNS path handle it.
  return false
}

function isBlockedV4(address, options = {}) {
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  if (
    parts.length !== 4 ||
    a === undefined ||
    b === undefined ||
    parts.some(n => Number.isNaN(n))
  ) {
    return false
  }

  // Loopback: allowed for hooks, blocked for WebFetch (blockLoopback).
  if (a === 127) return options.blockLoopback === true

  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 168) return true // 192.168.0.0/16

  return false
}

function isBlockedV6(address, options = {}) {
  const lower = address.toLowerCase()

  // ::1 loopback: allowed for hooks, blocked for WebFetch (blockLoopback).
  if (lower === '::1') return options.blockLoopback === true

  if (lower === '::') return true // unspecified

  // IPv4-mapped IPv6 (::ffff:a.b.c.d, ::ffff:XXXX:YYYY, expanded, …). Extract the
  // embedded IPv4 and delegate, so hex-form mapped addresses (e.g.
  // ::ffff:a9fe:a9fe = 169.254.169.254) cannot bypass the guard.
  const mappedV4 = extractMappedIPv4(lower)
  if (mappedV4 !== null) return isBlockedV4(mappedV4, options)

  // fc00::/7 unique-local (fc.. / fd..)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true

  // fe80::/10 link-local (fe80..febf)
  const firstHextet = lower.split(':')[0]
  if (
    firstHextet &&
    firstHextet.length === 4 &&
    firstHextet >= 'fe80' &&
    firstHextet <= 'febf'
  ) {
    return true
  }

  return false
}

/**
 * Expand `::` and optional trailing dotted-decimal so an IPv6 address is exactly
 * 8 hex groups. Returns null if expansion is not well-formed.
 * @param {string} addr @returns {number[] | null}
 */
function expandIPv6Groups(addr) {
  let tailHextets = []
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    const v4 = addr.slice(lastColon + 1)
    addr = addr.slice(0, lastColon)
    const octets = v4.split('.').map(Number)
    if (
      octets.length !== 4 ||
      octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null
    }
    tailHextets = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]]
  }

  const dbl = addr.indexOf('::')
  let head
  let tail
  if (dbl === -1) {
    head = addr.split(':')
    tail = []
  } else {
    const headStr = addr.slice(0, dbl)
    const tailStr = addr.slice(dbl + 2)
    head = headStr === '' ? [] : headStr.split(':')
    tail = tailStr === '' ? [] : tailStr.split(':')
  }

  const target = 8 - tailHextets.length
  const fill = target - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array(fill).fill('0'), ...tail]
  const nums = hex.map(h => parseInt(h, 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  nums.push(...tailHextets)
  return nums.length === 8 ? nums : null
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 (0:0:0:0:0:ffff:X:Y), in any
 * representation. Returns null if not an IPv4-mapped address.
 * @param {string} addr @returns {string | null}
 */
function extractMappedIPv4(addr) {
  const g = expandIPv6Groups(addr)
  if (!g) return null
  if (
    g[0] === 0 &&
    g[1] === 0 &&
    g[2] === 0 &&
    g[3] === 0 &&
    g[4] === 0 &&
    g[5] === 0xffff
  ) {
    const hi = g[6]
    const lo = g[7]
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return null
}
