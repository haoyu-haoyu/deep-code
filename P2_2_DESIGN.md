# P2.2 Multi-Provider Support Scan
Status: scan + design
Branch: phase2/p2-2-scan
Base: c47df8a75514ab7d7d9991fe2c1bfe5d06849d56
Date: 2026-05-27

## Executive Summary
P2.2 adds `--provider {deepseek,ollama,vllm,openai-compatible}`.
Current provider primitives exist, but DeepSeek remains the only implemented provider.
The registry is present but is not yet the universal runtime boundary.
Runtime, auth, config, cache, compact, doctor, and P2.1 auto routing still import DeepSeek helpers directly.
Recommendation: Path C.
Keep `deepseek.mjs` stable.
Add one `openai-compatible.mjs` adapter.
Route `ollama`, `vllm`, and generic endpoints through that adapter.
Use capability flags to protect DeepSeek-only cache, thinking, reasoning, and strict-tools behavior.
Estimated implementation: 5-7 sub-PRs after scan.
Estimated touches: 30-50 files total.
Provider count: 4 supported ids plus legacy unsupported Anthropic names.
ModelProvider method count: 5.

## Phase A — Provider Boundary Inventory
### A1. Current providers/ Module Structure
Directory: `packages/deep-code/src/services/providers/`
Files:
| File | Lines | Role |
|---|---:|---|
| `deepseek.mjs` | 654 | sole working provider plus DeepSeek helper surface |
| `registry.mjs` | 24 | provider lookup by name |
| `types.mjs` | 46 | interface methods plus capabilities |
| `deepseek-config-store.mjs` | 116 | single DeepSeek config persistence |
| `deepseek-recovery.mjs` | 104 | DeepSeek finish/error recovery |
| `index.mjs` | 22 | provider barrel |
`deepseek.mjs` exported defaults:
- `DEFAULT_DEEPSEEK_BASE_URL`
- `DEFAULT_DEEPSEEK_MODEL`
- `DEFAULT_DEEPSEEK_SMALL_MODEL`
- `DEEPSEEK_PROVIDER_CAPABILITIES`
`deepseek.mjs` exported provider functions:
- `resolveDeepSeekConfig`
- `buildDeepSeekRequest`
- `buildDeepSeekRouterRequest`
- `runDeepSeekAgent`
- `createDeepSeekProvider`
- `streamDeepSeekQuery`
- `collectDeepSeekStreamEvents`
- `parseDeepSeekStreamChunk`
- `parseDeepSeekSSELines`
- `mapDeepSeekUsage`
`deepseek.mjs` exported DeepSeek helper families:
- cache diagnostics
- strict tool schema conversion
- DeepSeek finish reason mapping
- DeepSeek HTTP error recovery
DeepSeek-specific assumptions in `deepseek.mjs`:
- default base URL is `https://api.deepseek.com`
- request path appends `/chat/completions`
- request body includes `thinking`
- request body includes `reasoning_effort`
- request body includes `user_id`
- stream deltas may include `reasoning_content`
- usage may include `prompt_cache_hit_tokens`
- usage may include `prompt_cache_miss_tokens`
- recovery knows `insufficient_system_resource`
Provider-neutral behavior in `deepseek.mjs`:
- build HTTP request
- map messages
- stream SSE
- parse content deltas
- parse tool call deltas
- parse finish events
- parse usage events
- forward abort signals
`registry.mjs` current behavior:
- `DEFAULT_MODEL_PROVIDER = 'deepseek'`
- reads `DEEPCODE_PROVIDER`
- reads `DEEP_CODE_PROVIDER`
- resolves `deepseek` to `createDeepSeekProvider(defaults)`
- resolves `anthropic` and `claude` to unsupported legacy provider
- throws for all other names
Registry gaps:
- `ollama` throws
- `vllm` throws
- `openai-compatible` throws
- most runtime paths bypass registry
`types.mjs` current behavior:
- defines method list
- defines capability constants
- validates provider shape with `assertModelProvider`
- creates unsupported providers
Existing capabilities:
- `cache_diagnostics`
- `json_output`
- `reasoning_content`
- `strict_tools`
- `streaming`
- `tool_calls`
Capability gap:
- capabilities exist but consumers rarely check them.
`deepseek-config-store.mjs` current behavior:
- resolves one DeepSeek config path
- loads one JSON object
- saves atomically with mode `0o600`
- merges partial config
- deletes config on logout
Config path precedence:
1. `DEEPCODE_CONFIG_FILE`
2. `DEEPSEEK_CONFIG_FILE`
3. `DEEPCODE_CONFIG_DIR`
4. `CLAUDE_CONFIG_DIR` legacy fallback
5. `~/.deepcode/deepseek-config.json`
Persisted config fields:
- `apiKey`
- `baseUrl`
- `model`
- `smallModel`
- `reasoningEffort`
- `thinking`
- `completedAt`
Config gaps:
- no active provider field
- no provider-keyed credentials
- no auth-optional provider support
- DeepSeek-specific filename
`deepseek-recovery.mjs` current behavior:
- maps `stop`
- maps `tool_calls`
- maps `length`
- maps `content_filter`
- maps `insufficient_system_resource`
- maps HTTP 429 retry metadata
- maps HTTP 503 retry metadata
- parses `Retry-After`
Recovery gap:
- `lower_reasoning_effort_or_use_flash` is DeepSeek-specific.
`index.mjs` current behavior:
- exports provider types
- exports registry
- exports DeepSeek provider
- exports DeepSeek capabilities
- exports DeepSeek recovery helpers
Barrel gap:
- it appears provider-neutral but mostly exposes DeepSeek-specific surface.

