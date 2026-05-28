# P3 Roadmap — Distribution

## Status

- Date: 2026-05-28
- Entry point: after P2.11 Phase 2 sign-off
- Stable tag entering this phase: `v0.3.0-feature-parity`
- Source plan: `PURE_DEEPSEEK_PLAN.md` L1202+
- Goal: public, installable artifacts for real users
- Expected effort: 1 week
- Recommended first implementation task: P3.1 npm release workflow + pack test

## Executive Summary

Phase 3 is a distribution phase, not a feature phase.

Phase 1 removed Anthropic runtime surfaces and closed at `v0.2.0-pure`.
Phase 2 adopted DeepSeek-TUI competitive features and closed at
`v0.3.0-feature-parity`.

Phase 3 should make the project installable through release channels while
preserving the safety properties established in Phase 1 and the feature
surface established in Phase 2.

The recommended path is:

1. Start with npm because `packages/deep-code/package.json` already declares
   `@deepcode-ai/deep-code` and exposes `deepcode` / `deep-code` bins.
2. Add an explicit release workflow that performs package validation before
   any public publish command.
3. Keep Docker and Homebrew as follow-up PRs after npm packaging is proven.
4. Treat prebuilt binary releases as optional until the npm/Docker distribution
   story is stable.

## Phase A — Phase 3 Inventory

### A1. P3.1 Public Npm Package

Plan reference:

- `PURE_DEEPSEEK_PLAN.md` P3.1
- Branch suggested by plan: `dist/npm-publish`

Current repo state:

- `packages/deep-code/package.json` already exists.
- Package name is `@deepcode-ai/deep-code`.
- Version is currently `0.1.0`.
- `bin` exposes both `deepcode` and `deep-code`.
- `type` is `module`.
- `dependencies` is empty.
- `optionalDependencies` contains platform-specific `sharp` packages.
- `prepublishOnly` blocks direct publishing unless `AUTHORIZED` is set.
- No `.github/workflows/release.yml` exists.
- CI currently has `.github/workflows/ci.yml`.
- Dist bundle exists at `packages/deep-code/dist/deepcode-full.mjs`.
- CLI entry shim exists at `packages/deep-code/deepcode.js`.

Required P3.1 work:

- Confirm `@deepcode-ai` npm org ownership and publish rights.
- Decide whether `private` must be added or remains absent.
- Confirm package metadata is public-release quality.
- Add `npm pack` validation to CI or release workflow.
- Add GitHub Actions release workflow.
- Publish on trusted tag pattern only.
- Use `npm publish --access public --provenance`.
- Avoid local manual publish as the normal path.

Acceptance target:

- `npm pack --dry-run` or equivalent pack inspection succeeds.
- Release workflow file exists and validates.
- Package contents include intended runtime files only.
- No secrets or local artifacts appear in packed output.
- `npm publish --dry-run` succeeds locally or in CI.

### A2. P3.2 Docker Image

Plan reference:

- `PURE_DEEPSEEK_PLAN.md` P3.2
- Branch suggested by plan: `dist/docker`

Plan sketch:

```dockerfile
FROM node:22-slim
COPY packages/deep-code /app
WORKDIR /app
RUN bun install --production
ENTRYPOINT ["node", "dist/deepcode-full.mjs"]
```

Current repo state:

- No root Dockerfile was found during this scan.
- No container release workflow was found.
- Existing CI uses Node 20 and Node 22.
- The runtime bundle is a single `.mjs` file but optional native `sharp`
  dependencies remain relevant.

Required P3.2 work:

- Choose a base image.
- Decide whether Bun is installed inside the image or avoided at runtime.
- Decide whether Docker build uses packed npm artifact or source checkout.
- Add Dockerfile and `.dockerignore`.
- Add a local `docker build` smoke.
- Add multi-arch build strategy for linux/amd64 and linux/arm64.
- Choose registry: GHCR is the lowest-friction default for this repo.
- Publish on tag only.

Acceptance target:

- `docker build .` succeeds.
- Container starts and prints CLI help or version.
- `DEEPSEEK_API_KEY` can be passed through environment.
- No local workspace state is copied into the image.

