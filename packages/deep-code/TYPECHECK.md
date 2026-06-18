# Type-checking gate

This package historically shipped **without a `tsconfig.json`** and was never
type-checked: the runtime is built with `Bun.build()`, which strips TypeScript
types without checking them, so type errors compiled and shipped silently. This
caused real, invisible breakage (e.g. the `input_tokens` accounting class of bugs).

`tsconfig.json` + `npm run typecheck` establish a gate.

## Usage

```sh
npm run typecheck                 # informational: prints the error count + top codes, exits 0
npm run typecheck -- --max-errors=1642   # ratchet: exits 1 if the count EXCEEDS 1642
```

The config is `--noEmit` only (never used to build), `moduleResolution: bundler`
to match the `Bun.build` bundler, `skipLibCheck`, and non-`strict` to start.
It enables type-checking in every contributor's editor/IDE immediately.

## Current baseline

As of this gate's introduction: **~1642 errors** (tsc 5.6.3). The gate runs in CI
as a **non-blocking step** (`continue-on-error`) for visibility. It is intentionally
NOT blocking yet — see the two prerequisites below.

The baseline is dominated by two structural, pre-existing issues, not 1642
distinct bugs:

1. **Missing `src/types/message.ts`** — the core `Message` type is imported
   *type-only* from `../types/message.js` across **166 files**, but that module
   does not exist in this fork (the bundler erased the type imports, so it never
   failed to build). This single gap produces the bulk of `TS2307` (cannot find
   module) plus a cascade of `TS2339`/`TS2305` as `Message` degrades to `any`.
   **Reconstructing this type is the single highest-leverage burn-down item.**
2. **Undeclared dependencies** — `package.json` `dependencies` is `{}` and the
   lockfile is stale (see roadmap item #11). A few third-party imports
   (`type-fest`, `@anthropic-ai/mcpb`, `@ant/computer-use-mcp`) don't resolve.
   This also makes the count **environment-dependent**, which is why the CI gate
   is non-blocking for now.

## Making it blocking (the ratchet)

Once #11 (declare deps + rebuild lockfile) lands so `npm ci` produces a
reproducible `node_modules`, and the `message.ts` gap is addressed, flip the CI
step from `continue-on-error` to a ratchet:

```yaml
- run: cd packages/deep-code && npm run typecheck -- --max-errors=<current baseline>
```

and lower the budget as errors are burned down (the script prints when the count
drops below the budget so you can tighten it).
