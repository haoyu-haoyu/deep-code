// Pure normalizer for a single on-disk scheduled task, extracted from
// cronTasks.ts (a .ts file, not directly node --test-loadable) so the
// strip-vs-preserve behavior can be unit-tested.
//
// The keys cronTasks.ts knows about. Anything NOT in this set is a
// forward-compatible field written by a NEWER DeepCode version and must be
// preserved across a read→mutate→write round-trip (an older binary that drops
// it would silently destroy the user's newer scheduler settings). `durable`
// and `agentId` are runtime-only flags that are deliberately NEVER rehydrated
// from disk, so they sit in the known set (excluded from preservation) and are
// stripped below.
export const KNOWN_CRON_TASK_KEYS = new Set([
  'id',
  'cron',
  'prompt',
  'createdAt',
  'lastFiredAt',
  'recurring',
  'permanent',
  'durable',
  'agentId',
])

/**
 * Rebuild a raw on-disk task object into the canonical CronTask shape while
 * preserving any forward-compatible unknown fields. The caller (readCronTasks)
 * has already validated that `t` is an object with string id/cron/prompt and a
 * numeric createdAt and a parseable cron string.
 *
 * Behavior for the known fields is identical to the previous inline rebuild:
 *   - id/cron/prompt/createdAt are carried verbatim,
 *   - lastFiredAt is kept only when it is a number,
 *   - recurring/permanent are normalized to `true` when truthy, else omitted,
 *   - the runtime-only durable/agentId flags are never read back from disk.
 * The only change is that genuinely-unknown keys now survive.
 *
 * @param {Record<string, unknown>} t a disk task that passed the type guards
 * @returns {Record<string, unknown>} the normalized task
 */
export function normalizeCronTaskForRead(t) {
  // Spread FIRST so forward-compatible unknown keys survive. Object spread
  // copies an own `__proto__` data key from JSON.parse as plain data (it does
  // NOT invoke the prototype setter, unlike `obj[key] = value`), so there is no
  // prototype-pollution path. The canonical known fields below overwrite their
  // spread values in place.
  const normalized = {
    ...t,
    id: t.id,
    cron: t.cron,
    prompt: t.prompt,
    createdAt: t.createdAt,
  }
  // Re-derive the conditionally-present known fields so an invalid or falsy
  // disk value is normalized to "omitted" exactly as the old code did, rather
  // than leaking the raw spread value through.
  if (typeof t.lastFiredAt === 'number') normalized.lastFiredAt = t.lastFiredAt
  else delete normalized.lastFiredAt
  if (t.recurring) normalized.recurring = true
  else delete normalized.recurring
  if (t.permanent) normalized.permanent = true
  else delete normalized.permanent
  // Runtime-only flags are never persisted/rehydrated from disk.
  delete normalized.durable
  delete normalized.agentId
  return normalized
}
