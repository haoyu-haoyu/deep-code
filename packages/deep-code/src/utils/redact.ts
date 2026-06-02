// Redact sensitive information before transmitting diagnostic payloads to
// external services.
//
// Implementation lives in the .mjs sibling so it is unit-testable under
// `node --test`; this wrapper preserves the `src/utils/redact` import path.
export { redactSensitiveInfo } from './redact.mjs'
