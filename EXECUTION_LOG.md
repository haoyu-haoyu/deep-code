# DeepCode pure-DeepSeek migration — execution log

Last updated: 2026-05-10 (this PR)
Source plans: PURE_DEEPSEEK_PLAN.md, SANDBOX_FORTRESS_PLAN.md

## Quick status

| Track | Phase | Last completed | Next ready | Blocked? |
|---|---|---|---|---|
| A: Pure-DeepSeek | 0 to 1 | Phase 1 decision docs | P1.1 bridge plus LICENSE replace | no |
| B: Sandbox Fortress | F1 | F1.1 adapter migration | F1.2 per-tool profiles | no |

## How to use this file

- Codex updates this file as part of EVERY task PR. Same commit, never a
  separate one.
- Before starting a task: add a row in "Currently in flight" with task ID,
  branch name, start timestamp.
- On task completion: move the task row from `ready` to `done` in its track
  section, fill PR plus short SHA, remove from "Currently in flight",
  update Quick status.
- If blocked mid-task: mark `blocked` with reason, add to "Blocked items".
- Status markers: `done` · `in-flight` · `ready` · `blocked`.

## Track A — PURE_DEEPSEEK_PLAN.md

### Phase 0: audit

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| P0.1 SDK imports inventory | done | #5 | `9b0b34f` | 227 entries; .json plus .md |
| P0.2 Anthropic-only features | done | (squashed) | `75b5b19` | 21 scopes |
| P0.2-fix file-level breakdown | done | (squashed) | `156d1d7` | 71 file rows |
| P0.3 config and env migration | done | (squashed) | `1b6afcf` | 1607 rows |
| P0.4 product references | done | #12 | `37a6cf7` | 3328 entries |
| P0.5 risk register | done | #13 | `059c6b7` | 28 risks |
| P0.6 sign-off | done | #16 | `bcc1feb` | 34/34 spot-checks |
| Phase 1 decision docs | done | #20 | `479534b` | 6 decision docs plus audit/README plus EXECUTION_LOG |
| Phase 1 decision docs markdown fix | done | (this PR) | (this commit) | restore stripped headings/backticks/code fences |

### Phase 1: excise Anthropic surfaces

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| P1.1 delete bridge / Remote Control plus LICENSE replace | ready | — | — | unblocked by `LICENSE-DECISION.md` |
| P1.2 delete Teleport / Ultraplan / CCR | ready | — | — | depends on P1.1 stubs |
| P1.3 delete Chrome / Desktop / OAuth UI | ready | — | — | depends on P1.2; `docs/deepseek-auth.md` done |
| P1.4 config paths `~/.claude` to `~/.deepcode` | ready | — | — | depends on P1.3 |
| P1.5 `CLAUDE.md` to `DEEPCODE.md` memory | ready | — | — | depends on P1.4 |
| P1.6 remove `CLAUDE_CODE_*` env reads | ready | — | — | depends on P1.4/P1.5 |
| P1.7 replace voice STT (Whisper.cpp) | ready | — | — | `docs/voice-stt.md` done; parallel after P1.3 |
| P1.8 stub `@anthropic-ai/sdk` types | ready | — | — | depends on P1.1-P1.7 callers stable |
| P1.9 drop `@anthropic-ai/sdk` from `package.json` | ready | — | — | depends on P1.8 |
| P1.10 GrowthBook/Statsig plus OTel rename | ready | — | — | `docs/otel-rename.md` done; after P1.4 |
| P1.11 residual cleanup plus model alias swap | ready | — | — | `docs/model-alias-deprecation.md` done; after P1.10 |
| P1.12 Phase 1 sign-off PR | ready | — | — | after P1.1-P1.11 |

### Phases 2-5

Not decomposed yet; refer to `PURE_DEEPSEEK_PLAN.md` and expand here on
phase entry.

## Track B — SANDBOX_FORTRESS_PLAN.md

### F0: scaffold

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| F0.1 fortress scaffold | done | (squashed) | `08f6e7b` | manager plus types plus dirs |
| F0.2 test harness plus bench | done | (squashed) | `49183cf` | 343-line harness |
| F0.3 API contract | done | #14 | `9d7bee8` | 745-line contract |
| F0.3-fix canonicalize path | done | #15 | `7bb9bfc` | dedup root vs package |

### F1: integrate fortress structure

| Task | Status | PR | Commit | Notes |
|---|---|---|---|---|
| F1.1 migrate adapter into fortress | done | #17 | `cbe57d4` | git mv plus shim |
| F1.2 per-tool sandbox profiles | ready | — | — | Next ready |
| F1.3 adapter test coverage hardening | ready | — | — | depends on F1.2 |

### F2-F5

Not decomposed yet; refer to `SANDBOX_FORTRESS_PLAN.md` and expand here on
phase entry.

## External decisions

| Decision | Path | Status |
|---|---|---|
| License posture | `LICENSE-DECISION.md` | done |
| DeepSeek auth UX | `docs/deepseek-auth.md` | done |
| Model alias deprecation | `docs/model-alias-deprecation.md` | done |
| OTel rename | `docs/otel-rename.md` | done |
| Voice STT replacement | `docs/voice-stt.md` | done |
| sandbox-runtime distribution | `docs/sandbox-runtime-distribution.md` | done |

## Currently in flight

(none)

## Blocked items

(none)

## Conventions

- "Squashed" in PR column means merge happened before consistent PR
  labelling; the commit is authoritative.
- Commit short SHA is 7 characters. Always cite merge commit, not branch tip.
- "Depends on X" means cannot start until X is done.
- "Parallel after X" means can start once X is done but does not need X's
  output.
- Update this log in the SAME PR/commit as the task it tracks. Never make
  log-only commits.
- Markdown formatting: ASCII pipes `|` only, no Unicode box-drawing.
- When authoring new doc files, always verify after writing: heading count,
  inline-code backtick count, code-fence count match expectations. Codex
  tooling has stripped markdown markers in past PRs (#18, #20).
