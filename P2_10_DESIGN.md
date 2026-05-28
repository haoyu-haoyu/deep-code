# P2.10 i18n scan and path recommendation

Last updated: 2026-05-28
Status: scan PR
Scope: Phase 2 deferred i18n feature
Target locales: `en`, `zh-Hans`, `ja`
Recommended path: Path D - phased extraction and locale rollout

## Executive summary

P2.10 is the only Phase 2 feature still deferred after Phase 2 sign-off.
The original plan asks for minimum UI localization for English, Simplified Chinese, and Japanese.
The current tree has locale-adjacent utilities, but no active UI translation framework.
No `src/i18n/` directory was found.
No `locales/` directory was found under `packages/deep-code/src`.
No `react-intl`, `i18next`, `useTranslation`, or `IntlProvider` usage was found.
`packages/deep-code/src/utils/intl.ts` is a native `Intl` cache, not a message catalog.
`packages/deep-code/src/components/LanguagePicker.tsx` controls model response and voice language, not UI locale.
`settings.language` is a free-form response-language preference and should not become UI locale.
Recommended new persisted UI setting: `settings.locale`.
The extraction surface is broad enough that one PR would be risky.
The scan found 1,735 TS/TSX source files under `packages/deep-code/src`.
The scan found 366 TS/TSX files under `src/components`, 186 under `src/tools`, and 142 under `src/commands`.
The scan found 211 files with obvious JSX `<Text>literal</Text>` matches in component, command, and screen directories.
The scan found 151 files with likely user-facing `label`, `description`, `placeholder`, `question`, or `title` properties.
The scan found 802 files with broad error/help/permission candidate strings.
The broad combined grep found 747 files with likely user-facing string sites.
These are grep indicators, not final AST extraction counts.
After de-duplication, the likely catalog surface is 700-1,100 keys.
The first implementation should still migrate only the top 50 strings.
Recommended path: Path D with Path A as the initial runtime.
Path D gives the project small reviewable PRs.
Path A gives the first implementation a typed TS catalog with no dependency.
Path C can be introduced later if plural/select formatting becomes necessary.
Path B should wait until real catalog pressure justifies dependency weight.

## Scan methodology

The requested `rg --type ts --type tsx` shape is not portable in this checkout because `tsx` is not registered as a ripgrep file type here.
Equivalent scans used explicit globs:
```bash
rg -n "pattern" packages/deep-code/src -g '*.ts' -g '*.tsx'
```
The scan used grep, not an AST extractor.
The scan intentionally did not edit source, tests, or dist.
The scan counted source reality as stored in this repository.
The scan treated inline source maps as noisy.
The scan grouped candidates by feature area.
The scan did not translate strings.
The scan did not classify every candidate as user-facing.

## Phase A - Existing i18n inventory

### A1. Current locale infrastructure

Current state:
- No active message catalog exists.
- No active locale catalog directory exists.
- No active React i18n provider exists.
- No active command-line locale resolver exists.
- No active settings field dedicated to UI locale exists.
- No active `/lang` or `/locale` command exists.
- No package-level i18n dependency was detected by source/package grep.

Existing locale-adjacent file:
```text
packages/deep-code/src/utils/intl.ts
```
`utils/intl.ts` currently caches native `Intl` objects for grapheme segmentation, word segmentation, relative time formatting, timezone discovery, and system locale language discovery.
It is useful for Unicode editing and formatting.
It is not a UI text translation layer.
It does not expose `t()`.
It does not own catalogs.
It does not persist locale.
It does not choose UI language.
It can help P2.10 by exposing system locale discovery.
Its `getSystemLocaleLanguage()` only returns a language subtag.
That is insufficient for distinguishing `zh-Hans` from `zh-Hant`.
P2.10 should add a dedicated locale resolver.

Existing fixed English formatting calls include:
- `Intl.RelativeTimeFormat('en', ...)` in `utils/intl.ts`.
- `new Intl.NumberFormat('en-US')` in `utils/format.ts`.
- `date.toLocaleString('en-US', ...)` in `utils/format.ts`.
- `date.toLocaleTimeString('en-US', ...)` in `utils/cron.ts`.
- `toLocaleDateString('en-US', ...)` in component and command code.
- `toLocaleString()` without locale in runtime stats and diagnostics.
These are formatting concerns, not message translation.
They should not block the first scaffold PR.

