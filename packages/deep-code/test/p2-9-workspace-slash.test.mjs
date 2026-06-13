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
import { replaceAllLiteral } from '../src/utils/literalReplace.mjs'

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

test('renderWorkspaceCommandPrompt inserts $-special args literally (no $&/$$ corruption)', () => {
  const command = {
    name: 'note',
    promptTemplate: 'note: $ARGUMENTS done',
    source: 'deepcode',
    filePath: '/tmp/note.md',
  }
  // The user value is spliced verbatim — $$ must not collapse to $, $& must not
  // inject the matched $ARGUMENTS token, $`/$' must not inject surrounding text.
  assert.equal(renderWorkspaceCommandPrompt(command, 'cost $$5'), 'note: cost $$5 done')
  assert.equal(renderWorkspaceCommandPrompt(command, 'a$&b'), 'note: a$&b done')
  assert.equal(renderWorkspaceCommandPrompt(command, "x$'y"), "note: x$'y done")
  assert.equal(renderWorkspaceCommandPrompt(command, 'p$`q'), 'note: p$`q done')
  // plain args are unchanged (no behavior change for the common case)
  assert.equal(renderWorkspaceCommandPrompt(command, 'world'), 'note: world done')
})

test('replaceAllLiteral splices $-special values verbatim for string and global-regex search', () => {
  // string search → every literal occurrence, value inserted verbatim
  assert.equal(replaceAllLiteral('a $X b $X', '$X', 'cost $$5'), 'a cost $$5 b cost $$5')
  assert.equal(replaceAllLiteral('<$X>', '$X', '$&'), '<$&>')
  assert.equal(replaceAllLiteral('<$X>', '$X', "$'"), "<$'>")
  assert.equal(replaceAllLiteral('<$X>', '$X', '$`'), '<$`>')
  assert.equal(replaceAllLiteral('<$X>', '$X', '$1'), '<$1>')
  // global-regex search (the named-arg path) → every match, value literal
  assert.equal(
    replaceAllLiteral('$n and $n', /\$n(?![\[\w])/g, 'a$&b'),
    'a$&b and a$&b',
  )
  // the ${CLAUDE_SKILL_DIR} / ${CLAUDE_SESSION_ID} substitution pattern: a skill
  // path containing a $-special must be spliced verbatim, not interpreted.
  assert.equal(
    replaceAllLiteral(
      'cd ${CLAUDE_SKILL_DIR}/run',
      /\$\{CLAUDE_SKILL_DIR\}/g,
      '/skills/a$&b',
    ),
    'cd /skills/a$&b/run',
  )
  // plain value unchanged
  assert.equal(replaceAllLiteral('x $X y', '$X', 'V'), 'x V y')
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