### A3. P3.3 Homebrew Formula Or Alternative Distribution

Plan reference:

- User instruction frames P3.3 as Homebrew formula or alternative distribution.
- `PURE_DEEPSEEK_PLAN.md` P3.3 frames optional prebuilt binary releases.

This is the main scope mismatch to resolve in Phase 3.

Possible P3.3 paths:

- Homebrew tap that installs npm package or prebuilt binary.
- GitHub Releases with prebuilt binaries built via `bun build --compile`.
- Both, where Homebrew consumes the GitHub Release artifact.

Current repo state:

- No Homebrew tap exists in this repository.
- No binary release workflow exists.
- No `bun build --compile` workflow exists.
- Existing package exposes a Node-based CLI.

Recommended P3.3 position:

- Treat Homebrew and binary releases as a decision after P3.1 and P3.2.
- Prefer an own tap first if Homebrew is required.
- Do not target upstream homebrew-core until public usage and formula stability
  are proven.
- If using Homebrew, prefer installing a versioned GitHub Release artifact over
  running arbitrary build steps in the formula.

Acceptance target:

- Install command works on macOS.
- Versioned artifact checksums are pinned.
- Formula does not require private credentials.
- Upgrade path is documented.

### A4. P3.4 Phase 3 Sign-Off

Plan reference:

- `PURE_DEEPSEEK_PLAN.md` P3.4
- Tag target: `v0.4.0-distributed`

Required P3.4 work:

- Cite all P3 PRs in TODO.md and EXECUTION_LOG.md.
- Confirm npm, Docker, and chosen P3.3 channel are documented.
- Tag `v0.4.0-distributed` after sign-off merge.

## Phase B — Distribution Path Tradeoffs

### B1. Npm Public Release Risk

Benefits:

- Natural fit for a Node-based CLI.
- Existing package layout is close to publishable.
- Users can install with familiar `npm install -g` or `npx` flow.
- GitHub provenance support is well-aligned with npm.

Risks:

- Public package metadata becomes part of the product surface.
- The package name is scoped and requires org ownership.
- Direct publish must stay blocked outside workflow.
- Optional native dependencies can affect install size and platform behavior.
- `files` allowlist must be audited for secrets and unnecessary source.

Mitigations:

- Verify npm org access before writing release automation.
- Use `npm pack --json` and inspect output in CI.
- Keep `prepublishOnly` guard unless release workflow sets an explicit variable.
- Publish only from protected tags.
- Use `--provenance` and least-privilege npm token or trusted publishing.

### B2. License And Policy Risk

Current signal:

- `LICENSE.md` was replaced with AGPL-3.0 during Phase 1.
- `docs/sandbox-runtime-distribution.md` previously warned that public release
  is blocked if private sandbox runtime dependencies remain.
- Current `packages/deep-code/package.json` has no runtime dependency on
  `@anthropic-ai/sandbox-runtime`.

Risks:

- Release branch may reintroduce private runtime references accidentally.
- README/package license text may still be incomplete for public users.
- Vendor and optional dependency license review may be needed.

Mitigations:

- Add a P3.1 checklist item for license metadata.
- Confirm package tarball contains `LICENSE.md`.
- Confirm no private registry packages appear in dependency tree.
- Treat public release notes and README install text as release blockers.

### B3. Docker Base Image Choice

Options:

- `node:22-slim`
- `node:22-bookworm-slim`
- Bun-based image
- Distroless Node image

Recommended starting point:

- Start with `node:22-slim`.

Rationale:

- It matches current CI Node 22 coverage.
- It keeps runtime predictable.
- It avoids adding Bun runtime requirements unless build steps need Bun.
- It is easier to debug than distroless during first container PR.

Risks:

- Slim images may miss native libraries needed by optional dependencies.
- Full images are larger and slower to publish.
- Multi-arch builds can expose architecture-specific optional dependency gaps.

Mitigations:

- Smoke test `deepcode --help` or equivalent in the built image.
- Add an arm64 build job before publishing multi-arch latest.
- Keep image labels and SBOM/provenance as follow-up if initial PR is large.

