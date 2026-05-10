DeepCode pure-DeepSeek migration — execution log

Last updated: 2026-05-10 (this PR)
Source plans: PURE_DEEPSEEK_PLAN.md, SANDBOX_FORTRESS_PLAN.md

Quick status

┌─────────────────────┬───────┬─────────────────────────────────┬───────────────────────────────┬──────────┐
│        Track        │ Phase │         Last completed          │          Next ready           │ Blocked? │
├─────────────────────┼───────┼─────────────────────────────────┼───────────────────────────────┼──────────┤
│ A: Pure-DeepSeek    │ 0 → 1 │ Phase 1 decision docs (this PR) │ P1.1 bridge + LICENSE replace │ no       │
├─────────────────────┼───────┼─────────────────────────────────┼───────────────────────────────┼──────────┤
│ B: Sandbox Fortress │ F1    │ F1.1 adapter migration          │ F1.2 per-tool profiles        │ no       │
└─────────────────────┴───────┴─────────────────────────────────┴───────────────────────────────┴──────────┘

How to use this file

- Codex updates this file as part of EVERY task PR. Same commit, never a
separate one.
- Before starting a task: add a row in "Currently in flight" with task ID,
branch name, start timestamp.
- On task completion: move the task row from ⏸ to ✅ in its track section,
fill PR + short SHA, remove from "Currently in flight", update Quick
status.
- If blocked mid-task: mark 🔒 with reason, add to "Blocked items".
- Status emojis: ✅ done · 🚧 in flight · ⏸ ready (not started) · 🔒 blocked.

Track A — PURE_DEEPSEEK_PLAN.md

Phase 0: audit

┌───────────────────────────────┬────────┬────────────┬───────────────┬────────────────────────────────────────────────┐
│             Task              │ Status │     PR     │    Commit     │                     Notes                      │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.1 SDK imports inventory    │ ✅     │ #5         │ 9b0b34f       │ 227 entries; .json + .md                       │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.2 Anthropic-only features  │ ✅     │ (squashed) │ 75b5b19       │ 21 scopes                                      │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.2-fix file-level breakdown │ ✅     │ (squashed) │ 156d1d7       │ 71 file rows                                   │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.3 config & env migration   │ ✅     │ (squashed) │ 1b6afcf       │ 1607 rows                                      │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.4 product references       │ ✅     │ #12        │ 37a6cf7       │ 3328 entries                                   │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.5 risk register            │ ✅     │ #13        │ 059c6b7       │ 28 risks                                       │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ P0.6 sign-off                 │ ✅     │ #16        │ bcc1feb       │ 34/34 spot-checks                              │
├───────────────────────────────┼────────┼────────────┼───────────────┼────────────────────────────────────────────────┤
│ Phase 1 decision docs         │ ✅     │ (this PR)  │ (this commit) │ 6 decision docs + audit/README + EXECUTION_LOG │
└───────────────────────────────┴────────┴────────────┴───────────────┴────────────────────────────────────────────────┘

Phase 1: excise Anthropic surfaces

┌───────────────────────────────────────────────────────┬────────┬─────┬────────┬─────────────────────────────────────────────────┐
│                         Task                          │ Status │ PR  │ Commit │                      Notes                      │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.1 delete bridge / Remote Control + LICENSE replace │ ⏸      │ —   │ —      │ unblocked by LICENSE-DECISION.md                │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.2 delete Teleport / Ultraplan / CCR                │ ⏸      │ —   │ —      │ depends on P1.1 stubs                           │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.3 delete Chrome / Desktop / OAuth UI               │ ⏸      │ —   │ —      │ depends on P1.2; docs/deepseek-auth.md ✅       │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.4 config paths ~/.claude → ~/.deepcode             │ ⏸      │ —   │ —      │ depends on P1.3                                 │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.5 CLAUDE.md → DEEPCODE.md memory                   │ ⏸      │ —   │ —      │ depends on P1.4                                 │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.6 remove CLAUDE_CODE_* env reads                   │ ⏸      │ —   │ —      │ depends on P1.4/P1.5                            │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.7 replace voice STT (Whisper.cpp)                  │ ⏸      │ —   │ —      │ docs/voice-stt.md ✅; parallel after P1.3       │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.8 stub @anthropic-ai/sdk types                     │ ⏸      │ —   │ —      │ depends on P1.1–P1.7 callers stable             │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.9 drop @anthropic-ai/sdk from package.json         │ ⏸      │ —   │ —      │ depends on P1.8                                 │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.10 GrowthBook/Statsig + OTel rename                │ ⏸      │ —   │ —      │ OTel + flag snapshot ✅; after P1.9             │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.11 residual cleanup + model alias swap             │ ⏸      │ —   │ —      │ docs/model-alias-deprecation.md ✅; after P1.10 │
├───────────────────────────────────────────────────────┼────────┼─────┼────────┼─────────────────────────────────────────────────┤
│ P1.12 Phase 1 sign-off PR                             │ ⏸      │ —   │ —      │ after P1.1–P1.11                                │
└───────────────────────────────────────────────────────┴────────┴─────┴────────┴─────────────────────────────────────────────────┘