### A1.1 LanguagePicker audit

Existing file:
```text
packages/deep-code/src/components/LanguagePicker.tsx
```
Current prompt text:
```text
Enter your preferred response and voice language:
```
Current empty-state text:
```text
Leave empty for default (English)
```
The component receives `initialLanguage`, `onComplete`, and `onCancel`.
It stores free-form text, not a closed locale enum.
It is wired into the settings screen through setting id `language`.
The settings row label is currently `Language`.
The setting persists as `settings.language`.
This setting affects assistant response language.
It does not localize UI chrome, slash-command descriptions, settings labels, tool permission prompts, or doctor output.
P2.10 should avoid reusing `settings.language` for UI locale.
Recommended new persisted field: `settings.locale`.
Alternative field: `settings.uiLocale`.
Preferred field: `locale`, because it maps directly to BCP 47 locale tags.

### A1.2 settings.language audit

Existing file:
```text
packages/deep-code/src/utils/settings/types.ts
```
The schema describes `language` as preferred language for responses and voice.
Existing file:
```text
packages/deep-code/src/tools/ConfigTool/supportedSettings.ts
```
The config tool exposes the same setting description.
Existing file:
```text
packages/deep-code/src/constants/prompts.ts
```
The helper `getLanguageSection(settings.language)` injects a model instruction:
```text
Always respond in ${languagePreference}.
```
This is prompt behavior, not UI behavior.
P2.10 should preserve this behavior.
Future settings UI should distinguish `Response language` from `UI locale`.

### A1.3 Environment signals

The original P2.10 plan mentions `LC_ALL`, `LANG`, settings, and `--locale`.
The current tree already passes through locale-related environment variables.
Observed environment names: `LANG`, `LANGUAGE`, `LC_ALL`.
This helps subprocess behavior but does not localize the app UI.
P2.10 should add locale detection in app startup.
Detection should not rely solely on shell environment passthrough.

### A1.4 Current user-facing sources

Main command registry:
```text
packages/deep-code/src/commands.ts
```
Command subtree:
```text
packages/deep-code/src/commands/
```
Component subtree:
```text
packages/deep-code/src/components/
```
Tool subtree:
```text
packages/deep-code/src/tools/
```
Settings screen:
```text
packages/deep-code/src/components/Settings/Config.tsx
```
Doctor screen:
```text
packages/deep-code/src/screens/Doctor.tsx
```
Doctor CLI checks:
```text
packages/deep-code/src/cli/handlers/doctorChecks.mjs
```
Restore command:
```text
packages/deep-code/src/commands/restore/
```
Cache status UI:
```text
packages/deep-code/src/components/CacheStatusChip.tsx
```
Provider and runtime messages:
```text
packages/deep-code/src/services/runtime/
```
The implementation must work for Ink UI, non-interactive CLI output, and tool messages.
It must not translate model prompts unless explicitly scoped.
It must not translate telemetry event names, analytics metadata keys, command ids, tool ids, permission rule syntax, or JSON schema keys.

### A2. Locale candidates

Initial required locales:
- `en`.
- `zh-Hans`.
- `ja`.
`en` should be the canonical source catalog, default locale, and fallback.
`zh-Hans` should be Simplified Chinese.
`ja` should be Japanese.
Possible later locales:
- `zh-Hant`.
- `es`.
- `fr`.
- `de`.
- `ko`.
`zh-CN`, `zh-SG`, and bare `zh` can map to `zh-Hans`.
`zh-TW`, `zh-HK`, and `zh-MO` can map to `zh-Hant` later.
`ja-JP` can map to `ja`.
Unrecognized locales should fall back to `en`.

### A3. String extraction surface