### B4. Homebrew Formula Choice

Options:

- Own tap under this GitHub org/user.
- Upstream homebrew-core formula.
- Skip Homebrew and publish GitHub Release binaries first.

Recommended starting point:

- Own tap or GitHub Release binary, not homebrew-core.

Rationale:

- Homebrew-core has stricter popularity and maintenance expectations.
- An own tap allows faster iteration.
- A formula can consume npm or a prebuilt binary once the artifact is stable.

Risks:

- Formula checksums must be updated for every release.
- Node-based formula can be less polished than a single binary.
- A separate tap adds another repository and maintenance path.

Mitigations:

- Generate formula from release metadata.
- Prefer pinned, versioned artifacts.
- Add install smoke on macOS before sign-off.

### B5. Release Cadence And Version Strategy

Options:

- Manual version bump.
- Changesets.
- Conventional commits plus automatic changelog.
- Tag-only releases without package version automation.

Recommended starting point:

- Manual version bump for first public release, with a documented checklist.

Rationale:

- Phase 3 is short and distribution-focused.
- Manual bump reduces workflow complexity for the first publish.
- Changesets can be added after first successful public release.

Risk:

- Manual bump can drift from tag names.

Mitigation:

- CI should assert package version matches release tag.

## Phase C — P3.1 Npm Starter Design

### C1. Package Metadata

Audit fields in `packages/deep-code/package.json`:

- `name`
- `version`
- `description`
- `license`
- `homepage`
- `bugs`
- `bin`
- `files`
- `engines`
- `dependencies`
- `optionalDependencies`

Likely required edits:

- Confirm or update `license` from `SEE LICENSE IN README.md` if npm needs a
  clearer SPDX expression.
- Confirm `homepage` and `bugs` should not point only to DeepSeek docs.
- Confirm `README.md` exists inside `packages/deep-code`.
- Confirm `deepcode.js` has correct shebang and executable bit.
- Confirm `dist/deepcode-full.mjs` is current before publish.

### C2. Private Flag

The plan says to set `"private": false`.

Current state:

- `packages/deep-code/package.json` does not contain `"private"`.
- Root `package.json` contains `"private": true`.

Recommendation:

- Do not change root package privacy for P3.1.
- Decide whether adding `"private": false` to the package is useful or noisy.
- If added, limit it to `packages/deep-code/package.json`.

### C3. Release Workflow

Candidate file:

- `.github/workflows/release.yml`

Trigger:

- `push` tags matching `v*`
- Possibly `workflow_dispatch` for dry-run

Core jobs:

1. Checkout repository.
2. Setup Node 22.
3. Install dependencies with `npm ci`.
4. Build full CLI bundle.
5. Run focused package tests.
6. Run `npm pack --json`.
7. Inspect tarball contents.
8. Publish with `npm publish --access public --provenance`.

Security constraints:

- Publish only from protected tags.
- Do not echo npm tokens.
- Prefer npm trusted publishing / OIDC if available.
- Keep direct local publish blocked by `prepublishOnly`.

### C4. Npm Pack And Dry-Run Checks

Recommended checks:

- `npm pack --dry-run` exits 0.
- Packed file list includes `deepcode.js`, `dist/deepcode-full.mjs`,
  `README.md`, `LICENSE.md`, and `package.json`.
- Packed file list excludes `.env`, local sessions, `node_modules`, `.git`,
  unused tests, and scratch artifacts.
- `npm publish --dry-run --access public` succeeds before any real publish.
- Real publish runs only on protected tags.

## Phase D — Sub-PR Breakdown

### P3.scan — Distribution Roadmap

This PR.

Scope:

- Create `P3_ROADMAP.md`.
- No source/test/dist mutations.
- Recommend starting with P3.1.

### P3.1.a — Release Workflow And Npm Pack Test

Scope:

- Add `.github/workflows/release.yml`.
- Add `npm pack` validation.
- Add tarball content assertions.
- Keep publish step disabled or dry-run until credentials/trusted publishing are
  confirmed.

### P3.1.b — First Publish Dry-Run

