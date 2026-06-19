import type { AddressFamily, LookupAddress as AxiosLookupAddress } from 'axios'
import { lookup as dnsLookup } from 'dns'
import { isIP } from 'net'

import { isBlockedAddress } from './ssrfBlockedAddress.mjs'

/**
 * SSRF guard for outbound HTTP (project HTTP hooks and the WebFetch tool).
 *
 * Blocks private, link-local, and other non-routable address ranges to prevent
 * reaching cloud metadata endpoints (169.254.169.254) or internal infrastructure.
 * The pure address classification lives in ssrfBlockedAddress.mjs; this module
 * wires it into a dns.lookup-compatible guard (the axios `lookup` option) so the
 * VALIDATED ip is the one the socket connects to — no rebinding window.
 *
 * Loopback (127.0.0.0/8, ::1) is ALLOWED for HTTP hooks (local dev policy servers
 * are a primary use case) and BLOCKED for WebFetch (its URL is model-controlled),
 * via the blockLoopback option threaded through.
 *
 * When a global proxy or the sandbox network proxy is in use, the guard is
 * effectively bypassed for the target host because the proxy performs DNS
 * resolution. The sandbox proxy enforces its own domain allowlist.
 */

export { isBlockedAddress } from './ssrfBlockedAddress.mjs'

/**
 * A dns.lookup-compatible function (the axios `lookup` config option). Signature
 * matches axios's `lookup` (not Node's dns.lookup).
 */
type AxiosLookup = (
  hostname: string,
  options: object,
  callback: (
    err: Error | null,
    address: AxiosLookupAddress | AxiosLookupAddress[],
    family?: AddressFamily,
  ) => void,
) => void

/**
 * Build a guarded `lookup` that rejects addresses in blocked ranges, so the
 * validated ip is the one the socket connects to — no rebinding window between
 * validation and connection. IP literals are validated directly without DNS.
 *
 * @param guardOptions.blockLoopback also reject loopback (WebFetch); omit/false
 *   to allow it (HTTP hooks). See isBlockedAddress.
 */
export function makeSsrfGuardedLookup(
  guardOptions: { blockLoopback?: boolean } = {},
): AxiosLookup {
  return function guardedLookup(hostname, options, callback): void {
    const wantsAll = 'all' in options && options.all === true

    // If hostname is already an IP literal, validate it directly. dns.lookup
    // would short-circuit too, but checking here gives a clearer error and
    // avoids any platform-specific lookup behavior for literals.
    const ipVersion = isIP(hostname)
    if (ipVersion !== 0) {
      if (isBlockedAddress(hostname, guardOptions)) {
        callback(ssrfError(hostname, hostname), '')
        return
      }
      const family = ipVersion === 6 ? 6 : 4
      if (wantsAll) {
        callback(null, [{ address: hostname, family }])
      } else {
        callback(null, hostname, family)
      }
      return
    }

    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        callback(err, '')
        return
      }

      for (const { address } of addresses) {
        if (isBlockedAddress(address, guardOptions)) {
          callback(ssrfError(hostname, address), '')
          return
        }
      }

      const first = addresses[0]
      if (!first) {
        callback(
          Object.assign(new Error(`ENOTFOUND ${hostname}`), {
            code: 'ENOTFOUND',
            hostname,
          }),
          '',
        )
        return
      }

      const family = first.family === 6 ? 6 : 4
      if (wantsAll) {
        callback(
          null,
          addresses.map(a => ({
            address: a.address,
            family: a.family === 6 ? 6 : 4,
          })),
        )
      } else {
        callback(null, first.address, family)
      }
    })
  }
}

// The default-options guarded lookup (loopback ALLOWED) — the HTTP-hook lookup.
export const ssrfGuardedLookup: AxiosLookup = makeSsrfGuardedLookup()

function ssrfError(hostname: string, address: string): NodeJS.ErrnoException {
  const err = new Error(
    `Request blocked: ${hostname} resolves to ${address} (private/link-local address).`,
  )
  return Object.assign(err, {
    code: 'ERR_HTTP_HOOK_BLOCKED_ADDRESS',
    hostname,
    address,
  })
}
