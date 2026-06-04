# Sandbox network isolation: how it works per platform & how it's verified (F2-D)

Status: Decided
Last updated: 2026-06-04

This documents, honestly, **what the Sandbox Fortress network controls do, how the
OS enforces them on Linux vs macOS, and how each layer is tested** — keeping the
difference between "the decision is correct" and "the OS enforced it" explicit.

## The decision (platform-independent)

The session-global host policy is a pure, dependency-free function,
`resolveNetworkDecision` in
[`src/sandbox-fortress/networkDecision.mjs`](../../packages/deep-code/src/sandbox-fortress/networkDecision.mjs).
For a host it returns `'deny' | 'allow' | 'ask'`:

1. **deny-first** — matches any `deniedDomains` pattern → `deny` (a denylist entry
   beats an allowlist entry).
2. else matches any `allowedDomains` pattern → `allow`.
3. else if `allowManagedDomainsOnly` → `deny`.
4. else → `ask` (defer to the host's interactive permission callback).

`matchesDomainPattern`: `*.example.com` matches any **subdomain** but not the
base, everything else is an exact match, both case-insensitive. It is
**stricter than the runtime on garbage input** — an empty / nullish / non-string
pattern matches **nothing**, so a malformed pattern can never become a spurious
match (neither a spurious deny nor, worse, an allowlist bypass).

Where this runs, precisely (in
[`adapter/legacy.ts`](../../packages/deep-code/src/sandbox-fortress/adapter/legacy.ts)):

- The **runtime** applies the full ordering against the lists `convertToSandboxRuntimeConfig`
  initialized it with. Its `deniedDomains` is the union of
  `settings.sandbox.network.deniedDomains` (managed mode → policy source) **and**
  WebFetch `permissions.deny` `domain:` rules; `allowedDomains` is wired the same
  way.
- The wrapped network callback adds a **DeepCode-side DENY backstop** on the
  `ask` path: it calls `resolveNetworkDecision` with `allowManagedDomainsOnly`
  plus a **fresh** denylist read per request — but that fresh read
  (`resolveSandboxDeniedDomains()`) is the **settings denylist only**, NOT the
  permission-rule denies. So the callback is a deny/managed-only backstop (it
  short-circuits `→ deny` before the host's ask and survives the runtime's
  module-global config drifting); it does **not** re-decide `allow`, and it is
  narrower than the runtime's full denylist. Defaults are unchanged when the
  denylist is empty and managed-only is off (`→ ask`).

## OS enforcement (Linux and macOS — both kernel-confine TCP/IP to the proxy)

The host decision above is identical on both platforms. The OS-level **confinement**
of TCP/IP egress differs in *mechanism* but both are **kernel-enforced**: a
sandboxed process's outbound IP traffic can only reach the runtime's local
proxy(es), and a proxy makes the per-host decision.

| | Linux | macOS |
|---|---|---|
| OS sandbox | bubblewrap (`bwrap`) + `socat` | `sandbox-exec` (seatbelt) |
| Confine TCP/IP to proxy (kernel) | network namespace (`--unshare-net`): no route except the proxy socket | seatbelt `(deny default)` + `(allow network-outbound (remote ip "localhost:<proxyPort>"))` only |
| Per-host refusal | proxy refuses a denied host — HTTP(S)/`CONNECT` → `HTTP/1.1 403 Forbidden` (`http-proxy.js`); SOCKS-routed → SOCKS host-filter rejection (`socks-proxy.js`) — same host decision, different transport | identical proxies, identical refusals |

So a denied host is refused the **same way on both** (a `403` for HTTP(S)/CONNECT,
a SOCKS rejection for SOCKS traffic), and **both** kernel-confine TCP/IP to the
proxy — Linux via the network namespace, macOS via seatbelt. The difference is the
mechanism, not the strength; there is no "macOS is only defense-in-depth" gap.

Scope caveats (so this isn't over-read): this is **TCP/IP** egress confinement.
Unix-domain-socket and local-binding access are governed by SEPARATE settings
(`allowUnixSockets` / `allowAllUnixSockets` / `allowLocalBinding`, passed through
in `convertToSandboxRuntimeConfig`) — NOT by the host allow/deny policy — and with
**platform-specific** support: on Linux only `allowAllUnixSockets` relaxes the
Unix-socket block (path-specific `allowUnixSockets` is not supported there), while
`allowLocalBinding` is a macOS seatbelt knob (see the runtime's `sandbox-config` /
`generate-seccomp-filter` for the per-platform matrix). When enabled they widen
what the sandbox can reach beyond the proxy.

Genuine limits (not platform-parity, but worth stating):

- **Per-tool network deny is not enforceable.** One shared proxy per session, and
  the callback sees only host+port — no per-connection tool identity — so
  `ToolSandboxProfile.networkMode` is `@deprecated`/advisory (`types.ts`).
  Per-tool deny (F2-C) needs an upstream primitive that does not exist yet.
- **The committed runtime is a no-op shim.** `@anthropic-ai/sandbox-runtime` is a
  closed-source, self-use-only dependency
  (see [`sandbox-runtime-distribution.md`](../sandbox-runtime-distribution.md)); the
  vendored build's `isSupportedPlatform()` is `false`. Real enforcement requires
  installing the real runtime (the nightly job does).

## How each layer is VERIFIED

- **The decision logic — platform-independent, in CI:**
  [`test/sandbox-fortress/unit/network-decision.test.mjs`](../../packages/deep-code/test/sandbox-fortress/unit/network-decision.test.mjs)
  unit-tests `matchesDomainPattern` + `resolveNetworkDecision` (deny-first,
  wildcard subdomain matching + base exclusion, case-insensitivity, multi-entry
  lists, managed-only, the garbage-input no-spurious-match guard). The core makes
  no OS calls, so it is verifiable on any platform; **ordinary CI runs it on Linux
  (`ubuntu-latest`)** — there is no macOS CI leg, so the *decision* is proven on
  Linux + by construction platform-independent, not separately exercised on macOS.
- **OS enforcement — exercised on Linux, nightly:** the non-blocking nightly
  `sandbox-network` job in
  [`.github/workflows/live-e2e.yml`](../../.github/workflows/live-e2e.yml) installs
  `bubblewrap` + `socat` + the real runtime and runs
  [`scripts/sandbox-network-e2e.mjs`](../../packages/deep-code/scripts/sandbox-network-e2e.mjs):
  a denylisted host is refused with a `403` CONNECT while an allowlisted control
  connects. The probe **self-skips** (exit 0) unless `DEEPCODE_REAL_E2E=1` AND the
  real runtime + its deps are present — so it skips in ordinary CI and on any host
  running the vendored shim, regardless of OS (it is NOT a macОs-specific skip; the
  probe itself runs under `sandbox-exec` on macOS too). There is simply **no macOS
  CI leg** that installs the real runtime, so macOS seatbelt enforcement — though
  real — is not exercised by an automated E2E in this repo. A skip is never a false
  green.

## Summary

The per-host deny **decision** is one pure function, proven by unit tests
(executed on Linux CI, platform-independent by construction). OS **confinement** of
TCP/IP egress to the local proxy is kernel-enforced on both platforms — Linux
network namespace, macOS seatbelt — and the per-host refusal is identical (`403`
for HTTP(S)/CONNECT, a SOCKS rejection for SOCKS). The open items are per-tool deny
(no upstream primitive) and an automated macOS enforcement E2E.
