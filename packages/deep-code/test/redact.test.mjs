import test from 'node:test'
import assert from 'node:assert/strict'

import { redactSensitiveInfo } from '../src/utils/redact.mjs'

// ── secret redaction before diagnostics leave the machine ────────────────────
// redactSensitiveInfo scrubs API keys / tokens / secrets out of diagnostic
// payloads (FeedbackSurvey transcript-share, marketplace logging) before they go
// to an external service. A regex gap = a leaked credential. It had ZERO direct
// unit coverage (trapped in a .ts node --test can't load); behavior is a verbatim
// extraction — these tests pin the current contract. Keys below are fake.

const ANT = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2'.repeat(2) // long, quote-safe

test('redacts Anthropic sk-ant keys, quoted and unquoted', () => {
  const quoted = redactSensitiveInfo(`{"key":"${ANT}"}`)
  assert.equal(quoted, '{"key":"[REDACTED_API_KEY]"}')
  assert.ok(!quoted.includes('sk-ant'))

  const unquoted = redactSensitiveInfo(`token is sk-ant-abc1234567890 here`)
  assert.match(unquoted, /\[REDACTED_API_KEY\]/)
  assert.ok(!unquoted.includes('sk-ant-abc'))
})

test('sk-ant word boundary: a key glued to leading alphanumerics is NOT matched', () => {
  // lookbehind (?<![A-Za-z0-9"']) — `xsk-ant...` must stay (avoids partial-token noise).
  const glued = 'xsk-ant-abc1234567890'
  assert.equal(redactSensitiveInfo(glued), glued)
})

test('redacts AWS access key IDs (AKIA…) and the AWS key: "AWS…" form', () => {
  assert.equal(redactSensitiveInfo('AKIAIOSFODNN7EXAMPLE'), '[REDACTED_AWS_KEY]')
  assert.equal(
    redactSensitiveInfo('AWS key: "AWS01234567890123456789"'),
    'AWS key: "[REDACTED_AWS_KEY]"',
  )
})

test('redacts GCP API keys (AIza…) and service-account emails', () => {
  const gcp = 'AIza' + 'B'.repeat(35)
  assert.equal(redactSensitiveInfo(gcp), '[REDACTED_GCP_KEY]')
  assert.equal(
    redactSensitiveInfo('svc: my-bot-1@my-proj.iam.gserviceaccount.com'),
    'svc: [REDACTED_GCP_SERVICE_ACCOUNT]',
  )
})

test('redacts header-style secrets: x-api-key and authorization bearer (prefix preserved)', () => {
  // KNOWN QUIRK (pre-existing, documented): the x-api-key rule redacts first,
  // then the later generic `API[-_]?KEY[=:]` rule re-matches the same `api-key:`
  // prefix and double-redacts the placeholder, yielding `[REDACTED]]`. This is
  // cosmetic over-redaction — the real secret is still fully removed (no leak).
  const out = redactSensitiveInfo('x-api-key: deadbeefcafef00d')
  assert.equal(out, 'x-api-key: [REDACTED]]')
  assert.ok(!out.includes('deadbeef'), 'the secret value is gone')

  // authorization does NOT cascade (no `[=:]` after TOKEN in the placeholder).
  assert.equal(
    redactSensitiveInfo('Authorization: Bearer abc.def.ghi'),
    'Authorization: Bearer [REDACTED_TOKEN]',
  )
})

test('redacts AWS_*/GOOGLE_* assignments and generic KEY/TOKEN/SECRET/PASSWORD', () => {
  assert.equal(
    redactSensitiveInfo('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY'),
    'AWS_SECRET_ACCESS_KEY=[REDACTED_AWS_VALUE]',
  )
  assert.equal(
    redactSensitiveInfo('GOOGLE_APPLICATION_CREDENTIALS=/tmp/creds.json'),
    'GOOGLE_APPLICATION_CREDENTIALS=[REDACTED_GCP_VALUE]',
  )
  assert.equal(redactSensitiveInfo('API_KEY=supersecretvalue'), 'API_KEY=[REDACTED]')
  assert.equal(redactSensitiveInfo('password: hunter2horse'), 'password: [REDACTED]')
  assert.equal(redactSensitiveInfo('TOKEN = abc123def456'), 'TOKEN = [REDACTED]')
})

