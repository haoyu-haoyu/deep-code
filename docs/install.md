# DeepCode Install

DeepCode distribution currently supports GitHub Release binaries and Docker.
The npm package path is prepared but deferred until the `@deepcode-ai` npm scope
and publishing strategy are confirmed.

## GitHub Release Binaries

Download the binary for your platform from the latest GitHub Release, install it
on your PATH, and mark it executable.

### macOS Apple Silicon

```bash
curl -L https://github.com/haoyu-haoyu/deep-code/releases/latest/download/deepcode-darwin-arm64 -o /usr/local/bin/deepcode
chmod +x /usr/local/bin/deepcode
deepcode --help
```

### macOS Intel

```bash
curl -L https://github.com/haoyu-haoyu/deep-code/releases/latest/download/deepcode-darwin-x64 -o /usr/local/bin/deepcode
chmod +x /usr/local/bin/deepcode
deepcode --help
```

### Linux x64

```bash
curl -L https://github.com/haoyu-haoyu/deep-code/releases/latest/download/deepcode-linux-x64 -o /usr/local/bin/deepcode
chmod +x /usr/local/bin/deepcode
deepcode --help
```

Windows binaries are deferred until the Bun compile target is stable enough for
this release path.

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
