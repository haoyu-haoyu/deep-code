@anthropic-ai/sandbox-runtime distribution posture

Status: Decided
Decision date: 2026-05-10

Summary

The @anthropic-ai/sandbox-runtime dependency is acceptable for self-use
only. Public distribution is forbidden until the dependency is removed or
replaced.

Current state

- DeepCode depends on @anthropic-ai/sandbox-runtime (closed-source npm
package, Anthropic-owned).
- Track B (Sandbox Fortress) wraps it as a black-box library.
- Source code does not copy or modify the dependency's internals, but the repo
currently has tracked files under
`packages/deep-code/node_modules/@anthropic-ai/sandbox-runtime/`, and the
committed full CLI bundle under `packages/deep-code/dist/` may include bundled
runtime code. Treat both the tracked node_modules copy and bundled dist output
as vendored for any distribution review.

Distribution policy

- Allowed: self-use installation from local checkout.
- Allowed: internal mirror or private registry use by the project owner.
- Forbidden: publishing the DeepCode package to public npm while the
dependency is present.
- Forbidden: distributing pre-built binaries to third parties.

What unblocks public distribution

If the policy in LICENSE-DECISION.md ever changes to allow public release,
all of the following must happen before any publish step:

1. Remove the tracked
   `packages/deep-code/node_modules/@anthropic-ai/sandbox-runtime/` copy.
2. Remove @anthropic-ai/sandbox-runtime from package.json dependencies if a
   future package manifest adds it.
3. Remove any bundled @anthropic-ai/sandbox-runtime code from committed dist
   output and rebuilt packages.
4. Replace the Layer 1 black-box with one of:
  - Reimplement seccomp / sandbox-exec wrappers from scratch in
@deepcode-ai/sandbox.
  - Make sandbox-runtime an optional peer dependency that the user
installs separately.
5. Verify:
  - `test ! -e packages/deep-code/node_modules/@anthropic-ai/sandbox-runtime`.
  - `! rg "node_modules/@anthropic-ai/sandbox-runtime|sandbox-runtime/dist/" packages/deep-code/src packages/deep-code/node_modules packages/deep-code/dist` succeeds for public-release artifacts.
  - If the original reimplementation path is chosen, no bare
    `@anthropic-ai/sandbox-runtime` imports remain anywhere in shipped source or
    bundle output. If the optional-peer path is chosen, bare imports may remain,
    but only as external peer imports; the bundle must not include copied
    sandbox-runtime implementation code.
  - `packages/deep-code/package*.json` contains no bundled/runtime dependency
    entry for `@anthropic-ai/sandbox-runtime` under `dependencies`,
    `optionalDependencies`, `devDependencies`, or bundled dependency lists. A
    `peerDependencies` entry is allowed only for the optional-peer path and
    must be paired with `peerDependenciesMeta["@anthropic-ai/sandbox-runtime"].optional = true`.
  - No package tarball includes bundled sandbox-runtime files.
6. Resolve the upstream Claude Code derivative-work question (see
LICENSE-DECISION.md "Distribution restriction" section).

Track B (Fortress) implications

- F1.1 (already merged): adapter migration — does not change dependency
posture.
- F2.1 (hardened adapter): may extend the wrapper, must NOT vendor
sandbox-runtime internals.
- F5.x (DeepSeek-native layer): may eventually replace sandbox-runtime
with original code; that would unblock distribution.

Phase 1 unblock

This decision does not block any P1 task for self-use.

It only blocks any future public-release branch or tag. If a release is
ever attempted under current policy, add a RELEASE_BLOCKED.md file to the
repo root with the reason.