### A2. ModelProvider Interface Contract
`types.mjs` defines exactly 5 provider methods:
```js
streamQuery
buildRequest
parseStreamChunk
mapUsage
supports
```
Method: `streamQuery(context)`
- Input: high-level chat context or already-built HTTP request.
- Output: async iterable of normalized provider events.
- Current input may include `systemPrompt`.
- Current input may include `messages`.
- Current input may include `tools`.
- Current input may include `env`.
- Current input may include `cwd`.
- Current input may include `model`.
- Current input may include `maxTokens`.
- Current input may include `stream`.
- Current input may include `strictTools`.
- Current input may include `thinking`.
- Current input may include `reasoningEffort`.
- Current input may include `temperature`.
- Current input may include `topP`.
- Current input may include `toolChoice`.
- Current input may include `toolSchemaOptions`.
- Current input may include `responseFormat`.
- Current input may include `userId`.
- Current input may include `cacheUserId`.
- Current input may include `signal`.
- Current input may include `fetch`.
Current normalized stream events:
- `{ type: 'reasoning_delta', text }`
- `{ type: 'content_delta', text }`
- `{ type: 'tool_call_delta', index, id, name, argumentsDelta, finishReason }`
- `{ type: 'finish', finishReason }`
- `{ type: 'usage', usage }`
- `{ type: 'done' }`
`streamQuery` general assumptions:
- SSE-like streaming
- content deltas
- tool call deltas
- finish reason
- usage metadata
- abort signal forwarding
`streamQuery` DeepSeek assumptions:
- reasoning deltas are possible
- cache user id is meaningful
- thinking and reasoning effort are request knobs
Method: `buildRequest(context)`
- Input: high-level chat context.
- Output: `{ url, method, headers, body }`.
- General body includes `model`.
- General body includes `messages`.
- General body may include `tools`.
- General body may include `tool_choice`.
- General body may include `max_tokens`.
- General body may include `stream`.
- General body may include `response_format`.
- DeepSeek body includes `thinking`.
- DeepSeek body includes `reasoning_effort`.
- DeepSeek body includes `user_id`.
- DeepSeek tool schemas pass through strict sanitizer.
Method: `parseStreamChunk(chunk)`
- Input: raw SSE chunk as string or bytes.
- Output: array of normalized provider events.
- General behavior ignores empty lines.
- General behavior parses `data:` lines.
- General behavior maps `[DONE]`.
- General behavior parses JSON chunks.
- General behavior extracts content deltas.
- General behavior extracts tool deltas.
- General behavior extracts finish reasons.
- DeepSeek behavior extracts `delta.reasoning_content`.
- DeepSeek behavior maps usage through `mapDeepSeekUsage`.
Method: `mapUsage(usage)`
- Input: raw provider usage object.
- Output: normalized usage object.
- General fields: prompt tokens.
- General fields: completion tokens.
- General fields: total tokens.
- DeepSeek fields: prompt cache hit tokens.
- DeepSeek fields: prompt cache miss tokens.
- DeepSeek fields: reasoning tokens.
Method: `supports(capability)`
- Input: capability string.
- Output: boolean.
Existing capability matrix:
| Capability | DeepSeek | OpenAI-compatible default |
|---|---:|---:|
| `streaming` | yes | yes |
| `tool_calls` | yes | maybe |
| `strict_tools` | yes | no/maybe |
| `json_output` | yes | maybe |
| `reasoning_content` | yes | no |
| `cache_diagnostics` | yes | no |
Conclusion:
- The current interface is sufficient for a first P2.2 implementation.
- Capability flags should be used before adding another abstraction.