// DeepSeek/OpenAI bare `sk-` keys — THIS fork's primary credential. The sk-ant
// rules don't match them, so before this coverage a key pasted in prose or the
// on-disk `"apiKey": "sk-…"` config blob leaked through the transcript-share
// scrubber. Keys below are fake.
const SK = 'sk-' + '0a1b2c3d4e5f60718293a4b5c6d7e8f9' // DeepSeek shape: sk- + 32 hex
const PROJ = 'sk-proj-' + 'AbCdEf0123456789AbCdEf0123456789' // OpenAI project key

test('redacts bare DeepSeek/OpenAI sk- keys in prose and the on-disk apiKey JSON shape', () => {
  const prose = redactSensitiveInfo(`my key is ${SK} ok`)
  assert.equal(prose, 'my key is [REDACTED_API_KEY] ok')
  assert.ok(!prose.includes(SK))

  // The deepseek-config.json on-disk shape `"apiKey": "sk-…"` — the generic
  // API_KEY rule can't catch it (the quote between `apiKey"` and `:` defeats it).
  const pretty = redactSensitiveInfo(`{\n  "apiKey": "${SK}",\n  "baseURL": "https://api.deepseek.com"\n}`)
  assert.ok(!pretty.includes(SK))
  assert.match(pretty, /"apiKey": "\[REDACTED_API_KEY\]"/)
  assert.ok(pretty.includes('https://api.deepseek.com'), 'non-secret fields survive')

  const compact = redactSensitiveInfo(`{"apiKey":"${SK}"}`)
  assert.equal(compact, '{"apiKey":"[REDACTED_API_KEY]"}')

  const proj = redactSensitiveInfo(`key ${PROJ} here`)
  assert.equal(proj, 'key [REDACTED_API_KEY] here')
  assert.ok(!proj.includes(PROJ))
})

test('redacts the key on the REAL egress shape — JSON.stringify(data) escapes the config blob to \\"sk-…\\"', () => {
  // submitTranscriptShare runs redactSensitiveInfo(JSON.stringify(data)), so a
  // config blob surfaced in a transcript NEVER reaches the scrubber as a plain
  // `"sk-…"`: JSON-encoding escapes it to `\"sk-…\"` (and doubly so inside the
  // already-JSON rawTranscriptJsonl). The quoted rule's `[^\s"']` class must
  // absorb the escaping backslash(es) and still redact — a narrow class stops at
  // the `\` and the key leaks. This is the shape that actually goes on the wire.
  const onDisk = `{"apiKey": "${SK}", "baseURL": "https://api.deepseek.com"}`

  // (i) the blob as a string field in the payload → single JSON-escape
  const once = redactSensitiveInfo(JSON.stringify({ toolResult: onDisk }))
  assert.ok(!once.includes(SK), 'single-escaped config blob must not leak')
  assert.match(once, /REDACTED_API_KEY/)

  // (ii) the blob inside a rawTranscriptJsonl line, re-stringified → double-escape
  const jsonlLine = JSON.stringify({ type: 'tool_result', content: onDisk })
  const twice = redactSensitiveInfo(JSON.stringify({ rawTranscriptJsonl: jsonlLine }))
  assert.ok(!twice.includes(SK), 'double-escaped rawTranscriptJsonl blob must not leak')
  assert.match(twice, /REDACTED_API_KEY/)

  // (iii) full faithful payload: transcript array + rawTranscriptJsonl together
  const wire = redactSensitiveInfo(
    JSON.stringify({
      transcript: [{ role: 'assistant', content: `here is the config:\n${onDisk}` }],
      rawTranscriptJsonl: [jsonlLine, JSON.stringify({ role: 'user', content: `my key is ${SK}` })].join('\n'),
    }),
  )
  assert.ok(!wire.includes(SK), 'key must not survive anywhere in the stringified payload')
})

test('redacts a key flush against a JSON string quote (last/first token of a message), not just space-delimited', () => {
  // The MOST common paste: a key as the last token of a message — after
  // JSON.stringify it sits flush against the closing quote (`…sk-KEY"`). The
  // unquoted rule's boundary must treat that terminating quote as a valid end
  // (key-char check), not as key-continuation, or the key leaks. Symmetric for a
  // key that STARTS a value (`"sk-KEY …"`), which the quoted rule can't catch
  // (interior space) and the lookbehind must not reject for a leading quote.
  const endRaw = redactSensitiveInfo(`{"role":"user","content":"my deepseek key is ${SK}"}`)
  assert.ok(!endRaw.includes(SK), 'key ending a message must not leak')

  const endWire = redactSensitiveInfo(JSON.stringify({ content: `my key is ${SK}` }))
  assert.ok(!endWire.includes(SK), 'escaped key ending a message must not leak')

  const startWire = redactSensitiveInfo(JSON.stringify({ content: `${SK} is the key i use` }))
  assert.ok(!startWire.includes(SK), 'key starting a value (with trailing text) must not leak')
})

