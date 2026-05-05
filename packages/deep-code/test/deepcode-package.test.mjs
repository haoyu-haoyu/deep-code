import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../../..')
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const innerPackage = JSON.parse(
  readFileSync(resolve(root, 'packages/deep-code/package.json'), 'utf8'),
)
const mainSource = readFileSync(
  resolve(root, 'packages/deep-code/src/main.tsx'),
  'utf8',
)
const commandsSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands.ts'),
  'utf8',
)
const systemPromptSource = readFileSync(
  resolve(root, 'packages/deep-code/src/constants/system.ts'),
  'utf8',
)
const projectOnboardingSource = readFileSync(
  resolve(root, 'packages/deep-code/src/projectOnboardingState.ts'),
  'utf8',
)
const claudemdSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/claudemd.ts'),
  'utf8',
)
const configSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/config.ts'),
  'utf8',
)
const settingsSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/settings/settings.ts'),
  'utf8',
)
const markdownConfigLoaderSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/markdownConfigLoader.ts'),
  'utf8',
)
const agentTypesSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/agents/types.ts'),
  'utf8',
)
const agentFileUtilsSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/agents/agentFileUtils.ts'),
  'utf8',
)
const skillsLoaderSource = readFileSync(
  resolve(root, 'packages/deep-code/src/skills/loadSkillsDir.ts'),
  'utf8',
)
const outputStylesSource = readFileSync(
  resolve(root, 'packages/deep-code/src/constants/outputStyles.ts'),
  'utf8',
)
const printSource = readFileSync(
  resolve(root, 'packages/deep-code/src/cli/print.ts'),
  'utf8',
)
const replSource = readFileSync(
  resolve(root, 'packages/deep-code/src/screens/REPL.tsx'),
  'utf8',
)
const useMergedToolsSource = readFileSync(
  resolve(root, 'packages/deep-code/src/hooks/useMergedTools.ts'),
  'utf8',
)
const toolsSource = readFileSync(
  resolve(root, 'packages/deep-code/src/tools.ts'),
  'utf8',
)
const deepSeekCallModelSource = readFileSync(
  resolve(root, 'packages/deep-code/src/query/deepseek-call-model.mjs'),
  'utf8',
)
const printModelInfoSource = readFileSync(
  resolve(root, 'packages/deep-code/src/cli/printModelInfo.ts'),
  'utf8',
)
const managedEnvSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/managedEnvConstants.ts'),
  'utf8',
)
const deepcodeEntrypointSource = readFileSync(
  resolve(root, 'packages/deep-code/deepcode.js'),
  'utf8',
)
const themeSource = readFileSync(
  resolve(root, 'packages/deep-code/src/utils/theme.ts'),
  'utf8',
)
const autoModeOptInSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/AutoModeOptInDialog.tsx'),
  'utf8',
)
const mcpDialogCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/MCPServerDialogCopy.tsx'),
  'utf8',
)
const workflowMultiselectSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/WorkflowMultiselectDialog.tsx'),
  'utf8',
)
const themePickerSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/ThemePicker.tsx'),
  'utf8',
)
const managedSettingsSecuritySource = readFileSync(
  resolve(
    root,
    'packages/deep-code/src/components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx',
  ),
  'utf8',
)
const statusCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/status/index.ts'),
  'utf8',
)
const modelCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/model/index.ts'),
  'utf8',
)
const doctorCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/doctor/index.ts'),
  'utf8',
)
const statuslineCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/statusline.tsx'),
  'utf8',
)
const desktopCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/desktop/index.ts'),
  'utf8',
)
const mobileCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/mobile/index.ts'),
  'utf8',
)
const chromeCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/chrome/index.ts'),
  'utf8',
)
const installSlackAppCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/install-slack-app/index.ts'),
  'utf8',
)
const installGitHubAppCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/install-github-app/index.ts'),
  'utf8',
)
const feedbackCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/feedback/index.ts'),
  'utf8',
)
const pluginCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/plugin/index.tsx'),
  'utf8',
)
const memoryCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/memory/index.ts'),
  'utf8',
)
const logoutCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/logout/index.ts'),
  'utf8',
)
const passesCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/passes/index.ts'),
  'utf8',
)
const stickersCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/stickers/index.ts'),
  'utf8',
)
const statsCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/stats/index.ts'),
  'utf8',
)
const reviewCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/review.ts'),
  'utf8',
)
const thinkbackCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/thinkback/index.ts'),
  'utf8',
)
const costCommandCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/cost/cost.ts'),
  'utf8',
)
const ideCommandCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/ide/ide.tsx'),
  'utf8',
)
const pluginTrustWarningSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/plugin/PluginTrustWarning.tsx'),
  'utf8',
)
const pluginManageMarketplacesSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/plugin/ManageMarketplaces.tsx'),
  'utf8',
)
const pluginDiscoverSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/plugin/DiscoverPlugins.tsx'),
  'utf8',
)
const mcpAddCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/mcp/addCommand.ts'),
  'utf8',
)
const initCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/init.ts'),
  'utf8',
)
const insightsCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/insights.ts'),
  'utf8',
)
const thinkbackBodySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/thinkback/thinkback.tsx'),
  'utf8',
)
const installCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/install.tsx'),
  'utf8',
)
const remoteSetupCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/remote-setup/index.ts'),
  'utf8',
)
const mcpXaaIdpCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/mcp/xaaIdpCommand.ts'),
  'utf8',
)
const memoryCommandCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/memory/memory.tsx'),
  'utf8',
)
const copyCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/copy/index.ts'),
  'utf8',
)
const modelCommandCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/model/model.tsx'),
  'utf8',
)
const privacySettingsCommandSource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/privacy-settings/privacy-settings.tsx'),
  'utf8',
)
const fastCommandCopySource = readFileSync(
  resolve(root, 'packages/deep-code/src/commands/fast/fast.tsx'),
  'utf8',
)
const settingsStatusSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/Settings/Status.tsx'),
  'utf8',
)
const helpGeneralSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/HelpV2/General.tsx'),
  'utf8',
)
const onboardingSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/Onboarding.tsx'),
  'utf8',
)
const permissionRequestSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/permissions/PermissionRequest.tsx'),
  'utf8',
)
const enterPlanModePermissionSource = readFileSync(
  resolve(root, 'packages/deep-code/src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx'),
  'utf8',
)
const runSingleTurnSource = deepcodeEntrypointSource.slice(
  deepcodeEntrypointSource.indexOf('async function runSingleTurn'),
  deepcodeEntrypointSource.indexOf('async function runInteractive'),
)

