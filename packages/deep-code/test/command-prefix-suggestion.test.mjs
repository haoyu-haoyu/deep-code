import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BARE_SHELL_PREFIXES,
  getFirstWordPrefix,
  getSimpleCommandPrefix,
} from '../src/tools/BashTool/commandPrefix.mjs'

// isAnt=false (external default) unless a test needs the ant safe-env behavior.
const simple = c => getSimpleCommandPrefix(c, false)
const first = c => getFirstWordPrefix(c, false)

test('THE FIX: getSimpleCommandPrefix never suggests a re-exec/escalation prefix', () => {
  // These all USED TO return a 2-word prefix (sudo systemctl, env sh, ...), which
  // when saved as Bash(<prefix>:*) auto-approves arbitrary root ops / code.
  for (const c of [
    'sudo systemctl restart nginx',
    'sudo apt purge foo',
    'env sh deploy.sh',
    'env bash -c "id"',
    'xargs bash run.sh',
    'eval rm -rf /',
    'watch rm -rf x',
    'coproc rm -rf x',
  ]) {
    assert.equal(simple(c), null, `getSimpleCommandPrefix should decline: ${c}`)
  }
})

test('getFirstWordPrefix also declines all re-exec/escalation first words', () => {
  for (const c of [
    'sudo systemctl restart nginx',
    'env sh deploy.sh',
    'xargs bash run.sh',
    'eval rm -rf /',
    'source ~/.bashrc',
    'watch rm -rf x',
    'coproc rm -rf x',
    'bash -c "evil"',
    'sh script.sh',
  ]) {
    assert.equal(first(c), null, `getFirstWordPrefix should decline: ${c}`)
  }
})

test('the two functions agree on rejecting BARE_SHELL_PREFIXES as the first word', () => {
  // Parity regression-lock: a single-command line whose first word is dangerous
  // must yield null from BOTH (the suggestion UI tries simple first, then first-word).
  for (const prefix of BARE_SHELL_PREFIXES) {
    const cmd = `${prefix} something here`
    assert.equal(simple(cmd), null, `simple(${cmd})`)
    assert.equal(first(cmd), null, `first(${cmd})`)
  }
})

test('legitimate commands still get a useful prefix (no regression)', () => {
  assert.equal(simple('git commit -m "fix typo"'), 'git commit')
  assert.equal(simple('npm run build'), 'npm run')
  assert.equal(simple('docker compose up -d'), 'docker compose')
  assert.equal(simple('kubectl get pods'), 'kubectl get')
  assert.equal(first('python3 file.py'), 'python3')
  assert.equal(first('cargo build'), 'cargo')
})

test('safe env-var prefixes are still skipped before extraction', () => {
  assert.equal(simple('NODE_ENV=prod npm run build'), 'npm run')
  assert.equal(simple('GOOS=linux GOARCH=arm64 go build ./...'), 'go build')
  assert.equal(first('NODE_ENV=prod python3 x.py'), 'python3')
  // non-safe env var -> null (can never match at check time)
  assert.equal(simple('MY_SECRET=val npm run build'), null)
  assert.equal(first('MY_SECRET=val python3 x.py'), null)
  // a safe env var in front of a DANGEROUS first word is still declined
  assert.equal(simple('NODE_ENV=prod sudo systemctl restart x'), null)
  assert.equal(first('NODE_ENV=prod bash -c evil'), null)
})

test('non-subcommand shapes still decline (flags / numbers / paths / filenames)', () => {
  assert.equal(simple('ls -la'), null)
  assert.equal(simple('chmod 755 file'), null)
  assert.equal(simple('cat file.txt'), null)
  assert.equal(first('./script.sh'), null)
  assert.equal(first('/usr/bin/python'), null)
})

test('eval and source ARE in the blocklist (arbitrary code / sourcing)', () => {
  assert.ok(BARE_SHELL_PREFIXES.has('eval'))
  assert.ok(BARE_SHELL_PREFIXES.has('source'))
  assert.ok(BARE_SHELL_PREFIXES.has('watch'))
  assert.ok(BARE_SHELL_PREFIXES.has('coproc'))
  assert.ok(BARE_SHELL_PREFIXES.has('sudo'))
  assert.ok(BARE_SHELL_PREFIXES.has('env'))
  assert.ok(BARE_SHELL_PREFIXES.has('xargs'))
})
