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

test('IPv6 forms embedding a blocked IPv4 (compatible / NAT64 / 6to4) are blocked', () => {
  for (const ip of [
    // IPv4-compatible ::a.b.c.d (::/96)
    '::169.254.169.254', // metadata
    '::a9fe:a9fe', // hex form of the same
    '::10.0.0.1', // private
    // NAT64 well-known prefix 64:ff9b::/96
    '64:ff9b::a9fe:a9fe', // 169.254.169.254 metadata
    '64:ff9b::169.254.169.254',
    '64:ff9b::a00:1', // 10.0.0.1 private
    // 6to4 2002:v4::/16
    '2002:a9fe:a9fe::', // 169.254.169.254 metadata
    '2002:a9fe:a9fe::1',
    '2002:c0a8:0001::', // 192.168.0.1 private
  ]) {
    assert.equal(isBlockedAddress(ip), true, `should block ${ip}`)
    assert.equal(
      isBlockedAddress(ip, { blockLoopback: true }),
      true,
      `should block ${ip}`,
    )
  }
  // loopback embedded via these forms follows the blockLoopback rule
  assert.equal(isBlockedAddress('::127.0.0.1'), false) // hooks allow loopback
  assert.equal(isBlockedAddress('::127.0.0.1', { blockLoopback: true }), true)
  assert.equal(isBlockedAddress('64:ff9b::7f00:1', { blockLoopback: true }), true) // 127.0.0.1
})

test('public IPv4 embedded in 6to4 / NAT64 / compatible is NOT over-blocked', () => {
  for (const ip of [
    '2002:0808:0808::', // 6to4 of 8.8.8.8 (public)
    '64:ff9b::808:808', // NAT64 of 8.8.8.8 (public)
    '::5db8:d822', // IPv4-compatible 93.184.216.34 (public)
  ]) {
    assert.equal(isBlockedAddress(ip), false, `public-embedded ${ip} allowed`)
    assert.equal(
      isBlockedAddress(ip, { blockLoopback: true }),
      false,
      `public-embedded ${ip} allowed`,
    )
  }
  // a genuine global-unicast IPv6 (not an embedding form) stays allowed
  assert.equal(isBlockedAddress('2001:db8::1'), false)
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
