# Deep Code Claude-Like TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code-like terminal interaction experience for Deep Code while keeping the runtime DeepSeek-native and avoiding the legacy Anthropic setup/OAuth path.

**Architecture:** Keep the default `deepcode` entrypoint on the stable DeepSeek-native path in `packages/deep-code/deepcode.js`. Add a focused terminal UI layer under `packages/deep-code/src/deepcode/` for welcome rendering, prompt rendering, command dispatch, status footer, message transcript, and streaming output. The old full Ink TUI remains opt-in behind `DEEPCODE_EXPERIMENTAL_FULL_TUI=1` until its setup/auth path is fully DeepSeek-native.

**Tech Stack:** Node.js ESM, ANSI terminal rendering, existing DeepSeek provider modules, existing cache/status/harness adapters, Node test runner, Bun TUI tests.

---

## File Structure

- Modify: `packages/deep-code/deepcode.js`
  - Keep it as the front controller.
  - Route default no-argument interactive sessions to the DeepSeek-native terminal UI.
  - Preserve `-p`, diagnostic commands, real E2E commands, and full TUI opt-in behavior.

- Modify: `packages/deep-code/src/deepcode/welcome.mjs`
  - Keep the welcome panel renderer, but make it more layout-stable and closer to Claude Code's first screen.
  - Use DeepSeek blue tokens and never Claude orange.

- Create: `packages/deep-code/src/deepcode/terminal-theme.mjs`
  - Own ANSI color tokens and helper functions.
  - Provide `stripAnsi`, `visibleLength`, `truncateVisible`, `padVisible`, and `boxLine`.

- Create: `packages/deep-code/src/deepcode/interactive-ui.mjs`
  - Own the interactive readline loop.
  - Render prompts, command output, assistant streaming, command help, and footer.
  - Keep API/tool execution delegated to existing DeepSeek modules.

- Create: `packages/deep-code/src/deepcode/interactive-commands.mjs`
  - Dispatch `/status`, `/model`, `/doctor`, `/harness`, `/help`, `/clear`, `/exit`, `/compact`.
  - Return structured command results so rendering stays separate from command logic.

- Create: `packages/deep-code/src/deepcode/recent-activity.mjs`
  - Read cache/session metadata and generate welcome panel recent activity rows.
  - Avoid reading or writing legacy Claude global files unless explicitly using existing legacy fallback adapters.

- Modify: `packages/deep-code/test/deepcode-package.test.mjs`
  - Expand startup and interaction smoke coverage.

- Modify: `packages/deep-code/test/deepcode-native.test.mjs`
  - Add unit tests for theme helpers, command dispatch, recent activity, and welcome layout.

- Optional later: `packages/deep-code/test/tui-deepseek.test.mjs`
  - Add bridge tests once the lightweight terminal UI is stable enough to share query path assertions.

---

## Task 1: Extract Stable Terminal Theme Utilities

**Files:**
- Create: `packages/deep-code/src/deepcode/terminal-theme.mjs`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`

- [ ] **Step 1: Write failing tests**

Add imports near the existing Deep Code imports in `packages/deep-code/test/deepcode-native.test.mjs`:

```js
import {
  boxLine,
  deepCodeTheme,
  padVisible,
  stripAnsi,
  truncateVisible,
  visibleLength,
} from '../src/deepcode/terminal-theme.mjs'
```

Add tests near the existing Deep Code status/cache tests:

```js
test('Deep Code terminal theme uses DeepSeek blue and visible-width helpers', () => {
  assert.equal(deepCodeTheme.primary, '\x1b[38;2;77;107;254m')
  assert.equal(deepCodeTheme.shimmer, '\x1b[38;2;121;150;255m')

  const colored = `${deepCodeTheme.primary}Deep Code\x1b[0m`
  assert.equal(stripAnsi(colored), 'Deep Code')
  assert.equal(visibleLength(colored), 9)
  assert.equal(padVisible(colored, 12), `${colored}   `)
  assert.equal(truncateVisible('deepseek-v4-pro', 10), 'deepsee...')
})

