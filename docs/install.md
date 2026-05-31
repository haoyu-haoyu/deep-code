# DeepCode Install

DeepCode distribution supports Docker and pre-built single-file binaries. The
npm package path is prepared but deferred until the `@deepcode-ai` npm scope and
publishing strategy are confirmed.

## Pre-built binaries

Single-file binaries are published to GitHub Releases on each `v*` tag, built
with `bun --compile` from a self-contained bundle (no runtime dependencies).

```bash
# Pick your platform: deepcode-linux-x64, deepcode-darwin-x64, deepcode-darwin-arm64
curl -fsSL https://github.com/haoyu-haoyu/deep-code/releases/latest/download/deepcode-darwin-arm64 -o deepcode
chmod +x deepcode
./deepcode --version

# Verify the download against the published manifest (optional)
curl -fsSL https://github.com/haoyu-haoyu/deep-code/releases/latest/download/SHA256SUMS -o SHA256SUMS
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Linux on arm64 and Windows are not published as binaries (no stable
`bun --compile` target); use Docker there. Build locally with
`npm run build:binaries --workspace @deepcode-ai/deep-code` (see
`.github/workflows/release.yml`).

The binary is fully self-contained, so optional native add-ons are not
included: features that depend on them (e.g. image processing via `sharp`)
degrade gracefully — use the npm or Docker install if you need them. Core
agent, tools, and DeepSeek model access work without them.

## Docker (multi-arch: linux/amd64 + linux/arm64)

```bash
# Auto-selects matching platform
docker pull ghcr.io/haoyu-haoyu/deepcode:latest
docker run -v "$(pwd)":/workspace ghcr.io/haoyu-haoyu/deepcode:latest --help
```

Use the current directory mount when running DeepCode against a workspace:

```bash
docker run -it -v "$(pwd)":/workspace ghcr.io/haoyu-haoyu/deepcode:latest

# Explicit platform (optional)
docker pull --platform linux/arm64 ghcr.io/haoyu-haoyu/deepcode:latest
```

## npm

The package metadata and release checklist are prepared, but npm publish remains
deferred pending user confirmation of npm scope ownership and publishing mode.

```bash
# Deferred until P3.1.c
npm install -g @deepcode-ai/deep-code
```