test('redacts a key on its OWN LINE / column — JSON escapes the newline/tab to \\n/\\t before sk-', () => {
  // The most common multi-line paste: a key after a label on its own line, in a
  // code fence, or in a tab-separated env dump. JSON.stringify turns the real
  // \n/\t into the 2-char escape `\` + `n`/`t`, so the char literally before
  // `sk-` is the LETTER n/t. The leading lookbehind must let the escaped form
  // through (the letter is preceded by `\`) while still rejecting real word glue.
  const ownLine = redactSensitiveInfo(JSON.stringify({ content: `My DeepSeek key:\n${SK}` }))
  assert.ok(!ownLine.includes(SK), 'key on its own line must not leak')

  const codeFence = redactSensitiveInfo(JSON.stringify({ content: '```\n' + SK + '\n```' }))
  assert.ok(!codeFence.includes(SK), 'key in a code fence must not leak')

  const tabbed = redactSensitiveInfo(JSON.stringify({ content: `DEEPSEEK_API_KEY\t${SK}` }))
  assert.ok(!tabbed.includes(SK), 'tab-separated key must not leak')
})

test('sk- redaction does NOT touch hyphenated identifiers that merely contain "sk-"', () => {
  // task-/risk-/disk- etc. contain `sk-` mid-word; the leading lookbehind must
  // still reject them (the letter before `sk-` is preceded by another word char,
  // not a backslash) — otherwise the escape-prefix fix would over-redact.
  for (const id of [
    'task-management-system-component-name-v2',
    'risk-assessment-framework-modules-x1',
    'disk-usage-monitor-daemon-service-01',
  ]) {
    assert.equal(redactSensitiveInfo(id), id, `${id} must be untouched`)
  }
})

test('sk- redaction: short substrings and glued/prefixed tokens are NOT touched (low FP noise)', () => {
  // {20,} floor — a real key is 32+ chars; shorter `sk-` substrings stay.
  assert.equal(redactSensitiveInfo('sk-short1'), 'sk-short1')
  assert.equal(redactSensitiveInfo('sk-' + 'a'.repeat(19)), 'sk-' + 'a'.repeat(19))
  // exactly 20 chars after `sk-` crosses the floor and is redacted
  assert.equal(redactSensitiveInfo('sk-' + 'a'.repeat(20)), '[REDACTED_API_KEY]')
  // leading-alnum glue (word boundary) is left alone, like the sk-ant rule
  const glued = 'xsk-' + 'a'.repeat(25)
  assert.equal(redactSensitiveInfo(glued), glued)
  // an unrelated `task-…` token (no sk- prefix) is untouched
  const task = 'task-abc12345678901234567890'
  assert.equal(redactSensitiveInfo(task), task)
})

test('sk- rule runs after the structured rules: Authorization: Bearer sk-… stays a clean token redaction', () => {
  // Placed last so the authorization rule claims its form first — no double-redact.
  const out = redactSensitiveInfo(`Authorization: Bearer ${SK}`)
  assert.equal(out, 'Authorization: Bearer [REDACTED_TOKEN]')
  assert.ok(!out.includes(SK))
})

test('leaves non-secret text untouched, and redacts multiple secrets in one blob', () => {
  const innocent = 'the curl command failed with exit code 7 at /usr/bin/curl'
  assert.equal(redactSensitiveInfo(innocent), innocent)

  const blob = `AKIAIOSFODNN7EXAMPLE and API_KEY=topsecret123 and ${ANT}`
  const out = redactSensitiveInfo(blob)
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'))
  assert.ok(!out.includes('topsecret123'))
  assert.ok(!out.includes('sk-ant'))
  assert.match(out, /\[REDACTED_AWS_KEY\]/)
  assert.match(out, /\[REDACTED\]/)
  assert.match(out, /\[REDACTED_API_KEY\]/)
})
