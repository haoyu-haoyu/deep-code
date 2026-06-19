import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isBlockedAddress } from '../src/utils/hooks/ssrfBlockedAddress.mjs'

// --- blocked ranges (both hook and WebFetch modes) ---------------------------

test('private / link-local / metadata / CGNAT ranges are blocked', () => {
  for (const ip of [
    '0.0.0.0',
    '10.0.0.1',
    '169.254.169.254', // cloud metadata (the headline SSRF target)
    '172.16.0.1',
    '172.31.255.255',
    '100.100.100.200', // Alibaba metadata (CGNAT)
    '192.168.1.1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `should block ${ip}`)
    assert.equal(isBlockedAddress(ip, { blockLoopback: true }), true, `should block ${ip}`)
  }
})

test('IPv6 unspecified / ULA / link-local / mapped-metadata are blocked', () => {
  for (const ip of [
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:169.254.169.254', // IPv4-mapped metadata
    '::ffff:a9fe:a9fe', // hex-form IPv4-mapped metadata (169.254.169.254)
  ]) {
    assert.equal(isBlockedAddress(ip), true, `should block ${ip}`)
  }
})

// --- loopback: allowed for hooks, blocked for WebFetch -----------------------

test('loopback is allowed by default (hooks) and blocked under blockLoopback (WebFetch)', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '::1']) {
    assert.equal(isBlockedAddress(ip), false, `hooks allow ${ip}`)
    assert.equal(
      isBlockedAddress(ip, { blockLoopback: true }),
      true,
      `WebFetch blocks ${ip}`,
    )
  }
  // an IPv4-mapped loopback follows the same rule
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), false)
  assert.equal(isBlockedAddress('::ffff:127.0.0.1', { blockLoopback: true }), true)
})

// --- public addresses are never blocked --------------------------------------

test('public addresses and non-IP inputs are not blocked', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, `public ${ip} allowed`)
    assert.equal(isBlockedAddress(ip, { blockLoopback: true }), false, `public ${ip} allowed`)
  }
  // a hostname (not an IP literal) is not classified here — the DNS path handles it
  assert.equal(isBlockedAddress('example.com'), false)
  assert.equal(isBlockedAddress(''), false)
})

// --- range boundaries are exact ----------------------------------------------

test('range boundaries: 172.16/12 and 100.64/10 do not over- or under-block', () => {
  assert.equal(isBlockedAddress('172.15.0.1'), false) // just below /12
  assert.equal(isBlockedAddress('172.32.0.1'), false) // just above /12
  assert.equal(isBlockedAddress('100.63.0.1'), false) // just below /10
  assert.equal(isBlockedAddress('100.128.0.1'), false) // just above /10
  assert.equal(isBlockedAddress('169.253.0.1'), false) // not 169.254
})
