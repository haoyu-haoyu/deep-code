import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { stripSignatureBlocks } from '../../utils/messages.js';
import { formatDeepSeekLoginResult } from './loginResult.mjs';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const { resolveDeepSeekConfig } = await import('../../services/providers/deepseek.mjs');
  const config = resolveDeepSeekConfig({});
  const { DeepSeekSetupDialog } = await import('../../components/DeepSeekSetupDialog.js');
  return (
    <DeepSeekSetupDialog
      defaultBaseUrl={config.baseUrl}
      defaultModel={config.model}
      initialEffort={(config.reasoningEffort ?? 'max') as 'max' | 'high'}
      onDone={(saved, error) => {
        context.onChangeAPIKey();
        // Signature-bearing blocks (thinking, connector_text) are bound to the API key —
        // strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks);
        if (saved) {
          // Increment authVersion to trigger re-fetching of auth-dependent data
          // in hooks (e.g., MCP servers).
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }));
        }
        // A disk save failure reports the real cause, not "Login cancelled".
        onDone(formatDeepSeekLoginResult(saved, error));
      }}
    />
  );
}