This section uses grep indicators, not a final extraction manifest.
Obvious JSX text sites:
- 874 direct `<Text>literal</Text>` matches in sampled UI directories.
- 211 files containing those matches.
Obvious property string sites:
- 518 `label`, `description`, `placeholder`, `question`, or `title` matches.
- 151 files containing those matches.
Broad error/help candidates:
- 8,217 raw matches using broad error/help/permission terms.
- 802 files containing those matches.
Combined likely user-facing candidates:
- 4,971 raw matches using JSX, property, message, error, and debug terms.
- 747 files containing those matches.
False positives include tests, internal errors, telemetry labels, debug logs, model prompt text, parser messages, and protocol strings.
Estimated post-dedupe catalog size:
- Low estimate: 700 keys.
- Medium estimate: 900 keys.
- High estimate: 1,100 keys.
Estimated first extraction batch:
- 50 keys.
Estimated total file touch over full P2.10:
- 120-180 source and test files before dist refresh.

### A3.1 Component JSX text

High-impact components include `HelpV2`, `Settings/Config`, `LanguagePicker`, `ThemePicker`, `OutputStylePicker`, `DiagnosticsDisplay`, `TokenWarning`, `ApproveApiKey`, `InvalidSettingsDialog`, `ManagedSettingsSecurityDialog`, `MCPSettings`, `MCPListPanel`, `TaskListV2`, `Stats`, `AutoUpdater`, `CacheStatusChip`, and `BackgroundTaskStatus`.
Component extraction should start with stable labels.
Highly dynamic composed strings should wait for interpolation support.
User-visible text should not change except through lookup plumbing.

### A3.2 Tool output messages

Tool surfaces include `FileEditTool`, `FileWriteTool`, `FileReadTool`, `BashTool`, `GrepTool`, `GlobTool`, `TaskCreateTool`, `TodoWriteTool`, `SkillTool`, `ConfigTool`, and `MCPTool`.
Tool output messages can be user-facing.
Tool names and tool ids are protocol-facing.
Tool names and tool ids should not be translated.
Permission prompts should be translated only after the catalog is stable.
Prompt body strings used to steer models should not be translated as UI chrome.

### A3.3 Doctor, cache, restore, provider, and help

Doctor surfaces include `screens/Doctor.tsx` and `doctorChecks.mjs`.
Doctor output includes both human labels and diagnostic identifiers.
Diagnostic identifiers should remain stable.
Human-readable check names can be translated.
Machine-readable JSON keys must not be translated.
Cache surfaces include `CacheStatusChip` and cache inspection output.
Restore surfaces include `commands/restore`.
Provider surfaces include setup, login, missing key, and invalid config copy.
Help surfaces include `/help`, command descriptions, and shortcut labels.
Slash command names and aliases should remain untranslated.
Slash command descriptions can be translated.
Usage examples should preserve literal command names.

### A3.4 Settings descriptions

Settings surfaces include UI labels, help text, `ConfigTool` descriptions, and some schema `.describe()` text.
Some schema descriptions are developer-facing.
P2.10 should classify settings descriptions before extraction.
The existing `language` setting should not become UI locale.
Possible UI wording: `Response language` and `UI locale`.

### A3.5 Phase 2 feature strings

Priority Phase 2 surfaces:
- Auto router footer.
- Cache status chip.
- `/provider` command.
- `/restore` dialog.
- `/cache` output.
- `/doctor` checks.
- Runtime provider diagnostics.
- DeepSeek setup and validation messages.
These should be early extraction candidates because they define the Phase 2 feature-parity experience.

### A4. Build pipeline considerations

Current full bundle baseline:
```text
packages/deep-code/dist/deepcode-full.mjs = 14,458,895 bytes
```
The scan PR must not refresh dist.
The Bun bundle can handle TS modules and JSON imports.
TS catalogs give better key safety than JSON.
Recommended initial catalog layout:
```text
src/i18n/index.ts
src/i18n/locales.ts
src/i18n/types.ts
src/i18n/messages/en.ts
```
Recommended later catalog files:
```text
src/i18n/messages/zh-Hans.ts
src/i18n/messages/ja.ts
```
Recommended first runtime:
```text
t('settings.language.label')
```
Recommended interpolation shape:
```text
t('restore.snapshot.count', { count })
```
Recommended fallback behavior:
- Missing active-locale key falls back to `en`.
- Missing `en` key throws in tests.
- Missing `en` key renders a safe fallback in production.
Recommended catalog loading:
- Bundle `en` by default.
- Lazy-load `zh-Hans`.
- Lazy-load `ja`.
Fallback option:
- Bundle all three catalogs if dynamic import complicates Bun output.
CI should eventually assert key completeness, no unknown keys, placeholder parity, and no duplicate key definitions.

