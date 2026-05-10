# @anthropic-ai/sandbox-runtime distribution posture

Status: Decided
Decision date: 2026-05-10

## Summary

The `@anthropic-ai/sandbox-runtime` dependency is acceptable for **self-use
only**. Public distribution is forbidden until the dependency is removed or
replaced.

## Current state

- DeepCode depends on `@anthropic-ai/sandbox-runtime` (closed-source npm
  package, Anthropic-owned).
- Track B (Sandbox Fortress) wraps it as a black-box library.
- The wrapper does not vendor, copy, or modify the dependency's internals.

## Distribution policy

- Allowed: self-use installation from local checkout.
- Allowed: internal mirror or private registry use by the project owner.
- Forbidden: publishing the DeepCode package to public npm while the
  dependency is present.
- Forbidden: distributing pre-built binaries to third parties.

## What unblocks public distribution

If the policy in `LICENSE-DECISION.md` ever changes to allow public release,
**all** of the following must happen before any publish step:

1. Remove `@anthropic-ai/sandbox-runtime` from `package.json` dependencies.
2. Replace the Layer 1 black-box with one of:
   - Reimplement seccomp / sandbox-exec wrappers from scratch in
     `@deepcode-ai/sandbox`.
   - Make sandbox-runtime an **optional peer dependency** that the user
     installs separately.
3. Resolve the upstream Claude Code derivative-work question (see
   `LICENSE-DECISION.md` "Distribution restriction" section).

## Track B (Fortress) implications

- F1.1 (already merged): adapter migration. Does not change dependency
  posture.
- F2.1 (hardened adapter): may extend the wrapper, must NOT vendor
  sandbox-runtime internals.
- F5.x (DeepSeek-native layer): may eventually replace sandbox-runtime
  with original code; that would unblock distribution.

## Phase 1 unblock

This decision **does not block any P1 task** for self-use.

It only blocks any future public-release branch or tag. If a release is
ever attempted under current policy, add a `RELEASE_BLOCKED.md` file to the
repo root with the reason.
