# DeepCode Sandbox Fortress

DeepCode Sandbox is the Fortress extension layer for the DeepCode terminal
coding agent. It keeps the operating-system sandbox implementation in
`@anthropic-ai/sandbox-runtime` as a black-box library and adds DeepCode-owned
policy, observability, and DeepSeek-native behavior above the existing adapter.

## Architecture

```text
@deepcode-ai/sandbox
  Layer 5: DeepSeek-native feedback, effort coupling, and cache-aware summaries
  Layer 4: Observability, violation persistence, dry-run, replay, and stats
  Layer 3: Four-layer rule engine: BuiltinDefault < Org < Agent < User
  Layer 2: Hardened adapter and per-tool sandbox profiles
  Layer 1: @anthropic-ai/sandbox-runtime as an external OS-sandbox library
```

## Package Boundary

The public API starts at `src/sandbox-fortress/index.ts`. Consumers should use
`FortressSandboxManager` and the exported Fortress types instead of importing
from implementation subdirectories.

## Current Scope

`FortressSandboxManager` is live and enforcing — it is the production sandbox
manager, not a stub. The implemented layers:

- **Rule engine (Layer 3):** a four-layer ruleset (BuiltinDefault < Org < Agent
  < User) with deny-first, specificity-ranked conflict resolution over the
  `fs-read`, `fs-write`, `net-host`, and `process-exec` resources.
- **Enforcement:** `fs-write` (projected into the OS sandbox for Bash and
  enforced by the file tools), `fs-read` (file-tool hook plus a paranoid Bash
  read floor), and `process-exec` (Bash command gate). `net-host` rules are
  parsed and resolvable but enforced by no sandbox layer; `deepcode doctor`
  surfaces them as parsed-but-inert.
- **Observability (Layer 4):** dry-run mode and a violation log
  (`observability/violationLog.mjs`).
- **DeepSeek-native (Layer 5):** effort → strictness coupling, a model-facing
  violation-feedback string, and a cache-friendly config summary that keeps the
  default request's stable prefix byte-identical.

Configuration is driven from `settings.fortress` via
`adapter/fortressConfigLoader.ts`; with no fortress block the manager is
default-inert and behaves like the base sandbox.

## Directory Map

- `adapter/`: hardened adapter integration, per-tool sandbox profiles, the
  per-resource decision points (file-tool / Bash-read / process-exec), and the
  `settings.fortress` config loader.
- `rule-engine/`: the layered ruleset model, conflict resolution, effort
  coupling, manager state, and the OS-projection of fs rules.
- `observability/`: the violation log and dry-run support.
- `deepseek/`: reserved for future DeepSeek-native modules; the effort coupling,
  violation feedback, and cache-summary features currently live in the rule
  engine and manager state.
