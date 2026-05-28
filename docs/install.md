# DeepCode Install

DeepCode distribution currently supports Docker. The npm package path is
prepared but deferred until the `@deepcode-ai` npm scope and publishing
strategy are confirmed.

## Pre-built binaries (deferred)

P3.3 binary distribution is currently deferred pending build pipeline
restructure. See `.github/workflows/release.yml` deferred section for details.
Use Docker or npm (when available) instead.

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