## Phase B - Path options

### Path A - Minimal lookup-based message catalog

Path A creates one typed catalog runtime.
It can start with a single English catalog.
It can store locales as TS objects.
It can expose `getMessage(key, locale, params)`.
It can expose `t(key, params)` through React context.
It can expose `translate(locale, key, params)` for non-React code.
It avoids new dependencies.
It keeps bundle size small.
It is easy to review and test.
It matches the original simple key-based P2.10 spec.
Cons: manual key tracking, limited plural rules, limited number/date formatting integration, local interpolation maintenance, and local catalog checks.
Path A is the recommended initial runtime.

### Path B - react-intl or i18next library

Path B adopts a mature i18n library with plural rules, select rules, locale-aware formatting, established patterns, and ecosystem tooling.
Costs include dependency weight, provider patterns, library lock-in, non-React command integration, and possible Bun bundle complexity.
Expected dependency impact: roughly 100-200KB before catalogs.
Path B is not recommended as the first PR.
It remains viable if P2.10 grows into plural-heavy UI.

### Path C - Hybrid ICU MessageFormat plus custom helper

Path C uses ICU syntax with a smaller runtime.
Benefits include plural support, select support, number/date formatting, and less weight than a full framework.
Costs include custom integration, ICU learning overhead, harder validation, placeholder review, and performance measurement.
Path C is a good second-stage upgrade if Path A hits plural limits.

### Path D - Phased extraction first, catalogs later

Path D is an implementation sequence:
- D.1 extracts English strings.
- D.2 adds translation helpers and provider.
- D.3 migrates components and commands in batches.
- D.4 adds `zh-Hans`.
- D.5 adds `ja`.
- D.6 adds locale selection and persistence.
- D.7 adds coverage and CI checks.
- D.8 refreshes dist.
Pros: lower review risk, focused PRs, early key-drift tests, evidence-based runtime choice, stable translation timing, and consistency with previous phased work.
Cons: more PRs, temporary mixed English/localized state, and need for discipline around new hard-coded strings.
Path D is recommended.

## Phase C - Recommended path and rationale

Recommendation:
```text
Path D with Path A as the initial runtime.
```
This means:
- Start with typed TS catalogs.
- Start with English only.
- Add a small runtime helper.
- Migrate strings in batches.
- Add `zh-Hans` and `ja` after key shape stabilizes.
- Add locale picker and persistence after translation behavior exists.
Rationale:
- The scope is large.
- The grep scan indicates hundreds of candidate files.
- English extraction is independently valuable.
- The first 50 strings will reveal whether simple interpolation is enough.
- Path C can be introduced if plural pressure appears.
- Existing `LanguagePicker` has conflicting semantics.
- Existing `settings.language` must remain response-language preference.
- The repo has already succeeded with scan and phased sub-PR patterns.

## Phase D - Sub-PR breakdown for Path D

### P2.10.scan - this PR

Deliverable: create `P2_10_DESIGN.md`, inventory current i18n infrastructure, estimate string extraction surface, recommend path, define sub-PR plan, and avoid source/test/dist edits.
File count: 1 file.

### P2.10.a - i18n scaffold and first English catalog

Deliverable:
- Choose initial runtime posture, recommended Path A.
- Create `src/i18n/index.ts`, `src/i18n/types.ts`, `src/i18n/locales.ts`, and `src/i18n/messages/en.ts`.
- Add `t()` or `translate()` helper.
- Add test-only key completeness helpers.
- Extract first batch of around 50 strings.
- Add node:test coverage.
Candidate first strings: settings labels, settings descriptions, LanguagePicker copy, help headings, restore dialog titles, cache chip text, doctor headings, and provider setup strings.
Estimated files: 8-15 source files and 2-4 test files.

