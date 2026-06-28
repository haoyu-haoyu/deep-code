// Pure IP-range classification for the SSRF guard, split out so it can be unit
// tested without the dns/axios plumbing in ssrfGuard.ts. Operates on validated
// IP literals (the caller passes results from dns.lookup or an isIP-checked host).

import { isIP } from 'net'

/**
 * Returns true if the address is in a range an outbound request should not reach.
 *
 * Blocked IPv4: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10 (CGNAT — some cloud metadata),
 *   169.254.0.0/16 (link-local, cloud metadata), 172.16.0.0/12, 192.168.0.0/16.
 * Blocked IPv6: :: (unspecified), fc00::/7 (ULA), fe80::/10 (link-local), and any
 *   form that EMBEDS a blocked IPv4 — IPv4-mapped (::ffff:v4), IPv4-compatible
 *   (::v4), NAT64 (64:ff9b::/96), and 6to4 (2002:v4::/16).
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

  // Any IPv6 form that EMBEDS an IPv4 — mapped (::ffff:v4), compatible (::v4),
  // NAT64 (64:ff9b::v4), 6to4 (2002:v4::) — extract the embedded IPv4 and delegate,
  // so e.g. ::ffff:a9fe:a9fe / ::169.254.169.254 / 64:ff9b::a9fe:a9fe /
  // 2002:a9fe:a9fe:: (all 169.254.169.254) cannot bypass the guard. Only an embedded
  // BLOCKED v4 is blocked — a public 6to4/NAT64 target stays reachable.
  const embeddedV4 = extractEmbeddedIPv4(lower)
  if (embeddedV4 !== null) return isBlockedV4(embeddedV4, options)

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
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    if (lastColon === -1) return null
    const octets = addr
      .slice(lastColon + 1)
      .split('.')
      .map(Number)
    if (
      octets.length !== 4 ||
      octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null
    }
    // Rewrite a trailing dotted-decimal v4 as its two hex hextets in place, keeping
    // the preceding colon. This works whether the v4 followed "::" (e.g.
    // ::169.254.169.254 -> ::a9fe:a9fe) or a normal ":" (::ffff:169.254.169.254 ->
    // ::ffff:a9fe:a9fe), so the all-hex expansion below handles every form uniformly.
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`
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

  const fill = 8 - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array(fill).fill('0'), ...tail]
  const nums = hex.map(h => parseInt(h, 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  return nums.length === 8 ? nums : null
}

/**
 * Extract the embedded IPv4 (dotted-decimal) from any IPv6 form that carries one,
 * in any representation. Covers:
 *   - IPv4-mapped     ::ffff:a.b.c.d   (g0..4=0, g5=ffff; v4 in g6,g7)
 *   - IPv4-compatible ::a.b.c.d        (g0..5=0;          v4 in g6,g7)  [::/96]
 *   - NAT64           64:ff9b::a.b.c.d (g0=0064,g1=ff9b,g2..5=0; v4 in g6,g7)
 *   - 6to4            2002:a.b.c.d::    (g0=2002;          v4 in g1,g2)
 * Returns null if the address embeds no IPv4. `::` and `::1` are handled by the
 * caller before this runs. Only the EMBEDDED v4 is returned — the caller decides
 * whether that v4 is in a blocked range, so public 6to4/NAT64 targets stay allowed.
 * @param {string} addr @returns {string | null}
 */
function extractEmbeddedIPv4(addr) {
  const g = expandIPv6Groups(addr)
  if (!g) return null
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  const top96Zero = g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0
  // IPv4-mapped: ::ffff:v4
  if (g[0] === 0 && top96Zero && g[5] === 0xffff) return v4(g[6], g[7])
  // IPv4-compatible: ::v4  (the whole ::/96 block; :: and ::1 already handled)
  if (g[0] === 0 && top96Zero && g[5] === 0) return v4(g[6], g[7])
  // NAT64 well-known prefix: 64:ff9b::/96
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return v4(g[6], g[7])
  }
  // 6to4: 2002:v4::/16 (embedded v4 is the next 32 bits, g1,g2)
  if (g[0] === 0x2002) return v4(g[1], g[2])
  return null
}