test('Deep Code terminal boxLine preserves fixed visible width', () => {
  const line = boxLine({
    left: `${deepCodeTheme.shimmer}Welcome\x1b[0m`,
    right: 'Tips',
    leftWidth: 10,
    rightWidth: 8,
    color: false,
  })
  assert.equal(line, '| Welcome    | Tips     |')
  assert.equal(visibleLength(line), 24)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: FAIL with module not found for `terminal-theme.mjs`.

- [ ] **Step 3: Implement terminal theme utilities**

Create `packages/deep-code/src/deepcode/terminal-theme.mjs`:

```js
export const deepCodeTheme = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  primary: '\x1b[38;2;77;107;254m',
  shimmer: '\x1b[38;2;121;150;255m',
  muted: '\x1b[38;2;150;160;180m',
  success: '\x1b[38;2;80;200;120m',
  warning: '\x1b[38;2;230;190;90m',
  error: '\x1b[38;2;255;100;120m',
}

export function colorize(text, style, enabled = process.stdout.isTTY) {
  if (!enabled) return String(text ?? '')
  const prefix = deepCodeTheme[style]
  return prefix ? `${prefix}${text}${deepCodeTheme.reset}` : String(text ?? '')
}

export function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

export function visibleLength(value) {
  return stripAnsi(value).length
}

export function truncateVisible(value, width) {
  const text = stripAnsi(value)
  if (text.length <= width) return String(value ?? '')
  if (width <= 3) return '.'.repeat(Math.max(0, width))
  return `${text.slice(0, width - 3)}...`
}

export function padVisible(value, width) {
  const content = truncateVisible(value, width)
  const padding = Math.max(0, width - visibleLength(content))
  return `${content}${' '.repeat(padding)}`
}

export function boxLine({
  left = '',
  right = '',
  leftWidth,
  rightWidth,
  color = process.stdout.isTTY,
} = {}) {
  const border = colorize('|', 'primary', color)
  return [
    border,
    ` ${padVisible(left, leftWidth)} `,
    border,
    ` ${padVisible(right, rightWidth)} `,
    border,
  ].join('')
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/deep-code/src/deepcode/terminal-theme.mjs packages/deep-code/test/deepcode-native.test.mjs
git commit -m "feat: add Deep Code terminal theme utilities"
```

---

## Task 2: Refactor Welcome Screen Onto Theme Utilities

**Files:**
- Modify: `packages/deep-code/src/deepcode/welcome.mjs`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`
- Test: `packages/deep-code/test/deepcode-package.test.mjs`

- [ ] **Step 1: Write failing welcome layout tests**

Add this import in `packages/deep-code/test/deepcode-native.test.mjs`:

```js
import { formatDeepCodeWelcome } from '../src/deepcode/welcome.mjs'
```

Add this test:

```js
test('formatDeepCodeWelcome renders a Claude Code-like DeepSeek blue welcome panel', () => {
  const output = formatDeepCodeWelcome({
    version: '0.1.0-test',
    cwd: '/Users/wanghaoyu/Downloads/deepcode源码',
    columns: 100,
    color: false,
    env: {
      USER: 'wanghaoyu',
      HOME: '/Users/wanghaoyu',
    },
    report: {
      apiKeyConfigured: true,
      config: {
        model: 'deepseek-v4-pro',
        smallModel: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      },
      contextPolicy: {
        supportsOneMillionContext: true,
        contextWindowTokens: 1_000_000,
      },
      harnessConfig: {
        mode: 'auto',
      },
      cacheStats: {
        lastPromptCacheHitTokens: 1280,
        lastPromptCacheMissTokens: 94,
        lastPromptCacheHitRate: 0.932,
      },
    },
  })

  assert.match(output, /Deep Code v0\.1\.0-test/)
  assert.match(output, /Welcome back wanghaoyu!/)
  assert.match(output, /Tips for getting started/)
  assert.match(output, /Recent activity/)
  assert.match(output, /deepseek-v4-pro \(1M context\)/)
  assert.match(output, /Cache last hit 1280, miss 94, rate 93\.2%/)
  assert.match(output, /Try "how does <filepath> work\?"/)
  assert.match(output, /deepcode源码/)
  assert.doesNotMatch(output, /Claude|Anthropic/)
})
```

- [ ] **Step 2: Run tests and verify failure or current gaps**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected before refactor: may pass partially, but should fail if welcome does not import shared helpers or exact copy differs. If it passes, keep the test and continue with refactor.

- [ ] **Step 3: Refactor `welcome.mjs`**

Replace local ANSI constants and helper duplicates with imports:

```js
import {
  boxLine,
  colorize,
  deepCodeTheme,
  padVisible,
  stripAnsi,
} from './terminal-theme.mjs'
```

Keep `formatDeepCodeWelcome()` as the public function. Replace local `row()` implementation with:

```js
function row(left, right, leftWidth, rightWidth, color) {
  return boxLine({ left, right, leftWidth, rightWidth, color })
}
```

Replace calls to `c(text, style, enabled)` with `colorize(text, style, enabled)`, using style names:

```js
colorize('Tips for getting started', 'shimmer', color)
colorize(`Welcome back ${userLabel}!`, 'shimmer', color)
colorize('|', 'primary', color)
```

Remove duplicated `stripAnsi`, `padVisible`, and local color constants from `welcome.mjs`.

- [ ] **Step 4: Run package startup test**

Run:

```bash
node --test packages/deep-code/test/deepcode-package.test.mjs
```

Expected: PASS, including `Deep Code front controller starts the stable native interactive session by default`.

- [ ] **Step 5: Commit**

```bash
git add packages/deep-code/src/deepcode/welcome.mjs packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
git commit -m "refactor: stabilize Deep Code welcome layout"
```

---

## Task 3: Add Command Dispatcher For Slash Commands

**Files:**
- Create: `packages/deep-code/src/deepcode/interactive-commands.mjs`
- Modify: `packages/deep-code/deepcode.js`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`

- [ ] **Step 1: Write failing dispatcher tests**

Add import:

```js
import {
  dispatchDeepCodeInteractiveCommand,
  isDeepCodeInteractiveCommand,
} from '../src/deepcode/interactive-commands.mjs'
```

Add tests:

```js
test('Deep Code interactive command dispatcher recognizes built-in slash commands', () => {
  assert.equal(isDeepCodeInteractiveCommand('/status'), true)
  assert.equal(isDeepCodeInteractiveCommand('/model'), true)
  assert.equal(isDeepCodeInteractiveCommand('/doctor'), true)
  assert.equal(isDeepCodeInteractiveCommand('/harness'), true)
  assert.equal(isDeepCodeInteractiveCommand('/help'), true)
  assert.equal(isDeepCodeInteractiveCommand('/clear'), true)
  assert.equal(isDeepCodeInteractiveCommand('/exit'), true)
  assert.equal(isDeepCodeInteractiveCommand('explain repo'), false)
})

test('Deep Code interactive command dispatcher returns structured help and exit results', async () => {
  const help = await dispatchDeepCodeInteractiveCommand({
    input: '/help',
    env: {},
    cwd: '/repo',
  })
  assert.equal(help.type, 'render')
  assert.match(help.output, /\/status/)
  assert.match(help.output, /\/model/)
  assert.match(help.output, /\/doctor/)
  assert.doesNotMatch(help.output, /Claude|Anthropic/)

  const exit = await dispatchDeepCodeInteractiveCommand({
    input: '/exit',
    env: {},
    cwd: '/repo',
  })
  assert.deepEqual(exit, { type: 'exit' })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: FAIL with module not found for `interactive-commands.mjs`.

- [ ] **Step 3: Implement command dispatcher**

Create `packages/deep-code/src/deepcode/interactive-commands.mjs`:

```js
import {
  buildDeepCodeStatusReport,
  formatDeepCodeStatus,
} from './status.mjs'
import {
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from './harness-config.mjs'
import {
  createDeepSeekDoctorReport,
  formatDeepSeekDoctorReport,
} from './doctor.mjs'
import { resolveDeepSeekConfig } from '../services/providers/deepseek.mjs'

const COMMANDS = new Set([
  '/status',
  '/model',
  '/doctor',
  '/harness',
  '/help',
  '/clear',
  '/exit',
  '/compact',
])

export function isDeepCodeInteractiveCommand(input = '') {
  return COMMANDS.has(String(input).trim().split(/\s+/)[0])
}

export async function dispatchDeepCodeInteractiveCommand({
  input,
  env = process.env,
  cwd = process.cwd(),
  stablePrefix,
  cacheStatsPath,
  messages = [],
  compact,
} = {}) {
  const command = String(input ?? '').trim().split(/\s+/)[0]
  if (command === '/exit') return { type: 'exit' }
  if (command === '/clear') return { type: 'clear' }
  if (command === '/help') return { type: 'render', output: formatHelp() }
  if (command === '/status') {
    const report = await buildDeepCodeStatusReport({
      env,
      cwd,
      repoSummary: stablePrefix?.repoSummary,
      stablePrefix,
      cacheStatsPath,
    })
    return { type: 'render', output: formatDeepCodeStatus(report) }
  }
  if (command === '/model') {
    const config = resolveDeepSeekConfig({ env, cwd })
    return {
      type: 'render',
      output: [
        `Current model: ${config.model}`,
        `Small model: ${config.smallModel}`,
        `Reasoning effort: ${config.reasoningEffort}`,
      ].join('\n'),
    }
  }
  if (command === '/doctor') {
    const report = await createDeepSeekDoctorReport({ env, cwd })
    return { type: 'render', output: formatDeepSeekDoctorReport(report) }
  }
  if (command === '/harness') {
    return {
      type: 'render',
      output: formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig(env)),
    }
  }
  if (command === '/compact') {
    if (messages.length === 0) {
      return { type: 'render', output: 'Nothing to compact.' }
    }
    return compact ? await compact() : { type: 'render', output: 'Compact unavailable.' }
  }
  return { type: 'unhandled' }
}

function formatHelp() {
  return [
    'Deep Code commands',
    '/status   Show provider, model, cache and prefix diagnostics',
    '/model    Show active DeepSeek models and reasoning effort',
    '/doctor   Run DeepSeek-native health checks',
    '/harness  Show Harness mode configuration',
    '/compact  Compact the current conversation tail',
    '/clear    Clear the terminal',
    '/exit     Exit Deep Code',
  ].join('\n')
}
```

- [ ] **Step 4: Wire dispatcher into `deepcode.js`**

Add import:

```js
import {
  dispatchDeepCodeInteractiveCommand,
  isDeepCodeInteractiveCommand,
} from './src/deepcode/interactive-commands.mjs'
```

Replace the slash command `if` block inside `runInteractive()` with:

```js
if (isDeepCodeInteractiveCommand(prompt)) {
  const result = await dispatchDeepCodeInteractiveCommand({
    input: prompt,
    env,
    cwd: process.cwd(),
    stablePrefix,
    cacheStatsPath,
    messages,
    compact: async () => {
      const result = await compactDeepCodeConversation({
        env,
        cwd: process.cwd(),
        stablePrefix,
        messages,
      })
      messages.splice(0, messages.length, ...result.messages)
      await recordDeepSeekCacheUsage({
        path: cacheStatsPath,
        usage: result.usage,
        stablePrefix,
      })
      return {
        type: 'render',
        output: formatDeepCodeCompactResult(result),
      }
    },
  })
  if (result.type === 'exit') break
  if (result.type === 'clear') {
    process.stdout.write('\x1Bc')
    console.log(formatDeepCodeWelcome({
      version: VERSION,
      report: statusReport,
      cwd: process.cwd(),
      env,
    }))
    continue
  }
  if (result.output) console.log(result.output)
  continue
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/deep-code/src/deepcode/interactive-commands.mjs packages/deep-code/deepcode.js packages/deep-code/test/deepcode-native.test.mjs
git commit -m "feat: add Deep Code interactive command dispatcher"
```

---

## Task 4: Add Claude Code-Like Prompt And Footer Renderer

**Files:**
- Create: `packages/deep-code/src/deepcode/interactive-ui.mjs`
- Modify: `packages/deep-code/deepcode.js`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`
- Test: `packages/deep-code/test/deepcode-package.test.mjs`

- [ ] **Step 1: Write failing UI renderer tests**

Add import:

```js
import {
  formatDeepCodeFooter,
  formatDeepCodePrompt,
  formatDeepCodeUserLine,
} from '../src/deepcode/interactive-ui.mjs'
```

Add tests:

```js
test('Deep Code interactive UI renders prompt and footer without legacy brands', () => {
  const prompt = formatDeepCodePrompt({ color: false })
  const footer = formatDeepCodeFooter({
    cwd: '/Users/wanghaoyu/Downloads/deepcode源码',
    model: 'deepseek-v4-pro',
    contextLabel: '1M context',
    effort: 'max',
    color: false,
  })
  const userLine = formatDeepCodeUserLine('/status', { color: false })

  assert.equal(prompt, '> ')
  assert.match(footer, /deepcode源码/)
  assert.match(footer, /deepseek-v4-pro \(1M context\)/)
  assert.match(footer, /max - \/effort/)
  assert.equal(userLine, '> /status')
  assert.doesNotMatch(`${prompt}\n${footer}\n${userLine}`, /Claude|Anthropic/)
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: FAIL with module not found for `interactive-ui.mjs`.

- [ ] **Step 3: Implement UI renderer**

Create `packages/deep-code/src/deepcode/interactive-ui.mjs`:

```js
import { colorize } from './terminal-theme.mjs'

export function formatDeepCodePrompt({ color = process.stdout.isTTY } = {}) {
  return colorize('> ', 'shimmer', color)
}

export function formatDeepCodeUserLine(input, { color = process.stdout.isTTY } = {}) {
  return `${formatDeepCodePrompt({ color })}${input}`
}

export function formatDeepCodeFooter({
  cwd = process.cwd(),
  model = 'deepseek-v4-pro',
  contextLabel = '1M context',
  effort = 'max',
  color = process.stdout.isTTY,
} = {}) {
  const workspace = basename(cwd)
  return [
    colorize(workspace, 'shimmer', color),
    `  ${model} (${contextLabel})  `,
    colorize('*', 'muted', color),
    ` ${effort} - /effort`,
  ].join('')
}

export function formatAssistantPrefix({ color = process.stdout.isTTY } = {}) {
  return colorize('Deep Code: ', 'primary', color)
}

function basename(path) {
  const parts = String(path ?? '').split('/').filter(Boolean)
  return parts.at(-1) ?? '.'
}
```

- [ ] **Step 4: Wire prompt renderer into `deepcode.js`**

Add import:

```js
import {
  formatAssistantPrefix,
  formatDeepCodePrompt,
} from './src/deepcode/interactive-ui.mjs'
```

Replace:

```js
const prompt = await rl.question('deepcode> ')
```

with:

```js
const prompt = await rl.question(formatDeepCodePrompt())
```

Before streaming assistant output, write:

```js
process.stdout.write(formatAssistantPrefix())
```

- [ ] **Step 5: Update package startup test**

In `packages/deep-code/test/deepcode-package.test.mjs`, update the default startup assertion:

```js
assert.match(result.stdout, /> /)
assert.doesNotMatch(result.stdout, /deepcode> /)
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/deep-code/src/deepcode/interactive-ui.mjs packages/deep-code/deepcode.js packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
git commit -m "feat: add Deep Code interactive prompt renderer"
```

---

## Task 5: Improve Streaming Interaction Readability

**Files:**
- Modify: `packages/deep-code/deepcode.js`
- Modify: `packages/deep-code/src/deepcode/interactive-ui.mjs`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`

- [ ] **Step 1: Write tests for assistant output framing**

Add test:

```js
test('Deep Code assistant prefix uses Deep Code branding', () => {
  const prefix = formatAssistantPrefix({ color: false })
  assert.equal(prefix, 'Deep Code: ')
  assert.doesNotMatch(prefix, /Claude|Anthropic/)
})
```

- [ ] **Step 2: Run tests and verify pass/failure**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: PASS if Task 4 implemented `formatAssistantPrefix()` exactly; otherwise FAIL and fix.

- [ ] **Step 3: Add clean spacing around assistant streaming**

In `packages/deep-code/deepcode.js`, change the non-command prompt handling from:

```js
messages.push({ role: 'user', content: prompt })
const response = await requestDeepSeek(messages, env, {
  streamToStdout: true,
  stablePrefix,
})
```

to:

```js
messages.push({ role: 'user', content: prompt })
process.stdout.write(formatAssistantPrefix())
const response = await requestDeepSeek(messages, env, {
  streamToStdout: true,
  stablePrefix,
})
```

Keep the existing newline guard:

```js
if (!response.content.endsWith('\n')) process.stdout.write('\n')
```

- [ ] **Step 4: Run real print and interactive smoke**

Run:

```bash
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" deepcode -p "Reply exactly: deepcode-stream-ok"
```

Expected:

```text
deepcode-stream-ok
```

Then run:

```bash
deepcode
```

Type:

```text
Reply exactly: deepcode-interactive-stream-ok
```

Expected: output begins with `Deep Code: ` and includes `deepcode-interactive-stream-ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/deep-code/deepcode.js packages/deep-code/src/deepcode/interactive-ui.mjs packages/deep-code/test/deepcode-native.test.mjs
git commit -m "feat: improve Deep Code interactive streaming display"
```

---

## Task 6: Add Recent Activity Adapter

**Files:**
- Create: `packages/deep-code/src/deepcode/recent-activity.mjs`
- Modify: `packages/deep-code/src/deepcode/welcome.mjs`
- Test: `packages/deep-code/test/deepcode-native.test.mjs`

- [ ] **Step 1: Write failing tests**

Add import:

```js
import { createDeepCodeRecentActivity } from '../src/deepcode/recent-activity.mjs'
```

Add tests:

```js
test('createDeepCodeRecentActivity summarizes cache and session state for welcome', () => {
  const activity = createDeepCodeRecentActivity({
    cacheStats: {
      lastPromptCacheHitTokens: 1280,
      lastPromptCacheMissTokens: 94,
      lastPromptCacheHitRate: 0.932,
      requestCount: 7,
    },
    lastSessionSummary: 'Edited packages/deep-code/deepcode.js',
  })

  assert.deepEqual(activity, [
    'Cache hit 1280 / miss 94 / rate 93.2%',
    'Requests recorded: 7',
    'Last: Edited packages/deep-code/deepcode.js',
  ])
})

test('createDeepCodeRecentActivity falls back cleanly when no activity exists', () => {
  assert.deepEqual(createDeepCodeRecentActivity({}), ['No recent activity'])
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs
```

Expected: FAIL with module not found for `recent-activity.mjs`.

- [ ] **Step 3: Implement recent activity adapter**

Create `packages/deep-code/src/deepcode/recent-activity.mjs`:

```js
export function createDeepCodeRecentActivity({
  cacheStats,
  lastSessionSummary,
} = {}) {
  if (!cacheStats && !lastSessionSummary) return ['No recent activity']
  const rows = []
  if (cacheStats) {
    rows.push(
      `Cache hit ${cacheStats.lastPromptCacheHitTokens ?? 0} / miss ${cacheStats.lastPromptCacheMissTokens ?? 0} / rate ${formatRate(cacheStats.lastPromptCacheHitRate)}`,
    )
    rows.push(`Requests recorded: ${cacheStats.requestCount ?? 0}`)
  }
  if (lastSessionSummary) rows.push(`Last: ${lastSessionSummary}`)
  return rows
}

function formatRate(value) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`
}
```

- [ ] **Step 4: Use adapter in welcome screen**

In `packages/deep-code/src/deepcode/welcome.mjs`, import:

```js
import { createDeepCodeRecentActivity } from './recent-activity.mjs'
```

Replace `createCacheText(report.cacheStats)` usage with:

```js
const recentActivity = createDeepCodeRecentActivity({
  cacheStats: report.cacheStats,
})
```

Render the first rows:

```js
row('  / __  /_/ / __ \\', recentActivity[0] ?? 'No recent activity', leftWidth, rightWidth, color),
row(' / /_/ / __/ /_/ /', recentActivity[1] ?? apiKeyText, leftWidth, rightWidth, color),
row(' \\__,_/_/  \\____/', recentActivity[2] ?? `Harness mode: ${harnessMode}`, leftWidth, rightWidth, color),
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/deep-code/src/deepcode/recent-activity.mjs packages/deep-code/src/deepcode/welcome.mjs packages/deep-code/test/deepcode-native.test.mjs
git commit -m "feat: add Deep Code recent activity summary"
```

---

## Task 7: Add Real Interactive Startup Smoke Test

**Files:**
- Modify: `packages/deep-code/test/deepcode-package.test.mjs`

- [ ] **Step 1: Add subprocess startup smoke test**

Add this test near the current default interactive startup test:

```js
test('Deep Code interactive startup handles status model and exit commands', () => {
  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
  ], {
    cwd: root,
    encoding: 'utf8',
    input: '/status\n/model\n/exit\n',
    env: {
      ...process.env,
      DEEPCODE_FORCE_NATIVE_INTERACTIVE: '1',
      DEEPCODE_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPCODE_CACHE_STATS: 'disabled',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Deep Code v0\.1\.0-deepseek-native/)
  assert.match(result.stdout, /Provider: DeepSeek native/)
  assert.match(result.stdout, /Current model: deepseek-v4-pro/)
  assert.match(result.stdout, /> /)
  assert.doesNotMatch(result.stdout, /Claude|Anthropic/)
})
```

- [ ] **Step 2: Run package test**

Run:

```bash
node --test packages/deep-code/test/deepcode-package.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/deep-code/test/deepcode-package.test.mjs
git commit -m "test: cover Deep Code interactive startup commands"
```

---

## Task 8: Full Regression And Live DeepSeek Validation

**Files:**
- No code changes expected.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test packages/deep-code/test/deepcode-native.test.mjs packages/deep-code/test/deepcode-package.test.mjs
npm run test:tui-deepseek --workspace @deepcode-ai/deep-code
```

Expected:

```text
# pass 111 or more
11 pass
0 fail
```

- [ ] **Step 2: Run full local regression**

Run:

```bash
git diff --check
npm test
```

Expected: both pass.

- [ ] **Step 3: Run real DeepSeek smoke**

Use the test key only through environment variables:

```bash
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" deepcode --doctor
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" deepcode -p "Reply exactly: deepcode-tui-polish-ok"
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" deepcode --tool-e2e
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" deepcode --agent-e2e
```

Expected:

```text
Summary: pass=15 warn=1 fail=0 skip=0
deepcode-tui-polish-ok
Model response: "tool-e2e-ok"
Model response: "deepcode-agent-e2e-ok"
```

- [ ] **Step 4: Manual interactive validation**

Run:

```bash
deepcode
```

Type:

```text
/status
/model
/help
Reply exactly: deepcode-manual-ok
/exit
```

Expected:
- Welcome panel renders immediately.
- Prompt appears as `> `.
- `/status`, `/model`, `/help` render without legacy brand text.
- Assistant response is readable and prefixed as `Deep Code:`.
- Exit returns to shell cleanly.

- [ ] **Step 5: Push**

Run:

```bash
git status --short --branch
git push origin main
```

Expected:

```text
## main...origin/main
```

after push.

---

## Risk Controls

- Do not enable the old full TUI by default. It still contains legacy Anthropic setup/OAuth paths.
- Keep `DEEPCODE_EXPERIMENTAL_FULL_TUI=1` as the only way to enter that path.
- Do not write the DeepSeek test key into files, commits, logs, or docs.
- Do not rename or override the global `claude` command.
- Keep all default config writes under `.deepcode` or `DEEPCODE_CONFIG_DIR`.
- Avoid large UI rewrites in this phase; the goal is a polished, stable terminal interaction layer, not full Ink parity.

---

## Self-Review

- Spec coverage: The plan covers a Claude Code-like startup panel, prompt, footer, slash commands, readable streaming, recent activity, testing, and live validation.
- Placeholder scan: No TBD/TODO placeholders are used. Each task includes concrete files, code, commands, and expected results.
- Type consistency: Public functions are consistently named across tasks: `formatDeepCodeWelcome`, `formatDeepCodePrompt`, `formatDeepCodeFooter`, `dispatchDeepCodeInteractiveCommand`, and `createDeepCodeRecentActivity`.
- Scope check: This is one coherent subsystem: the stable DeepSeek-native interactive terminal experience. Full Ink TUI migration remains explicitly out of scope until legacy setup/auth is rewritten.
