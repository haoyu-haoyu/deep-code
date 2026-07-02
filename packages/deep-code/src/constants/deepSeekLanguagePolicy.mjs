// Whether to emit the DeepSeek "reply in the language of the user's most recent
// message" policy section (getDeepSeekLanguagePolicySection).
//
// The fork ADDED that always-on policy without reconciling the pre-existing,
// configurable `getLanguageSection(settings.language)` section ("Always respond
// in <lang>"). When the user has explicitly configured a response language, the
// two land in the same system prompt as CONTRADICTORY reply-language directives
// ("follow the message language" vs "always respond in <lang>"), so the explicit
// preference can be silently overridden by the always-on policy.
//
// The user's explicit configuration WINS: when a language is configured we
// suppress the "follow the message language" policy and defer to the configured
// section. When no language is configured, the DeepSeek policy is the only
// reply-language directive and stays on.
//
// The truthiness test mirrors getLanguageSection's own gate (`if
// (!languagePreference) return null`) EXACTLY, so the two are complementary and
// exactly one reply-language directive is ever emitted: an unset/empty string
// yields the DeepSeek policy, a real language string yields the configured one.
//
// @param {string|undefined|null} configuredLanguage settings.language
// @returns {boolean} true when the DeepSeek "follow message language" policy should be emitted
export function shouldEmitDeepSeekLanguagePolicy(configuredLanguage) {
  return !configuredLanguage
}