Scope:

- Run package dry-run path end-to-end.
- Fix package metadata or files allowlist issues.
- Document npm org ownership decision.

Expected output:

- Dry-run evidence.
- Release checklist.
- Any required package metadata corrections.

### P3.1.c — Public Npm Publish

Scope:

- Enable real publish on tag.
- Tag a release candidate or first distribution tag if policy allows.
- Confirm package appears on npm under `@deepcode-ai/deep-code`.

### P3.2 — Docker Image

Scope:

- Add Dockerfile.
- Add `.dockerignore`.
- Add local docker build smoke.
- Add GHCR publish workflow or extend release workflow.

### P3.3 — Homebrew Or Binary Distribution

Decision required before implementation:

- Homebrew own tap.
- GitHub Release prebuilt binaries.
- Homebrew formula consuming GitHub Release binary.

### P3.4 — Phase 3 Sign-Off

Scope:

- Update TODO.md.
- Update EXECUTION_LOG.md.
- Update audit or distribution docs as needed.
- Confirm public install paths.
- Tag `v0.4.0-distributed`.

Estimated Phase 3 size:

- 6-10 sub-PRs.
- More if Homebrew and prebuilt binaries both ship.
- Less if P3.3 defers binary releases and closes on npm + Docker.

## Phase E — Risk Assessment

### E1. Npm Scope Ownership

Risk:

- `@deepcode-ai` org may not exist or may not be controlled by the maintainer.

Mitigation:

- Verify with `npm org ls deepcode-ai` or npm web UI before enabling publish.
- Document the owner account in the release checklist.

### E2. Provenance Signing

Risk:

- `npm publish --provenance` requires supported CI and package settings.

Mitigation:

- Use GitHub Actions OIDC.
- Prefer trusted publishing if available.
- Dry-run the workflow before real publish.

### E3. Reproducible Builds

Risk:

- Dist bundle can drift if source and bundle are not regenerated consistently.

Mitigation:

- Keep Z-style dist refresh pattern.
- Run build twice and compare SHA where bundle generation is involved.
- Avoid publishing from dirty worktrees.

### E4. License Compatibility

Risk:

- Public release could be blocked by license metadata or private dependency
  residue.

Mitigation:

- Confirm AGPL-3.0 posture.
- Confirm package tarball includes license.
- Confirm no private Anthropic runtime package in dependency tree.

### E5. Public Release Coordination

Risk:

- First public package can create a permanent name/version artifact.

Mitigation:

- Use dry-run and release candidate checklist.
- Consider publishing `0.3.0` or `0.3.1` only after package metadata is correct.
- Confirm README install instructions before publish.

## Phase F — Key Decisions

### Q1. Changesets vs Manual Version Bump

Recommendation:

- Manual version bump for first public release.
- Revisit Changesets after first successful npm publish.

Open decision:

- What version should the first public npm package use: `0.3.0`, `0.3.1`, or
  another pre-1.0 version?

### Q2. Npm Only vs Additional Registries

Recommendation:

- Start with npm only.
- Defer JSR unless a concrete runtime/user need appears.

Open decision:

- Is `@deepcode-ai/deep-code` the only package identity for Phase 3?

### Q3. Docker Registry

Recommendation:

- Use GitHub Container Registry first.

Open decision:

- Should Docker Hub be added in Phase 3 or deferred?

### Q4. Homebrew Strategy

Recommendation:

- Use own tap if Homebrew ships in Phase 3.
- Do not target homebrew-core for first release.

Open decision:

- Should Homebrew consume npm package, Docker image, or GitHub Release binary?

### Q5. Release Cadence

Recommendation:

- On-demand releases during Phase 3.
- Move to weekly or bi-weekly only after distribution workflows are stable.

Open decision:

- Who approves release tags and which branch/tag protections are required?

## Phase G — Recommended Starting Point

Start with P3.1.a.

Why:

- It is the smallest distribution step.
- It validates the existing npm package shape without real publish risk.
- It creates the foundation for both npm publish and downstream Docker/Homebrew
  artifacts.
- It can expose package metadata issues before public artifacts exist.