function inlineSourceMapSources(source) {
  const match = source.match(
    /sourceMappingURL=data:application\/json;charset=utf-8;base64,([^\n]+)/,
  )
  if (!match) {
    return ''
  }
  const map = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  return (map.sourcesContent ?? []).join('\n')
}

function stripInlineSourceMap(source) {
  return source.replace(/\n\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,[\s\S]*$/, '')
}

test('root package is branded as Deep Code', () => {
  assert.equal(rootPackage.name, 'deep-code')
  assert.deepEqual(rootPackage.workspaces, ['packages/deep-code'])
  assert.equal(rootPackage.bin.deepcode, 'packages/deep-code/deepcode.js')
  assert.equal(rootPackage.bin['deep-code'], 'packages/deep-code/deepcode.js')
  assert.equal(rootPackage.dependencies['@deepcode-ai/deep-code'], 'workspace:*')
  assert.equal('@anthropic-ai/claude-code' in rootPackage.dependencies, false)
})

test('inner package exposes Deep Code bins only', () => {
  assert.equal(innerPackage.name, '@deepcode-ai/deep-code')
  assert.equal(innerPackage.bin.deepcode, 'deepcode.js')
  assert.equal(innerPackage.bin['deep-code'], 'deepcode.js')
  assert.equal('claude' in innerPackage.bin, false)
  assert.match(innerPackage.description, /DeepSeek-native Deep Code/)
})

