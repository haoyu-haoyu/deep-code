Model alias deprecation policy

Status: Decided
Decision date: 2026-05-10

Summary

DeepCode uses DeepSeek model names directly. Legacy model aliases from
`packages/deep-code/src/utils/model/aliases.ts::MODEL_ALIASES` are removed
without a deprecation window — no auto-mapping, no warnings, hard cutover.

New model union

packages/deep-code/sdk-tools.d.ts:274 becomes:

model?:
  | "deepseek-v4-pro"
  | "deepseek-v4-flash"
  | "deepseek-chat"
  | "deepseek-reasoner"
  | `deepseek-${string}`;

What is removed

- "sonnet", "opus", "haiku", "best", "sonnet[1m]", "opus[1m]", and
  "opusplan" — current `MODEL_ALIASES` values are deleted.
- No accept-with-warning compatibility shim.
- No auto-mapping (e.g., opus → deepseek-reasoner).
- Current DeepCode model IDs (`deepseek-v4-pro`, `deepseek-v4-flash`) remain
valid alongside DeepSeek-prefixed passthrough IDs.
- All legacy model-alias references in packages/deep-code/src/ are rewritten or
deleted in P1.11.

Rationale

- DeepCode is self-use only (see LICENSE-DECISION.md).
- No external SDK consumers depend on sdk-tools.d.ts model literals.
- Compatibility windows add code without value when there are no users to
migrate.
- Hard cutover gives a smaller, more correct surface.

Tests required before P1.11

- sdk-tools.d.ts type check: passing "sonnet" to model field is a type
error.
- Type check: passing "deepseek-reasoner" is valid.
- Type check: passing "deepseek-v4-pro" and "deepseek-v4-flash" is valid.
- No legacy model alias literal/config value remains in packages/deep-code/src/
or the rebuilt committed bundle `packages/deep-code/dist/deepcode-full.mjs`
after P1.11. Derive the exact alias list from
`packages/deep-code/src/utils/model/aliases.ts::MODEL_ALIASES` and match exact
quoted or template-literal values only, e.g.
```
(['"`])(sonnet|opus|haiku|best|sonnet\[1m\]|opus\[1m\]|opusplan)\1
```
Also run a source grep for Claude-family model IDs in quoted, prefixed, or
template text:
```
claude-[^[:space:]"']*(sonnet|opus|haiku)
```
This catches prefixed Bedrock IDs such as `us.anthropic.claude-opus-4-6-v1`,
`anthropic.claude-sonnet-*`, and backtick text like `claude-sonnet-4-6`. Do
not ban arbitrary substrings, so unrelated terms like `octopus` and
`best-effort` are not matches. Exclude KEEP fixtures from
audit/anthropic-product-refs.md.

Phase 1 unblock

This decision unblocks P1.11's rename of sdk-tools.d.ts model union.
