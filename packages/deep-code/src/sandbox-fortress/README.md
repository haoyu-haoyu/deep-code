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

F0.1 establishes the directory tree and type contract only. Fortress-specific
methods intentionally throw a not-implemented error until later plan tasks add
the adapter, rule engine, observability store, and DeepSeek-native features.

## Directory Map

- `adapter/`: F1 hardened adapter integration
- `rule-engine/`: F2 layered ruleset model and conflict resolution
- `observability/`: F3 violation database, stats, dry-run, and replay
- `deepseek/`: F4 effort coupling, context feedback, and cache summaries
