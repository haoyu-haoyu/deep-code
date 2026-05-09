# Anthropic SDK Import Inventory

Generated from 140 raw import declarations under `packages/deep-code/src`.

Total imported symbol entries: 227

## Counts by Category

| Category | Count |
|---|---:|
| sdk-types | 197 |
| sdk-runtime | 27 |
| sdk-bedrock | 0 |
| sdk-foundry | 0 |
| sdk-mcpb | 3 |

## Top 20 Imported Symbols

| Symbol | Count |
|---|---:|
| `ContentBlockParam` | 33 |
| `ToolResultBlockParam` | 30 |
| `TextBlockParam` | 17 |
| `ImageBlockParam` | 10 |
| `APIError` | 9 |
| `APIUserAbortError` | 9 |
| `Base64ImageSource` | 9 |
| `BetaContentBlock` | 8 |
| `ToolUseBlock` | 8 |
| `Anthropic` | 7 |
| `BetaUsage` | 7 |
| `ToolUseBlockParam` | 7 |
| `BetaToolUnion` | 5 |
| `APIConnectionError` | 3 |
| `BetaMessage` | 3 |
| `BetaMessageStreamParams` | 3 |
| `BetaStopReason` | 3 |
| `BetaToolUseBlock` | 3 |
| `ClientOptions` | 3 |
| `ContentBlock` | 3 |

## Top Anthropic Modules

| Module | Imported Symbols |
|---|---:|
| `@anthropic-ai/sdk/resources/index.mjs` | 82 |
| `@anthropic-ai/sdk/resources/beta/messages/messages.mjs` | 46 |
| `@anthropic-ai/sdk` | 32 |
| `@anthropic-ai/sdk/resources/messages.mjs` | 29 |
| `@anthropic-ai/sandbox-runtime` | 12 |
| `@anthropic-ai/sdk/resources` | 7 |
| `@anthropic-ai/sdk/resources/messages.js` | 4 |
| `@anthropic-ai/sdk/resources/messages/messages.mjs` | 4 |
| `@anthropic-ai/mcpb` | 3 |
| `@anthropic-ai/sdk/error` | 3 |
| `@anthropic-ai/sdk/resources/beta/messages.js` | 3 |
| `@anthropic-ai/claude-agent-sdk` | 1 |
| `@anthropic-ai/sdk/streaming.mjs` | 1 |

## Notes

- `line` records the grep hit line containing the `from @anthropic-ai/...` clause.
- `sdk-types` covers type-only imports and inline `type` specifiers from Anthropic packages.
- `sdk-runtime` covers runtime imports from Anthropic packages that are not Bedrock, Foundry, or MCPB-specific.
- `sdk-mcpb` covers `@anthropic-ai/mcpb` manifest/config imports.
- No `sdk-bedrock` or `sdk-foundry` imports were present in this scan if their counts are zero.