test('lockfile metadata matches Deep Code wrapper', () => {
  assert.equal(lockfile.name, 'deep-code')
  assert.equal(lockfile.packages[''].name, 'deep-code')
  assert.deepEqual(lockfile.packages[''].workspaces, ['packages/deep-code'])
  assert.equal(lockfile.packages[''].dependencies['@deepcode-ai/deep-code'], 'workspace:*')
  assert.equal(lockfile.packages['packages/deep-code'].name, '@deepcode-ai/deep-code')
  assert.equal('claude' in lockfile.packages['packages/deep-code'].bin, false)
})

test('root node_modules is not tracked as Deep Code source', () => {
  assert.equal(existsSync(resolve(root, 'packages/deep-code/deepcode.js')), true)
  assert.equal(existsSync(resolve(root, 'node_modules/.bin/claude')), false)
})

test('Deep Code package entrypoint executes the DeepSeek-native CLI', () => {
  for (const binName of ['deepcode', 'deep-code']) {
    const result = spawnSync('node', [resolve(root, rootPackage.bin[binName]), '--version'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '0.1.0-deepseek-native (Deep Code)')
  }
})

test('Deep Code CLI advertises DeepSeek local toolchain E2E check', () => {
  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '--help',
  ], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /deepcode --tool-e2e/)
  assert.match(result.stdout, /deepcode -p "explain this repo"/)
  assert.match(result.stdout, /deepcode --compact "summarize this transcript tail"/)
  assert.match(result.stdout, /--model deepseek-v4-pro/)
  assert.match(result.stdout, /--reasoning-effort high\|max/)
})

test('Deep Code front controller delegates print mode to the full CLI bundle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-full-cli-delegate-'))
  const fakeFullCli = join(dir, 'deepcode-full.mjs')
  const capturePath = join(dir, 'capture.json')
  writeFileSync(fakeFullCli, [
    '#!/usr/bin/env node',
    'import { writeFileSync } from "node:fs"',
    `writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), provider: process.env.DEEPCODE_PROVIDER ?? null }))`,
    'console.log("delegated-full-cli")',
  ].join('\n'))

  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '-p',
    'explain',
    'repo',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_FULL_CLI_PATH: fakeFullCli,
      DEEPCODE_PROVIDER: 'deepseek',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'delegated-full-cli')
  assert.deepEqual(JSON.parse(readFileSync(capturePath, 'utf8')), {
    argv: ['-p', 'explain', 'repo'],
    cwd: root,
    provider: 'deepseek',
  })
})

test('Deep Code front controller delegates interactive mode to the full CLI bundle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-full-cli-tui-delegate-'))
  const fakeFullCli = join(dir, 'deepcode-full.mjs')
  const capturePath = join(dir, 'capture.json')
  writeFileSync(fakeFullCli, [
    '#!/usr/bin/env node',
    'import { writeFileSync } from "node:fs"',
    `writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), provider: process.env.DEEPCODE_PROVIDER ?? null }))`,
    'console.log("delegated-full-cli-tui")',
  ].join('\n'))

  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '--model',
    'deepseek-v4-flash',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_FULL_CLI_PATH: fakeFullCli,
      DEEPCODE_PROVIDER: 'deepseek',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'delegated-full-cli-tui')
  assert.deepEqual(JSON.parse(readFileSync(capturePath, 'utf8')), {
    argv: ['--model', 'deepseek-v4-flash'],
    cwd: root,
    provider: 'deepseek',
  })
})