### A3. 17 Provider Consumer Files
Scan distinction:
- 13 files directly import `services/providers/*`.
- 17 files are provider-boundary consumers when DeepSeek cache/schema utilities are included.
Direct `services/providers/*` import files:
```text
packages/deep-code/src/cache/deepseek-warmup.mjs
packages/deep-code/src/commands/login/login.tsx
packages/deep-code/src/commands/logout/logout.tsx
packages/deep-code/src/components/DeepSeekSetupDialog.tsx
packages/deep-code/src/deepcode/compact.mjs
packages/deep-code/src/deepcode/deepseek-native.mjs
packages/deep-code/src/deepcode/doctor.mjs
packages/deep-code/src/deepcode/status.mjs
packages/deep-code/src/interactiveHelpers.tsx
packages/deep-code/src/query/deepseek-call-model.mjs
packages/deep-code/src/services/autoMode/router.ts
packages/deep-code/src/services/runtime/__tests__/messageSend.test.ts
packages/deep-code/src/services/runtime/messageSend.ts
```
Implementation-relevant 17-file list:
| # | File | Usage | Specificity |
|---:|---|---|---|
| 1 | `services/runtime/messageSend.ts` | creates DeepSeek provider | high |
| 2 | `query/deepseek-call-model.mjs` | DeepSeek call-model adapter | very high |
| 3 | `services/autoMode/router.ts` | P2.1 DeepSeek router request | medium-high |
| 4 | `deepcode/doctor.mjs` | registry + DeepSeek diagnostics | medium |
| 5 | `cache/deepseek-warmup.mjs` | cache warmup | high |
| 6 | `cache/deepseek-cache.mjs` | cache diagnostics | high |
| 7 | `deepcode/compact.mjs` | compact request/provider | high |
| 8 | `deepcode/agent-runtime-e2e.mjs` | DeepSeek e2e harness | high |
| 9 | `deepcode/local-toolchain.mjs` | DeepSeek agent runner | high |
| 10 | `deepcode/stable-prefix.mjs` | strict schema stable prefix | high |
| 11 | `tools/deepseek-schema.mjs` | tool schema sanitizer | high |
| 12 | `deepcode/status.mjs` | DeepSeek config status | medium |
| 13 | `interactiveHelpers.tsx` | setup config checks | medium |
| 14 | `components/DeepSeekSetupDialog.tsx` | auth/config UI | high |
| 15 | `commands/login/login.tsx` | login setup | medium |
| 16 | `commands/logout/logout.tsx` | logout config delete | medium |
| 17 | `deepcode/deepseek-native.mjs` | DeepSeek barrel | high |
Direct `createDeepSeekProvider` consumers:
- `services/runtime/messageSend.ts`
- `query/deepseek-call-model.mjs`
- `cache/deepseek-warmup.mjs`
- `deepcode/compact.mjs`
- `deepcode/doctor.mjs`
- `deepcode/agent-runtime-e2e.mjs`
Registry consumer:
- `deepcode/doctor.mjs`
DeepSeek-specific consumers:
- cache diagnostics consumers: 5 files
- strict tool schema consumers: 3 files
- reasoning/thinking consumers: 3 files
Provider-neutral candidates:
- runtime stream plumbing
- compact prompt/response collection
- doctor registry check
- status display
- login/logout routing