### P2.10.b.1 - component migration: messages and status

Deliverable: migrate message rendering copy, status footer copy, cache chip copy, token warning copy, and diagnostics display copy.
Estimated files: 10-18 source files and 2-4 test files.

### P2.10.b.2 - component migration: prompt input and settings

Deliverable: migrate PromptInput UI labels, settings labels, settings help text, separate `language` and `locale` labels, and keep response-language behavior unchanged.
Estimated files: 12-20 source files and 2-5 test files.

### P2.10.b.3 - slash commands and help

Deliverable: migrate command descriptions, `/help` output, command usage text, and preserve command names, aliases, and machine-readable identifiers.
Estimated files: 20-35 source files and 3-6 test files.

### P2.10.b.4 - tools and permission prompts

Deliverable: migrate tool user-facing descriptions, permission prompt labels, and user-facing ConfigTool descriptions while preserving tool ids, model prompt bodies, telemetry, and analytics event names.
Estimated files: 20-35 source files and 4-8 test files.

### P2.10.b.5 - remaining UI strings

Deliverable: migrate remaining high-confidence UI strings, auth/setup copy, update/install copy, and MCP settings copy while leaving low-confidence internal exceptions for later.
Estimated files: 25-45 source files and 4-8 test files.

### P2.10.c - zh-Hans catalog

Deliverable:
- Add `zh-Hans` catalog.
- Add locale normalization for `zh`, `zh-CN`, and `zh-SG`.
- Add tests for fallback, interpolation, and missing keys.
Translation process: machine translation may seed the catalog, but human review is required before sign-off.
Estimated files: 3-8 source files and 2-5 test files.

### P2.10.d - ja catalog

Deliverable:
- Add `ja` catalog.
- Add locale normalization for `ja-JP`.
- Add tests for fallback and interpolation.
- Review technical terms for Japanese CLI norms.
Translation process: machine translation may seed the catalog, but human review is required before sign-off.
Estimated files: 3-8 source files and 2-5 test files.

### P2.10.e - locale switcher and persistence

Deliverable:
- Add `/locale` or `/lang` command.
- Add UI locale picker.
- Integrate with settings and persist selected locale.
- Support command-line `--locale`.
- Support environment detection from `LC_ALL` and `LANG`.
- Keep `settings.language` for response language.
- Add `settings.locale` for UI locale.
LanguagePicker decision: do not repurpose existing `LanguagePicker` directly; either rename it to `ResponseLanguagePicker` or create a new `LocalePicker`.
Estimated files: 12-25 source files and 4-8 test files.

### P2.10.test - comprehensive i18n coverage

Deliverable: key completeness test, interpolation placeholder parity test, fallback test, locale detection test, command-line override test, settings persistence test, selected `zh-Hans` smoke tests, and selected `ja` smoke tests.
Estimated files: 6-12 test files and 2-4 helper files.

### P2.10.Z - dist refresh

Deliverable: refresh generated dist only after source and tests settle, measure bundle size delta, and record catalog impact.
Expected bundle impact: `en` likely under 30KB, three catalogs likely 30-100KB, Path B library likely another 100-200KB.

### P2.10.cite - close P2.10

Deliverable: update execution log, cite implementation PRs, close P2.10, and record deferred locale follow-ups.
Estimated PR count: minimum 10, likely 12, upper range 15.
Estimated effort: around 1 week if translation review is available; longer if review blocks `zh-Hans` or `ja`.

## Phase E - Risk assessment

### Bundle size impact

Risk: message catalogs add bundle size.
Current baseline: `deepcode-full.mjs` is 14,458,895 bytes.
Expected catalog delta: 30-100KB for `en`, `zh-Hans`, and `ja`.
Expected dependency delta: 0KB for Path A and roughly 100-200KB for Path B.
Mitigation: use Path A first, bundle `en` by default, lazy-load `zh-Hans` and `ja`, and measure at P2.10.Z.

### Translation quality

Risk: machine translation can produce unnatural CLI copy, technical terms can be mistranslated, and command names or flags can be localized incorrectly.
Mitigation: keep command names in English, keep code identifiers unchanged, create a glossary, require human review, and keep English fallback.

