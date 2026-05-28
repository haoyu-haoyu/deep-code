# Audit directory

Phase 0 audit artifacts for the pure-DeepSeek migration. These files are
read-only references for Phase 1 implementation.

## Index

| Artifact | Task | Purpose |
|---|---|---|
| `anthropic-imports.json` | P0.1 | Raw 227-entry inventory of every `@anthropic-ai/*` import in the codebase. |
| `anthropic-imports.md` | P0.1 | Human-readable summary of the JSON inventory: 5 category rows, 20 symbol rows, 13 module rows. |
| `anthropic-features.md` | P0.2 + P0.2-fix | Anthropic-only feature inventory: 21 top-level scopes plus 71 file-level rows with DELETE / REWRITE / STUB classifications. |
| `config-migration.md` | P0.3 | 1607-row map of `CLAUDE_CODE_*` to `DEEPCODE_*` env vars, settings, and config paths. Includes DELETE-with-feature classifications for OAuth / bridge / CCR / Chrome. |
| `anthropic-product-refs.md` | P0.4 | 3328-entry inventory of literal Anthropic product references (Claude / Anthropic / claude.ai / model aliases) with rebrand / delete / keep classification. |
| `risk-register.md` | P0.5 | 28 risks across 12 risk classes with mitigations, owning Phase 1 tasks, and 16 prerequisites. |
| `phase-0-signoff.md` | P0.6 | Cross-consistency audit of the bundle. 34 spot-checks (34 PASS), 6 GO / 6 NO-GO Phase 1 task decisions, Phase 1 entry checklist. |

## How to use

1. Phase 1 PRs cite specific audit lines in their description (e.g.,
   `audit/anthropic-features.md:54`) as evidence.
2. Negative regression tests reference KEEP rows from
   `anthropic-product-refs.md`.
3. Phase 1 task ordering follows the critical path in `phase-0-signoff.md`.

## Phase status

- **Phase 0 (Audit)**: complete; 6 artifacts above are read-only references.
- **Phase 1 (Anthropic Excision)**: complete at v0.2.0-pure (2026-05-26).
  See TODO.md for full milestone list and EXECUTION_LOG.md for per-PR
  citations. All audit artifacts referenced as evidence during Phase 1 remain
  intact for historical record.
- **Phase 2 (DeepSeek-TUI feature adoption)**: complete at
  v0.3.0-feature-parity (2026-05-28). 9/9 priority features adopted
  (auto mode + multi-provider + cache viz + workspace rollback + LSP +
  HTTP serve + session fork + doctor + workspace slash). P2.10 i18n
  deferred. See TODO.md for milestone list.
- **Phase 3 (Distribution)**: complete at v0.4.0-distributed (2026-05-28).
  Docker + GitHub Release binaries ready (autonomous channels using
  GITHUB_TOKEN). npm publish (P3.1.c) deferred pending user `@deepcode-ai`
  org ownership confirmation. Homebrew + Windows binary + multi-arch Docker
  deferred. See TODO.md for milestone list.
- **Future phases**: no formal Phase 4 defined; next based on user priorities.

## What lives here vs `docs/`

- `audit/` — **read-only audit artifacts**. Not modified after the owning
  task closes (except for explicit `-fix` follow-ups, e.g., P0.2-fix).
- `docs/` — **active design and decision documents**. Updated as decisions
  evolve.
- Decision docs that gate Phase 1 (license, auth, OTel rename, etc.) live
  in `docs/`, not `audit/`.

## See also

- `EXECUTION_LOG.md` — live status of every Track A and Track B task,
  updated by Codex on every PR.
- `PURE_DEEPSEEK_PLAN.md` — Phase 0 to Phase 5 master plan.
- `SANDBOX_FORTRESS_PLAN.md` — Track B (sandbox wrapper) plan.
- `LICENSE-DECISION.md` — license posture for self-use vs hypothetical
  release.
- `docs/sandbox-fortress/API_CONTRACT.md` — Track B Layer 2-5 public API
  contract.
- `docs/deepseek-auth.md`, `docs/model-alias-deprecation.md`,
  `docs/otel-rename.md`, `docs/voice-stt.md`,
  `docs/sandbox-runtime-distribution.md` — Phase 1 entry decision docs.