### A4. CLI / Config Current Provider Selection Path
Current CLI:
- `main.tsx` has no `--provider`.
- P2.1 added `--model auto`, not provider selection.
Current commands:
- no `/provider` command exists
- `/model` controls model
- `/login` configures DeepSeek credentials
- `/logout` deletes DeepSeek config
- `/status` mentions provider but reads DeepSeek config
Current environment:
- registry reads `DEEPCODE_PROVIDER`
- registry reads `DEEP_CODE_PROVIDER`
- DeepSeek config reads `DEEPSEEK_API_KEY`
- DeepSeek config reads `DEEPCODE_API_KEY`
- DeepSeek config reads `API_KEY`
- DeepSeek config reads `DEEPSEEK_BASE_URL`
- DeepSeek config reads `DEEPCODE_BASE_URL`
- DeepSeek config reads model and effort envs
Current switching reality:
- `DEEPCODE_PROVIDER=deepseek` works only where registry is used.
- `DEEPCODE_PROVIDER=ollama` throws in registry consumers.
- Runtime still creates DeepSeek directly.
- There is no persisted active provider.
- There is no per-provider credential store.
P2.2 implication:
- Add `--provider`.
- Add `/provider`.
- Add provider-aware config.
- Route runtime provider creation through registry.
- Keep default provider as `deepseek`.

### A5. OpenAI-Compatible Common Points
Ollama OpenAI-compatible:
- common base URL: `http://localhost:11434/v1`
- chat endpoint under that base: `/chat/completions`
- API key usually not required
- model names are local tags such as `llama3.1:8b`
- native `/api/chat` and `/api/tags` should not block first scope
vLLM:
- base URL is deployment-specific
- chat endpoint usually `/v1/chat/completions`
- API key is optional or deployment-specific
- model names are deployment-specific
- tool support depends on server flags and model
Generic OpenAI-compatible:
- base URL is user-provided
- API key is usually required
- model name is endpoint-defined
- tool and JSON support vary
Shared API shape:
- chat completion request
- `model`
- `messages`
- `stream: true`
- SSE streaming
- content deltas
- finish reason
- usage object
- optional tools/function calling
- optional JSON response format
Differences:
- DeepSeek cache diagnostics
- DeepSeek reasoning content
- DeepSeek thinking controls
- DeepSeek strict tool schema
- Ollama auth-free default
- vLLM/generic custom base URLs
- provider-specific tool call support

## Phase B — Path Options
### Path A — Provider Adapter Pattern With Capability Flags
Plan:
- implement separate provider module for each provider id
- extend registry to all provider ids
- make every provider implement the five-method interface
- gate DeepSeek-specific consumers with capabilities
Pros:
- clean polymorphic boundary
- explicit provider defaults
- clear capability matrix
- easy future provider additions
Cons:
- more files immediately
- duplicated OpenAI-compatible request/parser code
- broad consumer updates early
- higher risk to current DeepSeek path
Best if:
- native Ollama `/api/chat` is required immediately
- provider differences dominate from the first implementation PR

### Path B — Shared OpenAI-Compatible Base + DeepSeek Extension
Plan:
- build `openai-compatible-base.mjs`
- make DeepSeek use or extend that base
- make Ollama/vLLM/generic wrappers configure the base
- override DeepSeek thinking/cache/schema behavior
Pros:
- DRY long-term architecture
- one SSE parser for OpenAI-style responses
- one request builder for OpenAI-compatible endpoints
Cons:
- refactors stable DeepSeek path
- DeepSeek endpoint/body differences are non-trivial
- existing helper exports make inheritance awkward
- higher regression risk for Phase 1 and P2.1
Best if:
- P2.2 first wants an architecture cleanup
- duplicate adapter logic becomes a real maintenance burden

### Path C — Hybrid: Shared Adapter for New Providers + Retain DeepSeek
Plan:
- keep `deepseek.mjs` unchanged initially
- add `openai-compatible.mjs`
- route `ollama`, `vllm`, and generic through that adapter
- extend registry by provider id
- add capability flags and consumer gates
Pros:
- lowest risk to current DeepSeek path
- fastest useful self-hosted support
- isolated new-provider behavior
- no premature DeepSeek refactor
- still enables capability-gated design
Cons:
- some duplicate request/parser code
- DeepSeek and OpenAI-compatible implementations remain separate
- future cleanup may still be useful
Best if:
- practical Phase 2 delivery matters more than architecture cleanup
- DeepSeek stability remains the top constraint

