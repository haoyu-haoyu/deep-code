import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isPlatformInEnabledList,
  sandboxUnavailableReason,
} from '../../../src/sandbox-fortress/sandboxAvailability.mjs'

// ── platform/availability gating (extracted from adapter/legacy.ts) ─────────
// Previously ZERO coverage. This is security-adjacent: the result decides
// whether the sandbox actually runs, and surfaces the #34044 footgun (an
// explicitly-enabled sandbox that silently can't run).

// --- isPlatformInEnabledList ------------------------------------------------

test('isPlatformInEnabledList: undefined list => all platforms allowed (default)', () => {
  assert.equal(isPlatformInEnabledList('macos', undefined), true)
  assert.equal(isPlatformInEnabledList('linux', undefined), true)
})

test('isPlatformInEnabledList: empty list => NO platform allowed (explicit kill-switch)', () => {
  assert.equal(isPlatformInEnabledList('macos', []), false)
  assert.equal(isPlatformInEnabledList('linux', []), false)
})

test('isPlatformInEnabledList: non-empty list => membership', () => {
  assert.equal(isPlatformInEnabledList('macos', ['macos']), true)
  assert.equal(isPlatformInEnabledList('linux', ['macos']), false)
  assert.equal(isPlatformInEnabledList('wsl', ['linux', 'wsl']), true)
  assert.equal(isPlatformInEnabledList('windows', ['linux', 'wsl']), false)
})

// --- sandboxUnavailableReason -----------------------------------------------

const never = () => {
  throw new Error('getDepErrors must not be called on this path')
}
function spyDeps(errors) {
  let calls = 0
  const fn = () => {
    calls++
    return errors
  }
  fn.calls = () => calls
  return fn
}

test('sandboxUnavailableReason: no warning when the user did not enable sandbox (deps not even checked)', () => {
  assert.equal(
    sandboxUnavailableReason({ enabledSetting: false, supported: false, platform: 'windows', inList: false, getDepErrors: never }),
    undefined,
  )
})

test('sandboxUnavailableReason: enabled + unsupported => platform message (WSL1 special-cased)', () => {
  assert.match(
    sandboxUnavailableReason({ enabledSetting: true, supported: false, platform: 'wsl', inList: true, getDepErrors: never }),
    /WSL1 is not supported \(requires WSL2\)/,
  )
  assert.match(
    sandboxUnavailableReason({ enabledSetting: true, supported: false, platform: 'windows', inList: true, getDepErrors: never }),
    /windows is not supported \(requires macOS, Linux, or WSL2\)/,
  )
})

test('sandboxUnavailableReason: enabled + supported + not-in-enabledPlatforms => list message', () => {
  assert.match(
    sandboxUnavailableReason({ enabledSetting: true, supported: true, platform: 'linux', inList: false, getDepErrors: never }),
    /linux is not in sandbox\.enabledPlatforms/,
  )
})

test('sandboxUnavailableReason: enabled + supported + in-list + missing deps => deps message with platform hint', () => {
  const macos = sandboxUnavailableReason({
    enabledSetting: true, supported: true, platform: 'macos', inList: true,
    getDepErrors: () => ['sandbox-exec missing'],
  })
  assert.match(macos, /dependencies are missing: sandbox-exec missing/)
  assert.match(macos, /run \/sandbox or \/doctor for details/)

  const linux = sandboxUnavailableReason({
    enabledSetting: true, supported: true, platform: 'linux', inList: true,
    getDepErrors: () => ['bwrap not found', 'socat not found'],
  })
  assert.match(linux, /bwrap not found, socat not found/)
  assert.match(linux, /apt install bubblewrap socat/)
})

test('sandboxUnavailableReason: enabled + supported + in-list + no missing deps => undefined (available)', () => {
  assert.equal(
    sandboxUnavailableReason({ enabledSetting: true, supported: true, platform: 'macos', inList: true, getDepErrors: () => [] }),
    undefined,
  )
})

test('sandboxUnavailableReason: getDepErrors is LAZY — only called once the cheaper gates pass', () => {
  // short-circuited before deps on every earlier gate
  for (const args of [
    { enabledSetting: false, supported: true, platform: 'macos', inList: true },
    { enabledSetting: true, supported: false, platform: 'macos', inList: true },
    { enabledSetting: true, supported: true, platform: 'macos', inList: false },
  ]) {
    const deps = spyDeps([])
    sandboxUnavailableReason({ ...args, getDepErrors: deps })
    assert.equal(deps.calls(), 0, `deps must not be checked for ${JSON.stringify(args)}`)
  }
  // reaches the deps gate -> called exactly once
  const deps = spyDeps(['x'])
  sandboxUnavailableReason({ enabledSetting: true, supported: true, platform: 'macos', inList: true, getDepErrors: deps })
  assert.equal(deps.calls(), 1)
})

test('#34044 footgun: an ENABLED sandbox that cannot run ALWAYS yields a reason (never a silent disable)', () => {
  // For every single failing precondition under enabledSetting:true, the reason
  // must be defined — i.e. the user always learns WHY their security setting is
  // being ignored.
  const failing = [
    { supported: false, platform: 'windows', inList: true, getDepErrors: () => [] },
    { supported: true, platform: 'macos', inList: false, getDepErrors: () => [] },
    { supported: true, platform: 'macos', inList: true, getDepErrors: () => ['dep'] },
  ]
  for (const f of failing) {
    assert.notEqual(sandboxUnavailableReason({ enabledSetting: true, ...f }), undefined, JSON.stringify(f))
  }
})
