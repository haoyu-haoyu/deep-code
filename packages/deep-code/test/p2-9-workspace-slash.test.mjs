import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createWorkspaceSlashCommands,
  loadWorkspaceCommands,
  mergeWorkspaceSlashCommands,
  renderWorkspaceCommandPrompt,
  resetWorkspaceCommandWarningsForTests,
} from '../src/commands/workspaceSlashLoader.mjs'

test('loadWorkspaceCommands loads .deepcode command markdown', async () => {
  const workspaceRoot = await createWorkspace()
  await writeCommand(workspaceRoot, '.deepcode', 'foo', 'Hello from workspace')

  const commands = await loadWorkspaceCommands(workspaceRoot)

  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'foo')
  assert.equal(commands[0].promptTemplate, 'Hello from workspace')
  assert.equal(commands[0].source, 'deepcode')
  assert.equal(commands[0].filePath, join(workspaceRoot, '.deepcode', 'commands', 'foo.md'))
})

test('$ARGUMENTS substitution happens at execution time', async () => {
  const command = {
    name: 'hello',
    promptTemplate: 'Hello $ARGUMENTS',
    source: 'deepcode',
    filePath: '/tmp/hello.md',
  }

  assert.equal(renderWorkspaceCommandPrompt(command, 'world'), 'Hello world')

  const [slashCommand] = createWorkspaceSlashCommands([command])
  const prompt = await slashCommand.getPromptForCommand('again', {})

  assert.deepEqual(prompt, [{ type: 'text', text: 'Hello again' }])
})

test('source priority is .deepcode > .cursor > .claude for duplicate names', async () => {
  const workspaceRoot = await createWorkspace()
  await writeCommand(workspaceRoot, '.claude', 'dupe', 'legacy')
  await writeCommand(workspaceRoot, '.cursor', 'dupe', 'cursor')
  await writeCommand(workspaceRoot, '.deepcode', 'dupe', 'deepcode')

  const commands = await loadWorkspaceCommands(workspaceRoot)

  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'dupe')
  assert.equal(commands[0].promptTemplate, 'deepcode')
  assert.equal(commands[0].source, 'deepcode')
})

test('legacy .claude command warning is emitted once per session', async () => {
  resetWorkspaceCommandWarningsForTests()
  const workspaceRoot = await createWorkspace()
  await writeCommand(workspaceRoot, '.claude', 'one', 'legacy one')
  await writeCommand(workspaceRoot, '.claude', 'two', 'legacy two')
  const warnings = []

  await loadWorkspaceCommands(workspaceRoot, { warn: message => warnings.push(message) })
  await loadWorkspaceCommands(workspaceRoot, { warn: message => warnings.push(message) })

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /\.claude\/commands/)
})

test('missing command directories return an empty list', async () => {
  const workspaceRoot = await createWorkspace()

  assert.deepEqual(await loadWorkspaceCommands(workspaceRoot), [])
})

test('empty markdown command files are skipped', async () => {
  const workspaceRoot = await createWorkspace()
  await writeCommand(workspaceRoot, '.deepcode', 'empty', '   \n')

  assert.deepEqual(await loadWorkspaceCommands(workspaceRoot), [])
})

test('workspace commands shadow existing commands and warn', () => {
  const warnings = []
  const existing = [{
    description: 'built-in help',
    name: 'help',
    type: 'local',
    supportsNonInteractive: true,
    load: async () => ({ call: async () => ({ type: 'text', value: 'help' }) }),
  }]
  const workspace = [{
    filePath: '/tmp/help.md',
    name: 'help',
    promptTemplate: 'workspace help',
    source: 'deepcode',
  }]

  const merged = mergeWorkspaceSlashCommands(existing, workspace, {
    warn: message => warnings.push(message),
  })

  assert.equal(merged.length, 1)
  assert.equal(merged[0].name, 'help')
  assert.equal(merged[0].type, 'prompt')
  assert.equal(merged[0].source, 'projectSettings')
  assert.match(warnings[0], /shadows existing command/)
})

test('mock workspace command appears in merged command list for autocomplete', async () => {
  const workspaceRoot = await createWorkspace()
  await writeCommand(workspaceRoot, '.deepcode', 'test', 'Run test')
  const workspace = await loadWorkspaceCommands(workspaceRoot)

  const merged = mergeWorkspaceSlashCommands([], workspace)

  assert.equal(merged.some(command => command.name === 'test'), true)
})

async function createWorkspace() {
  return await mkdtempCompat('deepcode-workspace-slash-')
}

async function mkdtempCompat(prefix) {
  const { mkdtemp } = await import('node:fs/promises')
  return await mkdtemp(join(tmpdir(), prefix))
}

async function writeCommand(workspaceRoot, configDir, name, body) {
  const commandsDir = join(workspaceRoot, configDir, 'commands')
  await mkdir(commandsDir, { recursive: true })
  await writeFile(join(commandsDir, `${name}.md`), body, 'utf8')
}
