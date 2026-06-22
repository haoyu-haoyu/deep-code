import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSensitiveHeaderName,
  redactSensitiveHeaders,
  stripUrlCredentials,
} from '../src/services/mcp/redactSensitiveLogData.mjs'

test('isSensitiveHeaderName flags the credential family (case-insensitive)', () => {
  for (const name of [
    'Authorization',
    'authorization',
    'Proxy-Authorization',
    'X-Api-Key',
    'api-key',
    'apikey',
    'Cookie',
    'Set-Cookie',
    'X-Auth-Token',
    'X-Claude-Code-Ide-Authorization',
    'X-Session-Id',
    'X-Secret',
    'X-Password',
    'WWW-Authenticate',
    // the `-Key` family that a bare `api-key` match would miss (Azure et al.)
    'X-Functions-Key',
    'Ocp-Apim-Subscription-Key',
    'X-Subscription-Key',
    'X-Acme-Key',
  ]) {
    assert.equal(isSensitiveHeaderName(name), true, `${name} should be sensitive`)
  }
})

test('isSensitiveHeaderName leaves benign headers alone', () => {
  for (const name of [
    'Content-Type',
    'Accept',
    'User-Agent',
    'Content-Length',
    'X-Request-Id',
    'Mcp-Protocol-Version',
  ]) {
    assert.equal(isSensitiveHeaderName(name), false, `${name} should NOT be sensitive`)
  }
  // non-string fails closed (treated as not-a-name → not redacted, but also never trusted)
  assert.equal(isSensitiveHeaderName(undefined), false)
  assert.equal(isSensitiveHeaderName(42), false)
})

test('THE FIX: redactSensitiveHeaders masks every credential header, not just authorization', () => {
  const headers = {
    Authorization: 'Bearer FAKE_TOKEN_VALUE',
    'X-Api-Key': 'FAKE_API_KEY',
    Cookie: 'session=FAKE_SESSION',
    'X-Claude-Code-Ide-Authorization': 'FAKE_IDE_TOKEN',
    'Content-Type': 'application/json',
    'User-Agent': 'deepcode/1.0',
  }
  const r = redactSensitiveHeaders(headers)
  assert.equal(r.Authorization, '[REDACTED]')
  assert.equal(r['X-Api-Key'], '[REDACTED]')
  assert.equal(r.Cookie, '[REDACTED]')
  assert.equal(r['X-Claude-Code-Ide-Authorization'], '[REDACTED]')
  // benign headers preserved
  assert.equal(r['Content-Type'], 'application/json')
  assert.equal(r['User-Agent'], 'deepcode/1.0')
  // input not mutated
  assert.equal(headers.Authorization, 'Bearer FAKE_TOKEN_VALUE')
})

test('redactSensitiveHeaders passes through non-object input unchanged', () => {
  assert.equal(redactSensitiveHeaders(undefined), undefined)
  assert.equal(redactSensitiveHeaders(null), null)
})

test('stripUrlCredentials drops query string AND user:pass@ userinfo', () => {
  // both a token query param and basic-auth userinfo must be stripped
  assert.equal(
    stripUrlCredentials('https://user:secret@mcp.example.com/sse?token=abc'),
    'https://mcp.example.com/sse',
  )
  // userinfo with only a username
  assert.equal(
    stripUrlCredentials('https://apiuser@mcp.example.com/path/'),
    'https://mcp.example.com/path',
  )
  // plain url: query stripped, trailing slash trimmed
  assert.equal(
    stripUrlCredentials('https://mcp.example.com/?x=1'),
    'https://mcp.example.com',
  )
  // no credentials, no query: returned normalized
  assert.equal(
    stripUrlCredentials('https://mcp.example.com/v1/sse'),
    'https://mcp.example.com/v1/sse',
  )
})

test('stripUrlCredentials returns undefined for non-URLs / non-strings', () => {
  assert.equal(stripUrlCredentials('not a url'), undefined)
  assert.equal(stripUrlCredentials(undefined), undefined)
  assert.equal(stripUrlCredentials(42), undefined)
})
