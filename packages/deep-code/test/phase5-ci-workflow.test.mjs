import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '..', '..')
const ciYamlPath = resolve(repoRoot, '.github/workflows/ci.yml')

test('CI workflow YAML exists and is non-empty', () => {
  assert.equal(existsSync(ciYamlPath), true, `expected ${ciYamlPath} to exist`)
  const content = readFileSync(ciYamlPath, 'utf8')
  assert.ok(content.length > 100, 'CI YAML must be non-trivial')
})

test('CI workflow runs every test file in packages/deep-code/test/*.test.mjs', () => {
  // Walk the test directory and assert every test file is referenced
  // somewhere in the CI YAML. A new test added without updating CI
  // would silently never run on PRs and could break in production.
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  const testFiles = readdirSync(resolve(packageRoot, 'test')).filter(
    name => name.endsWith('.test.mjs'),
  )
  // Files run via `bun test` instead of `node --test` shouldn't be in
  // the node-test list. tui-deepseek explicitly uses bun:test.
  const bunOnly = new Set(['tui-deepseek.test.mjs'])
  for (const file of testFiles) {
    if (bunOnly.has(file)) {
      assert.match(
        ciContent,
        new RegExp(`bun test test/${file.replace(/\./g, '\\.')}`),
        `${file} uses bun:test and must be invoked via "bun test" in CI`,
      )
      continue
    }
    assert.match(
      ciContent,
      new RegExp(`test/${file.replace(/\./g, '\\.')}`),
      `${file} is missing from the CI workflow node --test invocation`,
    )
  }
})

test('CI workflow has a perf-baseline regression gate', () => {
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  assert.match(
    ciContent,
    /perf-baseline:/,
    'CI must define a perf-baseline job',
  )
  assert.match(
    ciContent,
    /perf-compare\.mjs/,
    'perf-baseline job must invoke perf-compare.mjs',
  )
  assert.match(
    ciContent,
    /--threshold=0\.20/,
    'CI must use the documented 20% regression threshold',
  )
})

test('CI workflow gates perf-baseline on pull_request only', () => {
  // Pushes to main don't have a meaningful "before" baseline to
  // diff against; perf-baseline only makes sense on PRs.
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  assert.match(
    ciContent,
    /if:\s*github\.event_name == 'pull_request'/,
    "perf-baseline job must be gated on pull_request",
  )
})

test('CI workflow uploads diff artifacts for human review', () => {
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  assert.match(
    ciContent,
    /upload-artifact@/,
    'must upload baseline + diff artifacts',
  )
  assert.match(ciContent, /perf-base\.json/)
  assert.match(ciContent, /perf-head\.json/)
  assert.match(ciContent, /perf-diff\.json/)
})

test('CI compare step uses bash + pipefail so tee does not mask exit codes', () => {
  // Codex caught: `node ... | tee ...` under the default bash -e
  // shell drops the script's non-zero exit because pipefail isn't
  // set. Without this, regressions detected by perf-compare would
  // silently pass CI.
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  assert.match(
    ciContent,
    /shell:\s*bash[\s\S]{0,400}set -o pipefail[\s\S]{0,400}perf-compare\.mjs/,
    'compare step must use shell:bash + set -o pipefail before piping perf-compare through tee',
  )
})

test('CI PR-comment step has full fork-PR / pagination hardening', () => {
  // Codex caught: forked PRs / Dependabot get read-only GITHUB_TOKEN,
  // so listComments/createComment 403s. Without continue-on-error,
  // the perf-baseline JOB result would be wrong (failing on
  // permission, not on regressions). Plus the listComments default
  // page size of 30 lets a long-running PR's bot comment fall off
  // page 1 and we'd post duplicates instead of updating.
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  const stepIdx = ciContent.indexOf('Comment perf diff on PR')
  assert.ok(stepIdx >= 0, 'Comment-perf-diff step missing')
  // Widen the slice to cover the full inline script body — the step
  // contains the multi-line github-script `script:` block which is
  // a few thousand chars long once try/catch + paginate + filter
  // logic is in place.
  const stepBody = ciContent.slice(stepIdx)

  // Job-level safety: continue-on-error so a 403 doesn't fail the
  // perf-baseline job result. The previous compare step already
  // determined pass/fail.
  assert.match(
    stepBody,
    /continue-on-error:\s*true/,
    'PR comment step must be marked continue-on-error',
  )

  // Script-level safety: explicit try/catch with core.warning so
  // we don't bubble a thrown 403 even if continue-on-error is
  // accidentally removed.
  assert.match(
    stepBody,
    /try\s*\{/,
    'comment script must wrap API calls in try/catch',
  )
  assert.match(
    stepBody,
    /core\.warning\(/,
    'comment script must log a warning on failure (not throw)',
  )

  // Pagination: listComments default is per_page=30; a long PR's
  // bot comment can fall off page 1.
  assert.match(
    stepBody,
    /github\.paginate\(\s*github\.rest\.issues\.listComments/,
    'must use github.paginate to find the bot comment past page 1',
  )

  // Author filter: a real human can post a comment whose body
  // STARTS WITH the marker (HTML comments are valid in PR comments).
  // The bot-author filter prevents that from shadowing the real
  // bot comment.
  assert.match(
    stepBody,
    /c\.user\s*&&\s*\(c\.user\.type\s*===\s*'Bot'/,
    'must filter listComments to bot-authored entries by user.type',
  )
  assert.match(
    stepBody,
    /github-actions\[bot\]/,
    'must accept the github-actions[bot] login as the bot author',
  )
})

test('CI checks out the merge commit, not the head branch tip', () => {
  // Codex caught: comparing pull_request.base.sha vs head.sha tests
  // the head branch in isolation. The PR is merged via a test-merge
  // commit (github.sha on pull_request events) — that's what should
  // actually be benchmarked.
  const ciContent = readFileSync(ciYamlPath, 'utf8')
  assert.match(
    ciContent,
    /ref:\s*\$\{\{\s*github\.sha\s*\}\}/,
    'head checkout must use github.sha (the merge commit) for accurate perf vs base',
  )
})