test('Deep Code front controller streams TUI stdin through the full CLI bundle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-full-cli-tui-stdio-'))
  const fakeFullCli = join(dir, 'deepcode-full.mjs')
  const capturePath = join(dir, 'capture.json')
  writeFileSync(fakeFullCli, [
    '#!/usr/bin/env node',
    'import { writeFileSync } from "node:fs"',
    'let input = ""',
    'process.stdin.setEncoding("utf8")',
    'for await (const chunk of process.stdin) input += chunk',
    'writeFileSync(process.env.DEEPCODE_TUI_CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), input, provider: process.env.DEEPCODE_PROVIDER }))',
    'console.log("Deep Code TUI started")',
    'for (const line of input.split(/\\r?\\n/).map(value => value.trim()).filter(Boolean)) {',
    '  if (line === "/status") console.log("Provider: DeepSeek native\\nCache telemetry: last_hit=8 last_miss=2 last_hit_rate=80.0%")',
    '  if (line === "/model") console.log("Current model: deepseek-v4-pro (effort: max)")',
    '  if (line === "/doctor") console.log("Deep Code Doctor\\n[OK] DeepSeek provider capabilities")',
    '  if (line === "/exit") console.log("Deep Code TUI exited")',
    '}',
  ].join('\n'))

  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
  ], {
    cwd: root,
    encoding: 'utf8',
    input: '/status\n/model\n/doctor\n/exit\n',
    env: {
      ...process.env,
      DEEPCODE_FULL_CLI_PATH: fakeFullCli,
      DEEPCODE_PROVIDER: 'deepseek',
      DEEPCODE_TUI_CAPTURE_PATH: capturePath,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Deep Code TUI started/)
  assert.match(result.stdout, /Provider: DeepSeek native/)
  assert.match(result.stdout, /Current model: deepseek-v4-pro/)
  assert.match(result.stdout, /Deep Code Doctor/)
  assert.match(result.stdout, /Deep Code TUI exited/)
  assert.doesNotMatch(result.stdout, /Claude|Anthropic/)
  assert.deepEqual(JSON.parse(readFileSync(capturePath, 'utf8')), {
    argv: [],
    input: '/status\n/model\n/doctor\n/exit\n',
    provider: 'deepseek',
  })
})

test('Deep Code front controller reports a clear error when the full CLI bundle is missing', () => {
  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '-p',
    'explain',
    'repo',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_FULL_CLI_PATH: join(tmpdir(), 'missing-deepcode-full.mjs'),
    },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Deep Code full CLI bundle is missing/)
  assert.match(result.stderr, /npm run build:full-cli --workspace @deepcode-ai\/deep-code/)
})

