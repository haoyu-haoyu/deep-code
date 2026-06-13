// Redact sensitive information before transmitting diagnostic payloads to
// external services.
//
// Pure logic lives here (a .mjs sibling) so it is unit-testable under
// `node --test`. The .ts wrapper re-exports it.

/**
 * @param {string} text
 * @returns {string}
 */
export function redactSensitiveInfo(text) {
  let redacted = text

  // Anthropic API keys (sk-ant...) with or without quotes.
  redacted = redacted.replace(
    /"(sk-ant[^\s"']{24,})"/g,
    '"[REDACTED_API_KEY]"',
  )
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .replace(re, string) on no-match returns same string.
    /(?<![A-Za-z0-9"'])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9"'])/g,
    '[REDACTED_API_KEY]',
  )

  redacted = redacted.replace(
    /AWS key: "(AWS[A-Z0-9]{20,})"/g,
    'AWS key: "[REDACTED_AWS_KEY]"',
  )
  redacted = redacted.replace(/(AKIA[A-Z0-9]{16})/g, '[REDACTED_AWS_KEY]')
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above.
    /(?<![A-Za-z0-9])(AIza[A-Za-z0-9_-]{35})(?![A-Za-z0-9])/g,
    '[REDACTED_GCP_KEY]',
  )
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above.
    /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g,
    '[REDACTED_GCP_SERVICE_ACCOUNT]',
  )

  redacted = redacted.replace(
    /(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi,
    '$1[REDACTED_API_KEY]',
  )
  redacted = redacted.replace(
    /(["']?authorization["']?\s*[:=]\s*["']?(bearer\s+)?)[^"',\s)}\]]+/gi,
    '$1[REDACTED_TOKEN]',
  )
  redacted = redacted.replace(
    /(AWS[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi,
    '$1[REDACTED_AWS_VALUE]',
  )
  redacted = redacted.replace(
    /(GOOGLE[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi,
    '$1[REDACTED_GCP_VALUE]',
  )
  redacted = redacted.replace(
    /((API[-_]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi,
    '$1[REDACTED]',
  )

  // DeepSeek / OpenAI API keys (sk-… / sk-proj-…). The sk-ant rules above only
  // match Anthropic keys, but THIS fork's primary credential is a bare `sk-` key
  // (deepseek-config.json stores it as `"apiKey": "sk-…"`). Without these rules a
  // key pasted in prose, or the on-disk config blob surfaced in a transcript,
  // leaks through this scrubber — the sole guard on submitTranscriptShare's POST
  // to api.anthropic.com. Run LAST so the structured authorization/x-api-key
  // rules claim their forms first (avoids a double-redacted `[REDACTED_TOKEN]]`).
  // {20,} floor: long enough to skip short `sk-` substrings (a real key is 32+).
  redacted = redacted.replace(
    /"(sk-(?:proj-)?[A-Za-z0-9_-]{20,})"/g,
    '"[REDACTED_API_KEY]"',
  )
  redacted = redacted.replace(
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .replace(re, string) on no-match returns same string.
    /(?<![A-Za-z0-9"'])(sk-(?:proj-)?[A-Za-z0-9_-]{20,})(?![A-Za-z0-9"'])/g,
    '[REDACTED_API_KEY]',
  )

  return redacted
}
