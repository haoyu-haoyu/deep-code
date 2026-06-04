#!/usr/bin/env node

// Live sandbox NETWORK-DENY E2E (F2-B). Spawns a REAL OS-sandbox-wrapped curl
// (sandbox-exec on macOS, bubblewrap on Linux, via @anthropic-ai/sandbox-runtime)
// and asserts a DENIED host is actually refused while an ALLOWED control host
// connects — i.e. that the deniedDomains denylist (#327) enforces at the OS/proxy
// level, not just in unit tests. It verifies the ENFORCEMENT mechanism; the
// DeepCode settings→config plumbing is unit-tested in
// test/sandbox-fortress/unit/network-decision.test.mjs.
//
// IMPORTANT — what actually runs this. @anthropic-ai/sandbox-runtime is a
// closed-source, self-use-only dependency (docs/sandbox-runtime-distribution.md):
// the committed tree ships a NO-OP shim (isSupportedPlatform()→false) so normal
// builds never bundle it, and it is NOT in the lockfile, so `npm ci` leaves it
// absent. Therefore this probe SELF-SKIPS locally and in ordinary CI. Only the
// dedicated nightly live-e2e `sandbox-network` job — which installs bubblewrap +
// socat AND the real runtime from npm — provides a platform where it truly
// enforces.
//
// TWO MODES:
//   • Default (skip-safe): skips cleanly (exit 0, notice, never a false-fail) on
//     ANY unmet precondition. This is what the offline p3-4 guard test relies on.
//   • STRICT (DEEPCODE_SANDBOX_E2E_STRICT=1, set ONLY by the dedicated CI job after
//     a preflight has already proven real-runtime + supported platform + deps):
//     there, a "can't run" is no longer harmless — it is a failure of the thing
//     under test, so setup/init/inside-reachability problems HARD-FAIL (exit 1)
//     instead of skipping. The job is then truly "exercise enforcement or go red".
//     The only still-legitimate STRICT skips are external-host outages (a test
//     host unreachable OUTSIDE the sandbox), which are not ours to assert.
//
// PASS requires POSITIVE deny evidence — the proxy refusing the CONNECT with HTTP
// 403 — never the mere absence of a connection, so a transient failure can never
// masquerade as a working deny. It EXITS 1 on a CONFIRMED breach (a denylisted
// host reachable outside is still reachable inside) and, in STRICT mode, on any
// post-preflight setup failure.

import { spawnSync } from 'node:child_process'

const REAL = process.env.DEEPCODE_REAL_E2E === '1'
const STRICT = process.env.DEEPCODE_SANDBOX_E2E_STRICT === '1'
const DENIED_HOST = 'example.com' // reachable, but DENIED → must be blocked inside
const ALLOWED_HOST = 'example.org' // reachable, ALLOWED → control (must connect inside)
// The runtime's proxy refuses a policy-blocked CONNECT with HTTP 403 — the
// positive, deny-attributable signal we require before declaring PASS.
const DENY_CONNECT_STATUS = '403'

// -w prints "<final-HTTP-status> <proxy-CONNECT-status>": the CONNECT status is
// the positive deny signal (a policy block → 403; a transient → 502/timeout).
const curlCmd = host =>
  `curl -sS --max-time 12 -o /dev/null -w "%{http_code} %{http_connect}" https://${host}/`

// Always-skip: an unmet EXTERNAL precondition that is never ours to assert (the
// gate is off, or a public test host is simply down). Exit 0 even in STRICT.
function skip(reason) {
  console.log(`sandbox-network E2E skipped: ${reason}`)
  process.exit(0)
}

// Pre-init prerequisite miss. In STRICT this contradicts the job's preflight and
// is a hard failure; otherwise it is a clean skip. Safe to exit immediately —
// nothing has been initialized yet, so there is no teardown to run.
function bail(reason) {
  if (STRICT) {
    console.error(`sandbox-network E2E FAILED (strict): ${reason}`)
    process.exit(1)
  }
  skip(reason)
}

// Post-init outcome that did not positively prove enforcement (sandbox blocked an
// allowed host, or the denied host failed without a deny-shaped 403). In STRICT
// that is a failure of the exercised path; otherwise inconclusive → skip. Returns
// (never exits) so the caller's `finally` teardown still runs.
function concludeUnproven(reason) {
  if (STRICT) {
    console.error(`sandbox-network E2E FAILED (strict): ${reason}`)
    process.exitCode = 1
  } else {
    console.log(`sandbox-network E2E skipped: ${reason}`)
  }
}

