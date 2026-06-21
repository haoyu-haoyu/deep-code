import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod/v4/index.js'

import {
  isSafeMarketplaceGitRef,
  isSafeMarketplaceGitUrl,
} from '../src/utils/plugins/marketplaceGitSource.mjs'
import { relPathWithinBase } from '../src/utils/plugins/relPathWithinBase.mjs'

test('THE FIX: ext:: transport and other dangerous URLs are rejected', () => {
  assert.equal(isSafeMarketplaceGitUrl('ext::sh -c "touch /tmp/pwn"'), false)
  assert.equal(isSafeMarketplaceGitUrl('--upload-pack=touch /tmp/pwn'), false)
  assert.equal(isSafeMarketplaceGitUrl('-oProxyCommand=evil'), false)
  assert.equal(isSafeMarketplaceGitUrl('ssh://git@host/repo'), false) // only git@host: shorthand allowed
  assert.equal(isSafeMarketplaceGitUrl('fd::17/foo'), false)
  assert.equal(isSafeMarketplaceGitUrl('git://host/repo'), false)
  assert.equal(isSafeMarketplaceGitUrl(''), false)
  assert.equal(isSafeMarketplaceGitUrl('https://host/\0repo'), false)
  assert.equal(isSafeMarketplaceGitUrl(undefined), false)
})

test('legitimate git URLs are accepted (mirrors validateGitUrl)', () => {
  assert.equal(isSafeMarketplaceGitUrl('https://github.com/owner/repo.git'), true)
  assert.equal(isSafeMarketplaceGitUrl('http://internal.example/repo.git'), true)
  assert.equal(isSafeMarketplaceGitUrl('file:///srv/marketplaces/repo'), true)
  assert.equal(isSafeMarketplaceGitUrl('git@github.com:owner/repo.git'), true)
  assert.equal(isSafeMarketplaceGitUrl('git@gitlab.example.com:team/repo.git'), true)
})

test('THE FIX: leading-dash / traversal refs are rejected (option-injection guard)', () => {
  assert.equal(isSafeMarketplaceGitRef('--upload-pack=touch /tmp/pwn'), false)
  assert.equal(isSafeMarketplaceGitRef('-foo'), false)
  assert.equal(isSafeMarketplaceGitRef('/etc/passwd'), false)
  assert.equal(isSafeMarketplaceGitRef('../../evil'), false)
  assert.equal(isSafeMarketplaceGitRef('refs/heads/..'), false)
  assert.equal(isSafeMarketplaceGitRef('foo/./bar'), false)
  assert.equal(isSafeMarketplaceGitRef('foo//bar'), false)
  assert.equal(isSafeMarketplaceGitRef('foo bar'), false) // space (shell metachar)
  assert.equal(isSafeMarketplaceGitRef('foo;rm -rf'), false)
  assert.equal(isSafeMarketplaceGitRef('foo@{upstream}'), false) // '{' not in allowlist
  assert.equal(isSafeMarketplaceGitRef(''), false)
  assert.equal(isSafeMarketplaceGitRef(undefined), false)
})

test('legitimate refs are accepted (mirrors isSafeRefName)', () => {
  assert.equal(isSafeMarketplaceGitRef('main'), true)
  assert.equal(isSafeMarketplaceGitRef('v1.0.0'), true)
  assert.equal(isSafeMarketplaceGitRef('feature/foo'), true)
  assert.equal(isSafeMarketplaceGitRef('release-1.2.3+build'), true)
  assert.equal(isSafeMarketplaceGitRef('dependabot/npm_and_yarn/@types/node-18.0.0'), true)
})

// MIRROR-SCHEMA TEST (survey-51 / #591 lesson): a .refine() can be silently
// dropped by downstream chaining (.optional(), discriminatedUnion membership) so
// the leaf test passing does NOT prove the schema rejects bad input. Rebuild the
// exact git/github source shape under the REAL zod version and assert the refines
// fire through .refine().optional() inside a discriminatedUnion.
function buildMirrorUnion() {
  return z.discriminatedUnion('source', [
    z.object({
      source: z.literal('git'),
      url: z.string().refine(isSafeMarketplaceGitUrl),
      ref: z.string().refine(isSafeMarketplaceGitRef).optional(),
      path: z.string().refine(relPathWithinBase).optional(),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string(),
      ref: z.string().refine(isSafeMarketplaceGitRef).optional(),
      path: z.string().refine(relPathWithinBase).optional(),
    }),
  ])
}

test('MIRROR SCHEMA: discriminatedUnion + .refine().optional() rejects a malicious git source', () => {
  const schema = buildMirrorUnion()
  assert.equal(
    schema.safeParse({ source: 'git', url: 'ext::sh -c evil' }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      source: 'git',
      url: 'https://h/r.git',
      ref: '--upload-pack=evil',
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      source: 'git',
      url: 'https://h/r.git',
      path: '../../../../etc/passwd',
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      source: 'github',
      repo: 'owner/repo',
      ref: '--upload-pack=evil',
    }).success,
    false,
  )
})

test('MIRROR SCHEMA: a legitimate git/github source still validates', () => {
  const schema = buildMirrorUnion()
  assert.equal(
    schema.safeParse({
      source: 'git',
      url: 'https://github.com/owner/repo.git',
      ref: 'main',
      path: '.claude-plugin/marketplace.json',
    }).success,
    true,
  )
  assert.equal(
    schema.safeParse({ source: 'github', repo: 'owner/repo' }).success,
    true,
  )
  // omitted optional ref/path still pass (the refine must not fire on undefined)
  assert.equal(
    schema.safeParse({ source: 'git', url: 'git@github.com:owner/repo.git' })
      .success,
    true,
  )
})
