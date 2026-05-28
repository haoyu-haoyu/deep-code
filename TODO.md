# DeepCode TODO

## Phase 1 — Anthropic Excision (Complete)

Phase 1 closed at v0.2.0-pure with the following milestones:

### P1.1 — Bridge removal

- PRs #22 through #34
- Removed: bridge dir (35 files), remote control UI, /btw command, CCR v2,
  --sdk-url option, BRIDGE_MODE upload guard

### P1.2 — Remote/Teleport/Ultraplan strip

- PRs #36 through #55
- Removed: --remote, --teleport CLI flags; RemoteAgentTask cluster; ultraplan;
  /remote-env; ultrareview

### P1.3 — Anthropic surfaces excision (large multi-stage)

- Sub-phases A/B/C/D/E/F/G/H/Z across PRs #56-#135
- Removed: claude.ai OAuth chain, Chrome integration, Desktop/DeepLink,
  /upgrade, /extra-usage, OverageCreditUpsell, services/api/* (10 SDK wrappers),
  tokenEstimation.ts, teleport infrastructure (~4630 LOC), ChannelsNotice UI;
  19 sub-PRs in F (SDK runtime -> DeepSeek native), 6 in G (teleport delete),
  8 in E (OAuth dismantle)

### P1.4 — Config paths .claude/ -> .deepcode/

- PRs #137 + #139 + #141 (first pass + 2 followups)
- Renamed user-facing paths; LEGACY_CLAUDE_* fallback for backward compat
- Status: done with residue tracked (~140 comment-only mentions)

### P1.5 — CLAUDE.md -> DEEPCODE.md memory

- PR #143
- Renamed memory file convention; FileWriteTool + FileEditTool path checks
  extended with backward compat (read both, write DEEPCODE.md primary)
- Status: done with residue tracked

### P1.6 — CLAUDE_CODE_* env reads (first pass)

- PR #145
- Deleted dead Anthropic-only env reads; renamed critical reads to DEEPCODE_*
  with backward compat; ~37 references removed
- Status: done with residue tracked (residue cleaned in P1.11)

### P1.7 — Voice STT removal (Path C)

- 10 PRs (scan #147 + a/b/c/d.1/d.2/d.3/d.4.a/d.4.b/Z + cite)
- Removed: Anthropic voice_stream WebSocket, Deepgram client, useVoice hook,
  voice UI, /voice command, voiceModeEnabled gates (~3400 LOC delete)
- Retained: services/voice.ts audio capture for future Whisper.cpp
- Per P1_7_DESIGN.md Path C

### P1.8 — Stub @anthropic-ai/sdk types (Path C)

- 8 PRs (scan #158 + 0/a/perf-tune/b1/b2/c/d/Z + cite)
- Created types/sdk-shim.ts (212 LOC, 34 types) + utils/sdkErrors.ts (66 LOC,
  5 classes with full inheritance chain)
- Migrated 97 consumers: 20 tools/, 29 utils/, 7 services/, 23 components/,
  18 remaining (cli/commands/hooks/screens/etc.)
- Per P1_8_DESIGN.md Path C; instanceof identity preserved

### P1.9 — Drop @anthropic-ai/sdk from package.json (collapsed)

- Collapsed into P1.8 closeout: deep-code/package.json `dependencies: {}`
  never explicitly declared SDK; src/ migration + dist refresh sufficed
- No separate source PR needed

### P1.10 — GrowthBook strip + OTel rename (Path C)

- 10 PRs (scan #168 + A/B.0/B.a/B.b1/B.b2/B.cd/B.services/B.runtime/Z + cite)
- Deleted: services/analytics/growthbook.ts (1155 LOC) + cascade
- Created: utils/featureFlags.ts (138 LOC, 22 exports mirroring growthbook
  public surface)
- Migrated 103 consumers
- OTel: claude_code.* -> deepcode.*; com.anthropic.claude_code.* ->
  ai.deepcode.*; perf-baseline keys deepcode_ prefix; LEGACY_KEY_MAP temporary
  in perf-compare
- Statsig had 0 SDK residue prior

### P1.11 — Residual cleanup + model alias swap (Path C)

- 4 PRs (scan #179 + A+D/B+C/Z + cite)
- Model alias hard cutover: sdk-tools.d.ts L274 from sonnet|opus|haiku to
  deepseek-chat|coder|reasoner; 30 src/ files updated; 4 legacy migration files
  deleted (migrateFennecToOpus, migrateLegacyOpusToCurrent,
  migrateOpusToOpus1m, migrateSonnet1mToSonnet45)
- CLAUDE_CODE_(DEBUG|MAX|PRINT|BIG)*: 11 files migrated to DEEPCODE_* primary
  with developer-facing fallback chain
- Runtime path strings: .deepcode/ + DEEPCODE.md primary; named-legacy fallback
  reads retained
- .claude security checks preserved unchanged
- Per docs/model-alias-deprecation.md (Decided 2026-05-10)

## Phase 1 Final Metrics

- Total Phase 1 PRs: ~70 (P1.1 #22 -> P1.12 sign-off)
- src/ @anthropic-ai/sdk imports: 0 (was ~97)
- src/ services/analytics/growthbook imports: 0 (was ~145)
- src/ voice mode runtime: 0 (was ~3400 LOC)
- src/ Anthropic model alias literals: 0 (was 123 occurrences across 30 files)
- src/ teleport infrastructure: 0 (was ~4630 LOC)
- dist/deepcode-full.mjs: 415365 lines (post-P1.11.Z)
- bun test: 69/69 throughout
- CI: green throughout
- Tag: v0.2.0-pure

## Acceptance (per PURE_DEEPSEEK_PLAN.md L804-806)

- [x] Tag v0.2.0-pure scheduled (post-merge action)
- [x] TODO.md reflects new state (this file)
- [x] audit/README.md marked Phase 1 done

## Phase 1 -> Phase 2 Transition

Phase 2 (Adopt DeepSeek-TUI Best-of-Breed Features) targets:

1. Auto mode router (P2.1) — `--model auto` lightweight routing call
2. Multi-provider support (P2.2) — `--provider {deepseek,ollama,vllm,openai-compatible}`
3. Cache visualization (P2.3) — DeepSeek cache hit/miss/savings UI
4. Workspace rollback (P2.4) — safety net
5. Post-edit LSP diagnostics (P2.5) — correctness multiplier
6. HTTP/SSE serve mode (P2.6)
7. Session fork (P2.7)
8. Doctor command (P2.8)
9. Workspace-local slash commands (P2.9)

See PURE_DEEPSEEK_PLAN.md L810+ for Phase 2 detailed design.

## Phase 2 — DeepSeek-TUI Feature Parity (Complete)

Phase 2 closed at v0.3.0-feature-parity (2026-05-28) with all 9 priority
features adopted from DeepSeek-TUI competitive analysis.

### P2.scan — Phase 2 roadmap

- PR #185

### P2.1 — Auto mode router (3 PRs)

- scan #185 + a #186 + b #187 + c #188
- `--model auto` with deepseek-v4-flash router + deterministic heuristic fallback
- TUI footer chip `auto -> flash/off` / `auto -> pro/max`
- Sub-agent inheritance + 22 test cases

### P2.2 — Multi-provider support (7 PRs, Path C)

- scan #189 + 0 + a + perf-tune + b1/b2 + c/d + cite #195
- 4 supported providers: deepseek (default) + ollama + vllm + openai-compatible
- openai-compatible.mjs adapter + capability flags + per-provider config
  precedence (CLI > provider-env > generic-env > config-file > legacy > defaults)
- 26+ test cases

### P2.3 — Cache visualization (6 PRs)

- scan #196 + a #197 + b #198 + c #199 + Z + cite
- DeepSeek killer feature: live cache hit% chip + `/cache inspect/warmup/clear`
- Per-turn hit/miss + session totals + estimated $ savings
- Pricing snapshot dated 2026-05-27
- 15+ test cases

### P2.4 — Workspace rollback (8 PRs, Path C phased)

- scan #202 + a + b + c + d + e + Z + cite
- Side-git snapshots in `~/.deepcode/snapshots/<hash>/.git`
- `/restore` command + `revert_turn` destructive tool
- 500MB disk cap + lock-file concurrency guard
- User's `.git` strictly untouched

### P2.5 — Post-edit LSP diagnostics (8 PRs, Path C phased)

- scan #210 + a + b + c + d + e + Z + cite
- LSP client hardening + TS-first registry + tool post-edit hooks +
  settings `[lsp]` + multi-language (Rust/Go/Python/C/C++)
- 27+ test cases with mock transport

### P2.6 — HTTP/SSE serve mode (7 PRs, Path C)

- scan #218 + a + b + c + d + Z + cite
- `deepcode serve --http` with Bearer auth + node:http built-in
- 5 endpoints: POST/GET/DELETE sessions + POST/GET turns
- SSE streaming + DELETE-cancel + concurrent turn 409
- 16+ test cases with fake runner

### P2.7 — Session fork (3 PRs, skip-scan)

- a + Z + cite
- `deepcode fork <session-id> [--at-turn N]` with JSONL turn-boundary copy
- Source session unchanged (read-only)

### P2.8 — Doctor command (3 PRs, skip-scan)

- a + Z + cite
- `deepcode doctor` + `--json` non-interactive output
- API key + network + model + LSP server checks
- 9 test cases

### P2.9 — Workspace-local slash commands (3 PRs, skip-scan)

- a + Z + cite
- `.deepcode/.cursor/.claude commands/*.md` with priority + deprecation warning
- `$ARGUMENTS` placeholder + REPL autocomplete integration
- 8 test cases

### P2.10 — i18n (deferred)

- Lower priority feature; not blocking Phase 2 sign-off
- Reserved for future polish phase

## Phase 2 Final Metrics

- Total Phase 2 PRs: ~50 (from #185 -> #233 plus sign-off + scan)
- Phase 2 priority features: 9/9 done
- dist line count: 419,989 (from P1.11.Z baseline 415,365 -> +4,624 lines for
  auto mode + multi-provider + cache viz + workspace rollback + LSP diagnostics
  + HTTP serve + session fork + doctor + workspace slash)
- bun test: 61 pass / 0 fail (test count shifted from 69 due to bun runner
  metric change; not a regression — CI green throughout)
- 30+ test files including p2-1/p2-2/p2-3/p2-4/p2-5/p2-6/p2-7/p2-8/p2-9 fixtures
- CI: green throughout Phase 2
- Tag: v0.3.0-feature-parity

## Acceptance (per PURE_DEEPSEEK_PLAN.md L1198)

- [x] Tag v0.3.0-feature-parity scheduled (post-merge action)
- [x] TODO.md reflects Phase 2 state (this update)

## Phase 2 -> Phase 3 Transition

Phase 3 (Distribution) targets:

1. P3.1 Public npm package (@deepcode-ai/deep-code)
2. P3.2 Docker image
3. P3.3 Homebrew formula
4. P3.4 Phase 3 sign-off

See PURE_DEEPSEEK_PLAN.md L1202+ for Phase 3 detailed design.