### Key drift

Risk: new hard-coded user-facing strings can appear after migration starts.
Mitigation: add CI grep or AST checks after scaffold, allow explicit internal-string ignores, require `t()` for migrated subtrees, and use English catalog keys as source of truth.

### Performance

Risk: translation lookup can run on every render.
Mitigation: keep lookup O(1), keep interpolation simple, memoize translator objects by locale, avoid reconstructing maps in render, and provide a non-React helper for commands.

### Test fixtures

Risk: existing tests assert exact English output and locale-dependent tests can be brittle.
Mitigation: default tests to `en`, set locale explicitly in tests, use fallback assertions where useful, prefer key completeness tests over large snapshots, and avoid unrelated test churn.

### LanguagePicker integration

Risk: existing `LanguagePicker` appears like an i18n component but actually controls response and voice language.
Mitigation: keep existing behavior unchanged early, introduce `LocalePicker` separately, rename existing UI copy to `Response language` when safe, and persist UI locale under `settings.locale`.

### Runtime protocol strings

Risk: translating ids or event names can break consumers.
Mitigation: define a "do not translate" list and keep telemetry event names, analytics metadata keys, command ids, JSON schema keys, and model prompt instructions unchanged unless explicitly scoped.

### CLI and Ink split

Risk: React context works for Ink components but not plain CLI handlers.
Mitigation: implement core `translate(locale, key, params)`, make `useTranslation()` a thin wrapper, pass locale through command context, and use default resolver for legacy call sites.

## Phase F - Key decisions

### Q1. Runtime choice

Question: should P2.10 use Path A, Path B, or Path C inside Path D?
Recommendation: start with Path A.
Exit criteria to revisit: more than 10% of migrated strings need plural/select logic, translators need ICU compatibility, or date/number formatting becomes central to visible copy.

### Q2. Initial locale set

Question: should the first implementation ship all three locales together?
Recommendation: ship scaffold with `en` first, add `zh-Hans` in P2.10.c, and add `ja` in P2.10.d.
Reason: key shape should stabilize before translation review.

### Q3. Catalog format

Question: should catalogs be TS const, JSON, or `.po` files?
Recommendation: use TS const initially.
Reason: TypeScript key inference is useful, Bun handles TS modules, no parser dependency is needed, and the repo is TypeScript-first.

### Q4. Lazy-load strategy

Question: should locale catalogs be bundled or dynamically imported?
Recommendation: bundle English and dynamically import non-English catalogs.
Fallback: bundle all three if dynamic import complicates Bun output.

### Q5. Default locale detection

Question: should default locale use system locale or always English?
Recommendation: use explicit setting first, command-line override above setting, system locale when no explicit setting exists, and English fallback.
Priority order:
1. `--locale`.
2. `settings.locale`.
3. `LC_ALL`.
4. `LANG`.
5. `Intl.DateTimeFormat().resolvedOptions().locale`.
6. `en`.

### Q6. Translation source

Question: should translation be human-only, machine plus review, or community sourced?
Recommendation: machine-generated initial pass plus human review.
Reason: the catalog is too large for manual first drafting, but technical terminology still needs review.

### Q7. Existing language setting

Question: should `settings.language` become UI locale?
Recommendation: no.
Reason: it already controls model response and voice language, is free-form, is not a locale tag, and is injected into the model prompt.
Recommended action: keep `settings.language`, add `settings.locale`, and clarify both labels in settings UI.

## Phase G - Reference appendix

### G1. DeepSeek-TUI reference

No vendored DeepSeek-TUI i18n implementation was found in this repository.
The original P2.10 plan references DeepSeek-TUI as the benchmark.
Before P2.10.a, compare against upstream if available.
Reference questions: catalog format, locale coverage, command-description localization, tool-output localization, environment detection, and per-session override support.

### G2. Existing `utils/intl.ts` audit

Current responsibilities: grapheme segmentation, word segmentation, relative time formatting, timezone discovery, and system locale language discovery.
Not current responsibilities: message catalogs, translation lookup, locale persistence, locale normalization, React provider, and CLI context propagation.
Suggested reuse: reuse system locale discovery carefully, add a new locale resolver for full BCP 47 behavior, and do not put message lookup into `utils/intl.ts`.

