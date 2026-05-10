# Model alias deprecation policy

Status: Decided
Decision date: 2026-05-10

## Summary

DeepCode uses DeepSeek model names directly. Legacy Claude model literals
(`sonnet`, `opus`, `haiku`) are removed without a deprecation window — no
auto-mapping, no warnings, hard cutover.

## New model union

`packages/deep-code/sdk-tools.d.ts:274` becomes:

```ts
model?: "deepseek-chat" | "deepseek-coder" | "deepseek-reasoner";
```

## What is removed

- `"sonnet"`, `"opus"`, `"haiku"` — all three string literals deleted.
- No accept-with-warning compatibility shim.
- No auto-mapping (e.g., `opus` to `deepseek-reasoner`).
- All references in `packages/deep-code/src/` are rewritten or deleted in P1.11.

## Rationale

- DeepCode is self-use only (see `LICENSE-DECISION.md`).
- No external SDK consumers depend on `sdk-tools.d.ts` model literals.
- Compatibility windows add code without value when there are no users to
  migrate.
- Hard cutover gives a smaller, more correct surface.

## Tests required before P1.11

- `sdk-tools.d.ts` type check: passing `"sonnet"` to model field is a type
  error.
- Type check: passing `"deepseek-reasoner"` is valid.
- No string occurrence of `"sonnet"`, `"opus"`, `"haiku"` in
  `packages/deep-code/src/` after P1.11, excluding KEEP fixtures from
  `audit/anthropic-product-refs.md`.

## Phase 1 unblock

This decision unblocks **P1.11**'s rename of `sdk-tools.d.ts` model union.