## Phase C — Recommended Path + Rationale
Recommended path: Path C.
Rationale:
DeepSeek is the stable post-Phase-1 runtime and now backs P2.1 auto mode.
P2.2 should not refactor that path while introducing three new provider ids.
Ollama, vLLM, and generic OpenAI-compatible endpoints share enough request and SSE shape to use one new adapter.
They do not share DeepSeek cache, thinking, strict schema, or recovery semantics.
Path C isolates new-provider risk, keeps DeepSeek behavior intact, and creates the capability boundary needed for P2.3 cache visualization.
Path C rules:
- default provider remains `deepseek`
- `deepseek.mjs` remains stable in early PRs
- new providers start conservative
- DeepSeek-only features stay DeepSeek-only
- provider choice and model choice stay separate
- `/provider` owns provider switching
- `/model` owns model switching
- auto mode remains DeepSeek-backed unless explicitly changed later

## Phase D — Sub-PR Breakdown
P2.2.scan:
- create this design document
- one file only
- no source/test/dist changes
P2.2.a — openai-compatible adapter scaffold:
- add `services/providers/openai-compatible.mjs`
- add generic OpenAI-compatible factory
- add Ollama defaults
- add vLLM defaults
- add request builder
- add SSE parser
- add usage mapper
- add capability defaults
- add adapter tests
Expected files for P2.2.a:
- `services/providers/openai-compatible.mjs`
- `test/p2-2-providers.test.mjs`
- `.github/workflows/ci.yml` if needed
P2.2.b — registry + CLI flag + `/provider`:
- extend registry
- add `--provider <provider>`
- add `/provider`
- preserve `deepseek` default
- reject unknown providers clearly
Expected files for P2.2.b:
- `services/providers/registry.mjs`
- `services/providers/index.mjs`
- `main.tsx`
- `commands/provider/*`
- `commands.ts`
- tests
P2.2.c — config store / per-provider auth:
- add provider-aware config
- preserve existing DeepSeek config fallback
- support auth-required providers
- support auth-optional providers
- support auth-none providers
- support provider base URL storage
- support provider default model storage
Precedence proposal:
1. CLI flags
2. provider-specific env vars
3. generic DeepCode env vars
4. provider-aware config file
5. existing DeepSeek config fallback for DeepSeek
6. provider defaults
P2.2.d — capability flags + consumer gating:
- gate cache diagnostics
- gate reasoning content
- gate strict tools
- gate JSON output
- gate tool calls
- gate provider-specific status fields
Likely files for P2.2.d:
- `query/deepseek-call-model.mjs`
- `services/runtime/messageSend.ts`
- `deepcode/doctor.mjs`
- `deepcode/compact.mjs`
- `cache/deepseek-warmup.mjs`
- `deepcode/status.mjs`
P2.2.test:
- registry tests
- adapter tests
- config tests
- mocked runtime provider switching tests
- unsupported capability tests
P2.2.Z:
- dist-only refresh
- verify idempotency
P2.2.cite:
- update `EXECUTION_LOG.md`
- cite all P2.2 PRs
- record provider ids
- record selected Path C
- advance Track A
Estimate:
- 5-7 sub-PRs after scan
- 30-50 total file touches