### G3. Existing `LanguagePicker.tsx` audit

Current responsibilities: capture preferred response language, capture voice dictation language preference, and persist free-form user input through settings flow.
Not current responsibilities: UI locale selection, locale catalog selection, BCP 47 normalization, or translation preview.
Suggested path: add new `LocalePicker`, optionally rename current component to `ResponseLanguagePicker`, and update UI labels only after tests cover both settings.

### G4. Sample first 50 extraction targets

Candidate group 1: settings section labels, row labels, descriptions, empty-state copy, LanguagePicker prompt, LanguagePicker placeholder, and LanguagePicker default text.
Candidate group 2: help title, command table headers, shortcut labels, footer text, and core command descriptions.
Candidate group 3: restore unavailable title, loading message, empty message, confirmation title, confirmation body, and confirm label.
Candidate group 4: cache chip status text, cache inspect headings, cache unavailable message, and cache provider labels.
Candidate group 5: doctor title, success heading, warning heading, failure heading, and `/doctor` guidance.
Candidate group 6: provider setup heading, missing key message, invalid config message, and login/setup guidance.
Candidate group 7: permission prompt title, allow label, deny label, and remember-choice text.

### G5. Suggested key taxonomy

Recommended prefixes: `settings.*`, `help.*`, `command.*`, `doctor.*`, `restore.*`, `cache.*`, `provider.*`, `permission.*`, `tool.*`, `error.*`, `status.*`, `update.*`, `install.*`, `mcp.*`.
Example keys: `settings.responseLanguage.label`, `settings.uiLocale.label`, `command.doctor.description`, `restore.snapshot.title`, `cache.status.hitRate`, `doctor.title`, `provider.login.missingApiKey`, `permission.allowOnce`.
Key naming rules: use lower camel case after namespace, keep command names literal in values, keep placeholders named, avoid keys that encode English grammar, avoid numeric suffixes, and prefer stable product concepts over component filenames.

### G6. Non-translatable strings

Do not translate tool ids, command ids, command aliases, telemetry event names, analytics metadata keys, JSON schema keys, permission rule syntax, environment variable names, file paths, URLs, model ids, provider ids, package names, code identifiers, test fixture protocol values, or model steering prompts unless explicitly scoped.

### G7. Acceptance criteria for P2.10 close

Minimum close criteria:
- `en`, `zh-Hans`, and `ja` catalogs exist.
- UI locale can be selected and persisted.
- Command-line override exists.
- System locale fallback exists.
- Top 50 user-facing strings are localized.
- Slash command descriptions are localized where visible.
- Doctor headings and check labels are localized where visible.
- Restore/cache/provider high-impact strings are localized.
- Tests cover fallback and missing keys.
- `bun test` passes.
- Dist is refreshed in P2.10.Z.
Stretch criteria: hard-coded string lint rule, translator glossary, locale coverage report, dynamic import bundle-size measurement, and additional locale candidates documented.

### G8. Open questions before implementation

Open questions:
- Should the settings field be `locale` or `uiLocale`?
- Should `/lang` set response language or UI locale?
- Should the new command be `/locale` to avoid ambiguity?
- Should non-English catalogs be complete before a locale switch is exposed?
- Should test snapshots remain English-only?
- Should CLI non-interactive output obey locale by default?
- Should locale affect model system prompts?
Recommendation: use `/locale` for UI language, keep existing response-language setting under settings, and consider `/response-language` only if users need command access.

### G9. Recommended next PR

Recommended next PR:
```text
P2.10.a - i18n scaffold + en catalog extraction
```
Recommended branch:
```text
phase2/p2-10-a-i18n-scaffold
```
Recommended commit type: `feat`
Recommended hard cap: 15-20 files.
Recommended first implementation: Path A helper, English catalog, locale type, locale resolver, first 50 strings, and node tests.
Do not include in P2.10.a: `zh-Hans` full catalog, `ja` full catalog, dist refresh, broad component migration, runtime prompt translation, or telemetry string changes.