test('Deep Code package can build the full CLI launcher artifact', () => {
  const result = spawnSync('npm', [
    'run',
    'build:full-cli',
    '--workspace',
    '@deepcode-ai/deep-code',
  ], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  const bundlePath = resolve(root, 'packages/deep-code/dist/deepcode-full.mjs')
  assert.equal(existsSync(bundlePath), true)
  const bundleSource = readFileSync(bundlePath, 'utf8')
  assert.doesNotMatch(bundleSource, /src\/entrypoints\/cli\.tsx/)
  assert.doesNotMatch(bundleSource, /--preload/)
  assert.doesNotMatch(bundleSource, /Failed to launch Deep Code full CLI through Bun/)
  assert.doesNotMatch(bundleSource, /import\("\.\/devtools\.js"\)/)
  assert.doesNotMatch(bundleSource, /environment variable DEV is set to true/)
  assert.match(bundleSource, /Deep Code full CLI bundled artifact/)

  const versionResult = spawnSync('node', [bundlePath, '--version'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(versionResult.status, 0, versionResult.stderr)
  assert.match(versionResult.stdout, /0\.1\.0-deepseek-native \(Deep Code\)/)

  const helpResult = spawnSync('node', [bundlePath, '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(helpResult.status, 0, helpResult.stderr)
  assert.match(helpResult.stdout, /Deep Code/)
  assert.match(helpResult.stdout, /DeepSeek native models/)
})

test('Deep Code theme exposes DeepSeek blue brand tokens and aliases legacy brand tokens to blue', () => {
  assert.match(themeSource, /deepseek: string/)
  assert.match(themeSource, /deepseekShimmer: string/)
  assert.match(themeSource, /DEEPSEEK_BLUE = 'rgb\(77,107,254\)'/)
  assert.match(themeSource, /DEEPSEEK_BLUE_DARK = 'rgb\(143,170,255\)'/)
  assert.doesNotMatch(themeSource, /claude: 'rgb\(215,119,87\)'/)
  assert.doesNotMatch(themeSource, /briefLabelClaude: 'rgb\(215,119,87\)'/)
  assert.doesNotMatch(themeSource, /claude: 'ansi:redBright'/)
})

test('TUI visible copy uses Deep Code and DeepSeek branding', () => {
  const visibleSources = [
    autoModeOptInSource,
    mcpDialogCopySource,
    workflowMultiselectSource,
    themePickerSource,
    managedSettingsSecuritySource,
  ].join('\n')

  assert.match(autoModeOptInSource, /Deep Code checks each tool call/)
  assert.match(autoModeOptInSource, /https:\/\/api-docs\.deepseek\.com/)
  assert.match(mcpDialogCopySource, /Deep Code repository/)
  assert.match(workflowMultiselectSource, /Deep Code - Tag @deepcode/)
  assert.match(workflowMultiselectSource, /haoyu-haoyu\/deep-code/)
  assert.match(themePickerSource, /Hello, Deep Code!/)
  assert.match(managedSettingsSecuritySource, /No, exit Deep Code/)
  assert.doesNotMatch(visibleSources, /Claude Code/)
  assert.doesNotMatch(visibleSources, /Claude handle/)
  assert.doesNotMatch(visibleSources, /Anthropic Console/)
  assert.doesNotMatch(visibleSources, /code\.claude\.com/)
  assert.doesNotMatch(visibleSources, /anthropics\/claude-code-action/)
})

test('TUI slash command metadata uses Deep Code and DeepSeek branding', () => {
  const commandSources = [
    statusCommandSource,
    modelCommandSource,
    doctorCommandSource,
  ].join('\n')

  assert.match(statusCommandSource, /Show Deep Code status/)
  assert.match(modelCommandSource, /Set the AI model for Deep Code/)
  assert.match(doctorCommandSource, /Diagnose and verify your Deep Code installation/)
  assert.doesNotMatch(commandSources, /Claude Code/)
  assert.doesNotMatch(commandSources, /Anthropic/)
})

test('high-visibility user copy uses Deep Code and DeepSeek branding', () => {
  const highVisibilitySources = [
    commandsSource,
    systemPromptSource,
    projectOnboardingSource,
    outputStylesSource,
    statuslineCommandSource,
    helpGeneralSource,
    onboardingSource,
    permissionRequestSource,
    enterPlanModePermissionSource,
  ].map(stripInlineSourceMap).join('\n')

  assert.match(systemPromptSource, /You are Deep Code/)
  assert.match(helpGeneralSource, /Deep Code understands your codebase/)
  assert.doesNotMatch(highVisibilitySources, /Claude Code/)
  assert.doesNotMatch(highVisibilitySources, /Anthropic's official CLI/)
  assert.doesNotMatch(highVisibilitySources, /Ask Claude/)
  assert.doesNotMatch(highVisibilitySources, /instructions for Claude/)
  assert.doesNotMatch(highVisibilitySources, /Claude understands/)
  assert.doesNotMatch(highVisibilitySources, /Claude can make mistakes/)
  assert.doesNotMatch(highVisibilitySources, /Claude wants/)
  assert.doesNotMatch(highVisibilitySources, /Claude needs/)
  assert.doesNotMatch(highVisibilitySources, /Claude explains/)
  assert.doesNotMatch(highVisibilitySources, /Claude pauses/)
})

test('DeepSeek-native slash commands hide legacy Claude service integrations by default', () => {
  const commandRegistry = commandsSource.slice(
    commandsSource.indexOf('const COMMANDS'),
    commandsSource.indexOf('export const builtInCommandNames'),
  )
  const remoteSafeRegistry = commandsSource.slice(
    commandsSource.indexOf('export const REMOTE_SAFE_COMMANDS'),
    commandsSource.indexOf('export const BRIDGE_SAFE_COMMANDS'),
  )
  const publicCommandSources = [
    feedbackCommandSource,
    pluginCommandSource,
    memoryCommandSource,
  ].map(stripInlineSourceMap).join('\n')
  const legacyCommandSources = [
    desktopCommandSource,
    mobileCommandSource,
    chromeCommandSource,
    installSlackAppCommandSource,
    installGitHubAppCommandSource,
    logoutCommandSource,
  ].map(stripInlineSourceMap).join('\n')

  for (const legacyCommand of [
    'chrome',
    'desktop',
    'installGitHubApp',
    'installSlackApp',
    'mobile',
  ]) {
    const commandEntryPattern = new RegExp(`^\\s*${legacyCommand},`, 'm')
    assert.doesNotMatch(commandRegistry, commandEntryPattern)
    assert.doesNotMatch(remoteSafeRegistry, commandEntryPattern)
  }
  assert.doesNotMatch(commandRegistry, /webCmd \? \[webCmd\]/)
  assert.doesNotMatch(commandRegistry, /voiceCommand \? \[voiceCommand\]/)

  assert.match(commandsSource, /includeLegacyClaudeServiceCommands/)
  assert.match(publicCommandSources, /Deep Code/)
  assert.doesNotMatch(publicCommandSources, /Claude Code|Anthropic/)
  assert.doesNotMatch(legacyCommandSources, /Continue the current session in Claude Desktop/)
  assert.doesNotMatch(legacyCommandSources, /Claude mobile app/)
  assert.doesNotMatch(legacyCommandSources, /Claude in Chrome/)
  assert.doesNotMatch(legacyCommandSources, /Claude Slack app/)
  assert.doesNotMatch(legacyCommandSources, /Claude GitHub Actions/)
  assert.doesNotMatch(legacyCommandSources, /Anthropic account/)
})

test('default visible slash command descriptions use Deep Code branding', () => {
  const defaultSlashCommandSources = [
    passesCommandSource,
    stickersCommandSource,
    statsCommandSource,
    reviewCommandSource,
    thinkbackCommandSource,
  ].map(stripInlineSourceMap).join('\n')

  assert.match(defaultSlashCommandSources, /Deep Code/)
  assert.doesNotMatch(defaultSlashCommandSources, /Claude Code|Anthropic/)
})

test('common public command copy uses Deep Code branding', () => {
  const publicCommandCopySources = [
    costCommandCopySource,
    ideCommandCopySource,
    pluginTrustWarningSource,
    pluginManageMarketplacesSource,
    pluginDiscoverSource,
    mcpAddCommandSource,
    memoryCommandCopySource,
    copyCommandSource,
    modelCommandCopySource,
    privacySettingsCommandSource,
    fastCommandCopySource,
  ].map(stripInlineSourceMap).join('\n')

  assert.match(publicCommandCopySources, /Deep Code/)
  assert.doesNotMatch(publicCommandCopySources, /Claude Code/)
  assert.doesNotMatch(publicCommandCopySources, /Copy Claude/)
  assert.doesNotMatch(publicCommandCopySources, /Help improve Claude/)
  assert.doesNotMatch(publicCommandCopySources, /Claude\.ai/)
  assert.doesNotMatch(publicCommandCopySources, /Anthropic/)
  assert.doesNotMatch(publicCommandCopySources, /docs\.claude\.com/)
  assert.doesNotMatch(publicCommandCopySources, /code\.claude\.com/)
  assert.doesNotMatch(publicCommandCopySources, /claude\.ai/)
  assert.doesNotMatch(publicCommandCopySources, /\bclaude mcp add\b/)
})

test('secondary public command flows keep Deep Code branding while preserving CLAUDE.md compatibility names', () => {
  const secondaryPublicSources = [
    initCommandSource,
    insightsCommandSource,
    thinkbackBodySource,
    installCommandSource,
    remoteSetupCommandSource,
    mcpXaaIdpCommandSource,
  ].map(stripInlineSourceMap).join('\n')

  assert.match(secondaryPublicSources, /Deep Code/)
  assert.match(secondaryPublicSources, /CLAUDE\.md/)
  assert.doesNotMatch(secondaryPublicSources, /\bClaude\b/)
  assert.doesNotMatch(secondaryPublicSources, /Anthropic/)
  assert.doesNotMatch(secondaryPublicSources, /claude\.ai/)
  assert.doesNotMatch(secondaryPublicSources, /code\.claude\.com/)
  assert.doesNotMatch(secondaryPublicSources, /DeepSeek-native Deep Code/)
  assert.doesNotMatch(secondaryPublicSources, /\bclaude mcp add\b/)
  assert.doesNotMatch(secondaryPublicSources, /\bclaude -p\b/)
})

test('TUI inline source maps use Deep Code and DeepSeek branding', () => {
  const sourceMapSources = [
    autoModeOptInSource,
    mcpDialogCopySource,
    workflowMultiselectSource,
    themePickerSource,
    managedSettingsSecuritySource,
  ].map(inlineSourceMapSources).join('\n')

  assert.match(sourceMapSources, /Deep Code checks each tool call/)
  assert.match(sourceMapSources, /https:\/\/api-docs\.deepseek\.com/)
  assert.match(sourceMapSources, /Deep Code repository/)
  assert.match(sourceMapSources, /Deep Code - Tag @deepcode/)
  assert.match(sourceMapSources, /haoyu-haoyu\/deep-code/)
  assert.match(sourceMapSources, /Hello, Deep Code!/)
  assert.match(sourceMapSources, /No, exit Deep Code/)
  assert.doesNotMatch(sourceMapSources, /Claude Code/)
  assert.doesNotMatch(sourceMapSources, /Claude handle/)
  assert.doesNotMatch(sourceMapSources, /Anthropic Console/)
  assert.doesNotMatch(sourceMapSources, /code\.claude\.com/)
  assert.doesNotMatch(sourceMapSources, /anthropics\/claude-code-action/)
})

test('Deep Code status displays persisted DeepSeek cache telemetry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deepcode-cache-status-'))
  const statsPath = join(dir, 'stats.json')
  writeFileSync(statsPath, JSON.stringify({
    version: 1,
    requestCount: 2,
    totalPromptCacheHitTokens: 90,
    totalPromptCacheMissTokens: 10,
    totalPromptCacheHitRate: 0.9,
    lastPromptCacheHitTokens: 9,
    lastPromptCacheMissTokens: 1,
    lastPromptCacheHitRate: 0.9,
    updatedAt: '2026-05-05T00:00:00.000Z',
  }))

  const result = spawnSync('node', [
    resolve(root, rootPackage.bin.deepcode),
    '--status',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCODE_CACHE_STATS_PATH: statsPath,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Stable prefix hash: [A-Za-z0-9_-]+/)
  assert.match(result.stdout, /Cache prefix: current=[A-Za-z0-9_-]+ last=unknown status=untracked/)
  assert.match(result.stdout, /Cache telemetry: last_hit=9 last_miss=1 last_hit_rate=90\.0%/)
  assert.match(result.stdout, /Cache telemetry: total_hit=90 total_miss=10 total_hit_rate=90\.0% requests=2/)
})

test('TUI status panel uses the shared Deep Code status adapter', () => {
  assert.match(settingsStatusSource, /buildDeepCodeStatusReport/)
  assert.match(settingsStatusSource, /deepCodeStatusReportToProperties/)
  assert.match(settingsStatusSource, /DeepSeek Status/)
})

test('source CLI entrypoint is branded for Deep Code and DeepSeek model env', () => {
  assert.match(mainSource, /program\.name\('deepcode'\)/)
  assert.match(mainSource, /Deep Code - starts an interactive session/)
  assert.match(mainSource, /DEEPSEEK_MODEL/)
  assert.match(mainSource, /DEEPCODE_MODEL/)
  assert.doesNotMatch(mainSource, /const explicitModel = options\.model \|\| process\.env\.ANTHROPIC_MODEL/)
})

test('print mode model metadata delegates through DeepSeek-aware defaults', () => {
  assert.match(printSource, /import \{ buildPrintModelInfos \}/)
  assert.match(printSource, /const modelInfos = buildPrintModelInfos\(\)/)
  assert.doesNotMatch(printSource, /const modelOptions = getModelOptions\(\)/)
  assert.match(printModelInfoSource, /getDefaultMainLoopModel\(\)/)
  assert.match(printModelInfoSource, /modelSupportsMaxEffort\(resolvedModel\)/)
})

test('full CLI and TUI assemble the real tool registry before DeepSeek requests', () => {
  assert.match(toolsSource, /export function assembleToolPool/)
  assert.match(toolsSource, /\[\.\.\.builtInTools\]\.sort\(byName\)\.concat\(allowedMcpTools\.sort\(byName\)\)/)
  assert.match(printSource, /const assembledTools = assembleToolPool\(/)
  assert.match(replSource, /const assembled = assembleToolPool\(state\.toolPermissionContext, state\.mcp\.tools\)/)
  assert.match(useMergedToolsSource, /const assembled = assembleToolPool\(toolPermissionContext, mcpTools\)/)
  assert.match(deepSeekCallModelSource, /const stablePrefix = await createDeepCodeStablePrefix\(\{/)
  assert.match(deepSeekCallModelSource, /tools,\s*\n\s*toolSchemaOptions,/)
})

test('managed environment constants include DeepSeek native routing variables', () => {
  for (const key of [
    'DEEPSEEK_API_KEY',
    'DEEPCODE_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPCODE_BASE_URL',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'DEEPSEEK_SMALL_MODEL',
    'DEEPCODE_SMALL_MODEL',
    'DEEPSEEK_THINKING',
    'DEEPCODE_THINKING',
    'DEEPSEEK_REASONING_EFFORT',
    'DEEPCODE_REASONING_EFFORT',
    'DEEPCODE_CACHE_USER_ID',
    'DEEPCODE_CACHE_STATS',
    'DEEPSEEK_CACHE_STATS',
    'DEEPCODE_CACHE_STATS_PATH',
  ]) {
    assert.match(managedEnvSource, new RegExp(`'${key}'`))
  }
})

test('Deep Code instruction loading prefers DEEPCODE.md and .deepcode with legacy fallback', () => {
  assert.match(claudemdSource, /createProjectInstructionPathPlan/)
  assert.match(claudemdSource, /processPreferredInstructionFiles/)
  assert.match(claudemdSource, /DEEPCODE\.md/)
  assert.match(claudemdSource, /\.deepcode\/rules/)
  assert.match(claudemdSource, /legacy Claude fallback/i)
  assert.match(configSource, /DEEPCODE_INSTRUCTION_FILE/)
  assert.match(configSource, /DEEPCODE_LOCAL_INSTRUCTION_FILE/)
  assert.match(projectOnboardingSource, /DEEPCODE_INSTRUCTION_FILE/)
  assert.doesNotMatch(projectOnboardingSource, /join\(getCwd\(\), 'CLAUDE\.md'\)/)
})

test('Deep Code project config directories prefer .deepcode with .claude fallback', () => {
  assert.match(settingsSource, /join\('\.deepcode', 'settings\.json'\)/)
  assert.match(settingsSource, /join\('\.deepcode', 'settings\.local\.json'\)/)
  assert.match(settingsSource, /getLegacySettingsFilePathForSource/)
  assert.match(markdownConfigLoaderSource, /DEEPCODE_PROJECT_DIR/)
  assert.match(markdownConfigLoaderSource, /LEGACY_CLAUDE_PROJECT_DIR/)
  assert.match(agentTypesSource, /FOLDER_NAME: '\.deepcode'/)
  assert.match(agentFileUtilsSource, /agent\.baseDir/)
  assert.match(skillsLoaderSource, /DEEPCODE_PROJECT_DIR/)
  assert.match(skillsLoaderSource, /LEGACY_CLAUDE_PROJECT_DIR/)
})