async function main() {
  if (!REAL) {
    // STRICT means the dedicated CI job has already committed (via its preflight)
    // to EXERCISING enforcement, so an unset DEEPCODE_REAL_E2E there is a job
    // MISCONFIGURATION, not an external precondition — fail loudly rather than
    // silently passing (skip → exit 0). Otherwise STRICT's "exercise-or-go-red"
    // guarantee would quietly depend on a second env var being set. bail() hard-
    // fails under STRICT and skips otherwise.
    if (STRICT) {
      return bail('DEEPCODE_REAL_E2E must be set in STRICT mode (the job committed to exercising enforcement)')
    }
    return skip(
      'set DEEPCODE_REAL_E2E=1 on a sandbox-capable host (the nightly live-e2e workflow installs bubblewrap + socat + the real runtime on Linux) to run real network-deny enforcement.',
    )
  }

  let SandboxManager
  try {
    ;({ SandboxManager } = await import('@anthropic-ai/sandbox-runtime'))
  } catch (error) {
    return bail(
      `@anthropic-ai/sandbox-runtime not loadable (the vendored build ships a no-op shim and the dep is not in the lockfile; the nightly job installs the real runtime): ${errMsg(error)}`,
    )
  }

  if (typeof SandboxManager?.isSupportedPlatform !== 'function' || !SandboxManager.isSupportedPlatform()) {
    return bail(
      'sandbox platform unsupported here (the vendored shim returns false, and a macOS dev box / non-bwrap Linux is unsupported) — only the nightly Linux+bwrap job with the real runtime enforces',
    )
  }
  const deps = SandboxManager.checkDependencies?.() ?? { errors: [] }
  if ((deps.errors ?? []).length > 0) {
    return bail(`sandbox dependencies missing: ${JSON.stringify(deps.errors)}`)
  }

  // BASELINES (no sandbox): both hosts must be reachable with NO sandbox so an
  // in-sandbox difference is attributable to the policy — not to a flaky host,
  // DNS, TLS, or transient outage. A host unreachable even here is an EXTERNAL
  // outage, not ours to assert → skip (even in STRICT). This is the guard against
  // a false PASS (denied side) and a false FAIL (allowed side).
  const baselineDenied = runCurl(curlCmd(DENIED_HOST))
  if (!baselineDenied.connected) {
    return skip(
      `denied host ${DENIED_HOST} is not reachable OUTSIDE the sandbox (${baselineDenied.detail}) — cannot attribute an in-sandbox block to the denylist`,
    )
  }
  const baselineAllowed = runCurl(curlCmd(ALLOWED_HOST))
  if (!baselineAllowed.connected) {
    return skip(
      `allowed control host ${ALLOWED_HOST} is not reachable OUTSIDE the sandbox (${baselineAllowed.detail}) — cannot tell a working allow from a dead host`,
    )
  }

  // Permissive filesystem so ONLY the network policy is under test. The DENIED
  // host is in BOTH the allow AND deny lists on purpose: that is what actually
  // exercises the denylist, because deny-first ordering must beat the allow
  // entry. (If the denied host were merely ABSENT from the allowlist, an
  // unmatched host is default-denied anyway — so the probe would still pass even
  // if deniedDomains did nothing, never proving the denylist works.) The ALLOWED
  // control host is allow-only and must stay reachable.
  const config = {
    filesystem: { allowRead: ['/'], denyRead: [], allowWrite: ['/'], denyWrite: [] },
    network: {
      allowedDomains: [ALLOWED_HOST, DENIED_HOST],
      deniedDomains: [DENIED_HOST],
    },
  }

  // From the moment we call initialize(), sandbox/proxy state may exist, so EVERY
  // exit from here runs the finally teardown rather than process.exit-ing past it.
  // initialize() and waitForNetworkInitialization() live INSIDE this try for that
  // reason: a partial-setup failure must still be cleaned up (cleanupAfterCommand /
  // reset), which process.exit() would bypass.
  try {
    await SandboxManager.initialize(config)
    await SandboxManager.waitForNetworkInitialization?.()

    const allowed = await curlThroughSandbox(SandboxManager, ALLOWED_HOST)
    if (!allowed.connected) {
      // Reachable OUTSIDE (baseline) but NOT inside → the sandbox blocked an
      // explicitly-allowed host (proxy down / blocking everything). In STRICT that
      // is a real failure of the exercised path; otherwise inconclusive.
      return concludeUnproven(
        `allowed control host ${ALLOWED_HOST} reachable OUTSIDE (${baselineAllowed.detail}) but NOT INSIDE the sandbox (${allowed.detail}) — the sandbox blocked an explicitly-allowed host`,
      )
    }

    // Require POSITIVE deny evidence (403 on CONNECT), not the mere absence of a
    // connection — otherwise an inside-only transient on the denied host could
    // masquerade as a working deny while the denylist is actually broken.
    const denied = await probeDeniedInside(SandboxManager)
    if (denied.kind === 'breach') {
      console.error(
        `sandbox-network E2E FAILED: denied host ${DENIED_HOST} (reachable outside the sandbox: ${baselineDenied.detail}) was STILL REACHABLE through the sandbox (${denied.detail}). The deniedDomains denylist did not enforce.`,
      )
      process.exitCode = 1
      return
    }
    if (denied.kind !== 'denied') {
      return concludeUnproven(
        `denied host ${DENIED_HOST} did not connect but produced no deny-shaped (HTTP ${DENY_CONNECT_STATUS} CONNECT) evidence (${denied.detail}) — could not confirm the denylist enforced`,
      )
    }

    console.log(
      `sandbox-network E2E PASS: ${DENIED_HOST} reachable OUTSIDE (${baselineDenied.detail}) but DENIED by the proxy inside the sandbox with HTTP ${DENY_CONNECT_STATUS} (${denied.detail}); allowed control ${ALLOWED_HOST} reachable inside (${allowed.detail}).`,
    )
  } catch (error) {
    // A failure after sandbox setup began (initialize / waitForNetworkInitialization,
    // or a probe throw). In STRICT this is a real failure of the thing under test;
    // otherwise it is inconclusive. Either way the finally below tears down.
    concludeUnproven(`sandbox setup/exercise error: ${errMsg(error)}`)
  } finally {
    try {
      SandboxManager.cleanupAfterCommand?.()
      await SandboxManager.reset?.()
    } catch {
      /* best-effort teardown */
    }
  }
}

