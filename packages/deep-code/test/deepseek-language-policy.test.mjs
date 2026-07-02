import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldEmitDeepSeekLanguagePolicy } from '../src/constants/deepSeekLanguagePolicy.mjs'

// getLanguageSection (src/constants/prompts.ts) emits the configured
// "Always respond in <lang>" section iff `!!languagePreference`. The gate must
// be its exact complement so exactly one reply-language directive is ever
// emitted: emit the DeepSeek "follow the message language" policy iff NO
// language is configured; suppress it (defer to the configured section) when a
// language IS configured.
const getLanguageSectionEmits = languagePreference => !!languagePreference

test('no configured language → emit the DeepSeek "follow message language" policy', () => {
  assert.equal(shouldEmitDeepSeekLanguagePolicy(undefined), true)
  assert.equal(shouldEmitDeepSeekLanguagePolicy(null), true)
  assert.equal(shouldEmitDeepSeekLanguagePolicy(''), true)
})

test('a configured language wins → suppress the DeepSeek policy', () => {
  assert.equal(shouldEmitDeepSeekLanguagePolicy('中文'), false)
  assert.equal(shouldEmitDeepSeekLanguagePolicy('English'), false)
  assert.equal(shouldEmitDeepSeekLanguagePolicy('Español'), false)
  assert.equal(shouldEmitDeepSeekLanguagePolicy('fr'), false)
})

test('EXACTLY-ONE invariant: the gate is the strict complement of getLanguageSection', () => {
  // If both were on (or both off), the user would see two contradictory (or
  // zero) reply-language directives. Prove complementarity across the same
  // inputs getLanguageSection branches on.
  const inputs = [undefined, null, '', '中文', 'English', 'Español', 'fr', ' ', '0']
  for (const input of inputs) {
    const deepSeekPolicyOn = shouldEmitDeepSeekLanguagePolicy(input)
    const configuredSectionOn = getLanguageSectionEmits(input)
    assert.notEqual(
      deepSeekPolicyOn,
      configuredSectionOn,
      `exactly one directive must fire for input ${JSON.stringify(input)}`,
    )
  }
})

test('returns a real boolean', () => {
  assert.equal(typeof shouldEmitDeepSeekLanguagePolicy('中文'), 'boolean')
  assert.equal(typeof shouldEmitDeepSeekLanguagePolicy(undefined), 'boolean')
})