Phases 2–5

Not decomposed yet; refer to PURE_DEEPSEEK_PLAN.md and expand here on
phase entry.

Track B — SANDBOX_FORTRESS_PLAN.md

F0: scaffold

┌────────────────────────────┬────────┬────────────┬─────────┬────────────────────────┐
│            Task            │ Status │     PR     │ Commit  │         Notes          │
├────────────────────────────┼────────┼────────────┼─────────┼────────────────────────┤
│ F0.1 fortress scaffold     │ ✅     │ (squashed) │ 08f6e7b │ manager + types + dirs │
├────────────────────────────┼────────┼────────────┼─────────┼────────────────────────┤
│ F0.2 test harness + bench  │ ✅     │ (squashed) │ 49183cf │ 343-line harness       │
├────────────────────────────┼────────┼────────────┼─────────┼────────────────────────┤
│ F0.3 API contract          │ ✅     │ #14        │ 9d7bee8 │ 745-line contract      │
├────────────────────────────┼────────┼────────────┼─────────┼────────────────────────┤
│ F0.3-fix canonicalize path │ ✅     │ #15        │ 7bb9bfc │ dedup root vs package  │
└────────────────────────────┴────────┴────────────┴─────────┴────────────────────────┘

F1: integrate fortress structure

┌──────────────────────────────────────┬────────┬─────┬─────────┬─────────────────┐
│                 Task                 │ Status │ PR  │ Commit  │      Notes      │
├──────────────────────────────────────┼────────┼─────┼─────────┼─────────────────┤
│ F1.1 migrate adapter into fortress   │ ✅     │ #17 │ cbe57d4 │ git mv + shim   │
├──────────────────────────────────────┼────────┼─────┼─────────┼─────────────────┤
│ F1.2 per-tool sandbox profiles       │ ⏸      │ —   │ —       │ Next ready      │
├──────────────────────────────────────┼────────┼─────┼─────────┼─────────────────┤
│ F1.3 adapter test coverage hardening │ ⏸      │ —   │ —       │ depends on F1.2 │
└──────────────────────────────────────┴────────┴─────┴─────────┴─────────────────┘

F2–F5

Not decomposed yet; refer to SANDBOX_FORTRESS_PLAN.md and expand here on
phase entry.

External decisions

┌──────────────────────────────┬──────────────────────────────────────┬────────────┐
│           Decision           │                 Path                 │   Status   │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ License posture              │ LICENSE-DECISION.md                  │ ✅ this PR │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ DeepSeek auth UX             │ docs/deepseek-auth.md                │ ✅ this PR │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ Model alias deprecation      │ docs/model-alias-deprecation.md      │ ✅ this PR │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ OTel rename                  │ docs/otel-rename.md                  │ ✅ this PR │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ Voice STT replacement        │ docs/voice-stt.md                    │ ✅ this PR │
├──────────────────────────────┼──────────────────────────────────────┼────────────┤
│ sandbox-runtime distribution │ docs/sandbox-runtime-distribution.md │ ✅ this PR │
└──────────────────────────────┴──────────────────────────────────────┴────────────┘

Currently in flight

(none)

Blocked items

(none)

Conventions

- "Squashed" in PR column = merge happened before consistent PR labelling;
the commit is authoritative.
- Commit short SHA = 7 characters. Always cite merge commit, not branch tip.
- "Depends on X" = cannot start until X is ✅.
- "Parallel after X" = can start once X is ✅ but does not need X's output.
- Update this log in the SAME PR/commit as the task it tracks. Never make
log-only commits.
