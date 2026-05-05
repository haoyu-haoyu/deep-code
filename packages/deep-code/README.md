# Deep Code

![](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square) [![npm]](https://www.npmjs.com/package/@deepcode-ai/deep-code)

[npm]: https://img.shields.io/npm/v/@deepcode-ai/deep-code.svg?style=flat-square

Deep Code is a DeepSeek-native terminal coding assistant. It keeps the mature terminal UI, local tools, permissions, sessions, skills, and subagent workflows while routing the default model path through DeepSeek native chat completions, reasoning content, tool calls, and context cache telemetry.

## Get Started

1. Install Deep Code:

```sh
npm install -g @deepcode-ai/deep-code
```

2. Navigate to your project directory and run `deepcode`.

## DeepSeek Defaults

- Main model: `deepseek-v4-pro`
- Small model: `deepseek-v4-flash`
- Thinking: enabled
- Reasoning effort: max
- Config directory: `~/.deepcode`

## Diagnostics

Use these commands to verify a local install:

```sh
deepcode --doctor
deepcode --status
deepcode --tool-e2e
```

## Configuration

Deep Code reads DeepSeek settings from environment variables or `~/.deepcode/settings.json`:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_SMALL_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=enabled
DEEPSEEK_REASONING_EFFORT=max
```