## Phase E — Risk Assessment
Provider capability mismatch:
- Risk: consumers assume DeepSeek cache, thinking, reasoning, or strict tools.
- Mitigation: use `supports(capability)`.
- Mitigation: default new providers conservatively.
- Mitigation: test unsupported capability paths.
API key storage:
- Risk: current config stores one DeepSeek key.
- Risk: Ollama usually needs no key.
- Risk: vLLM may or may not need a key.
- Risk: generic OpenAI-compatible usually needs a key.
- Mitigation: provider-aware config and auth mode per provider.
Base URL configuration:
- Risk: each provider has different defaults.
- Mitigation: DeepSeek default remains `https://api.deepseek.com`.
- Mitigation: Ollama default is `http://localhost:11434/v1`.
- Mitigation: vLLM and generic require configured base URL.
- Mitigation: normalize trailing slash and avoid double `/v1`.
Streaming format differences:
- Risk: OpenAI-compatible SSE differs across servers.
- Mitigation: start with OpenAI-compatible Ollama path.
- Mitigation: defer native Ollama `/api/chat`.
- Mitigation: parser tests with mocked chunks.
Tools/function calling:
- Risk: support varies by provider, server, and model.
- Mitigation: gate `tool_calls` and `strict_tools`.
- Mitigation: conservative defaults.
Model name normalization:
- Risk: DeepSeek aliases do not map cleanly to local/custom models.
- Mitigation: keep provider and model separate.
- Mitigation: allow arbitrary model names.
P2.1 auto mode interaction:
- Risk: auto decisions include DeepSeek thinking semantics.
- Mitigation: keep initial router DeepSeek-backed.
- Mitigation: revisit after provider capabilities exist.
DeepSeek regression:
- Risk: P2.2 touches runtime/config/auth.
- Mitigation: Path C, existing DeepSeek tests, isolated new adapter tests.

## Phase F — Key Decision Questions
Q1. Path A/B/C?
- Recommend Path C.
- Reason: useful multi-provider support without destabilizing DeepSeek.
Q2. Add `/provider` or extend `/model`?
- Recommend `/provider`.
- Reason: provider and model are orthogonal.
- Reason: provider switching may require auth/base URL setup.
- Reason: `/model auto` already has P2.1 semantics.
Q3. Capability flags as enum or booleans?
- Recommend existing string capabilities plus `supports(capability)`.
- Reason: mechanism already exists.
- Reason: avoids broad type churn.
- Possible new flags: `model_listing`, `auth_optional`, `openai_v1_chat`.
Q4. API key storage?
- Recommend provider-aware config with DeepSeek fallback.
- Reason: multiple providers need multiple credential states.
- Reason: existing DeepSeek users should not re-login.
Q5. Default provider?
- Recommend `deepseek`.
- Reason: current stable product identity.
- Reason: base URL auto-detection can surprise users.
Q6. Auto mode plus multi-provider?
- Recommend initial DeepSeek-backed router.
- Reason: cross-provider routing is a separate policy decision.

## Phase G — Reference Appendix
### G1. ModelProvider Interface Signature
Current provider object:
```js
{
  name: string,
  streamQuery(context): AsyncIterable<ProviderEvent>,
  buildRequest(context): Promise<RequestObject>,
  parseStreamChunk(chunk): ProviderEvent[],
  mapUsage(usage): object,
  supports(capability): boolean,
}
```
Current request object:
```js
{
  url: string,
  method: 'POST',
  headers: Record<string, string>,
  body: Record<string, unknown>,
}
```
Current provider events:
```js
{ type: 'reasoning_delta', text?: string }
{ type: 'content_delta', text?: string }
{ type: 'tool_call_delta', index, id, name, argumentsDelta, finishReason }
{ type: 'finish', finishReason }
{ type: 'usage', usage }
{ type: 'done' }
```

### G2. API Shape Comparison
| Provider | Base URL | Auth | Chat path | Tools | Thinking | Cache |
|---|---|---|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | required | `/chat/completions` | yes | yes | yes |
| Ollama | `http://localhost:11434/v1` | none | `/chat/completions` | varies | no | no |
| vLLM | configured | optional | `/v1/chat/completions` | varies | no | no |
| OpenAI-compatible | configured | usually required | `/v1/chat/completions` | varies | no | no |

### G3. DeepSeek-Specific Feature List
Request fields:
- `thinking`
- `reasoning_effort`
- `user_id`
Response fields:
- `delta.reasoning_content`
- `usage.prompt_cache_hit_tokens`
- `usage.prompt_cache_miss_tokens`
- `usage.completion_tokens_details.reasoning_tokens`
Behavior:
- stable prefix cache optimization
- strict tool schema sanitization
- small model default
- finish reason recovery
- setup model labels
Capability mapping:
- `reasoning_content`
- `cache_diagnostics`
- `strict_tools`
- `json_output`
- `tool_calls`