// Run a curl and return a STRUCTURED outcome. `connected` is true iff curl exited
// 0 AND printed a final HTTP status (1xx–5xx). `httpConnect` is the proxy's
// response to the CONNECT request (`%{http_connect}`) — the key deny signal.
function runCurl(shellCommand) {
  const result = spawnSync('/bin/sh', ['-c', shellCommand], { encoding: 'utf8', timeout: 25_000 })
  const [httpCode = '', httpConnect = ''] = String(result.stdout ?? '').trim().split(/\s+/)
  const connected = result.status === 0 && /^[1-5]\d\d$/.test(httpCode)
  const detail = `exit=${result.status} http=${httpCode || 'none'} connect=${httpConnect || 'none'}${
    result.stderr ? ` err=${String(result.stderr).replace(/\s+/g, ' ').slice(0, 140)}` : ''
  }`
  return { connected, httpCode, httpConnect, status: result.status, detail }
}

// Wrap a curl in the OS sandbox and run it.
async function curlThroughSandbox(SandboxManager, host) {
  let wrapped
  try {
    wrapped = await SandboxManager.wrapWithSandbox(curlCmd(host), undefined, undefined, undefined)
  } catch (error) {
    return { connected: false, httpCode: '', httpConnect: '', status: null, detail: `wrap error: ${errMsg(error)}` }
  }
  return runCurl(wrapped)
}

// Classify the DENIED host's in-sandbox outcome with POSITIVE evidence, not the
// mere absence of a connection. The runtime's proxy refuses a policy-blocked
// CONNECT with `HTTP/1.1 403 Forbidden` (dist/sandbox/http-proxy.js), so a real
// deny surfaces as `%{http_connect} === '403'`. A generic transient (timeout, 502
// bad gateway, origin hiccup) is NOT a 403 and must NOT be read as a deny — that
// is the false-pass this guards against. Retry to ride out a transient and obtain
// a deny-shaped signal (or catch a breach). Returns:
//   'breach'       — the host actually CONNECTED (denylist failed) → must fail
//   'denied'       — proxy returned 403 on CONNECT (policy deny confirmed) → pass
//   'inconclusive' — neither; could not attribute the failure to the denylist
async function probeDeniedInside(SandboxManager) {
  let last
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await curlThroughSandbox(SandboxManager, DENIED_HOST)
    if (last.connected) return { kind: 'breach', detail: last.detail }
    if (last.httpConnect === DENY_CONNECT_STATUS) return { kind: 'denied', detail: last.detail }
    // Otherwise the failure is not deny-shaped (transient/502/timeout) — retry.
  }
  return { kind: 'inconclusive', detail: last.detail }
}

function errMsg(error) {
  return error instanceof Error ? error.message : String(error)
}

// An unexpected SETUP error skips clean by default, but HARD-FAILS in STRICT (the
// dedicated CI job, where a throw is a real failure). A confirmed enforcement
// breach sets process.exitCode=1 above (it does not throw).
main().catch(error => bail(`unexpected setup error: ${errMsg(error)}`))
