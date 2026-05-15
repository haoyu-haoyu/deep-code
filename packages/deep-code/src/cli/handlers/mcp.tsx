/**
 * MCP subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when the corresponding `claude mcp *` command runs.
 */

import { stat } from 'fs/promises';
import pMap from 'p-map';
import { cwd } from 'process';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { clearMcpClientConfig, clearServerTokensFromLocalStorage, getMcpClientConfig, readClientSecret, saveMcpClientSecret } from '../../services/mcp/auth.js';
import { connectToServer, getMcpServerConnectionBatchSize } from '../../services/mcp/client.js';
import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, removeMcpConfig } from '../../services/mcp/config.js';
import type { ConfigScope, ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath, ensureConfigScope, getScopeLabel } from '../../services/mcp/utils.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig } from '../../utils/config.js';
import { isFsInaccessible } from '../../utils/errors.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { safeParseJSON } from '../../utils/json.js';
import { cliError, cliOk } from '../exit.js';
async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {
  try {
    const result = await connectToServer(name, server);
    if (result.type === 'connected') {
      return '✓ Connected';
    } else if (result.type === 'needs-auth') {
      return '! Needs authentication';
    } else {
      return '✗ Failed to connect';
    }
  } catch (_error) {
    return '✗ Connection error';
  }
}

// mcp serve (lines 4512–4532)
export async function mcpServeHandler({
  debug,
  verbose
}: {
  debug?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const providedCwd = cwd();
  logEvent('tengu_mcp_start', {});
  try {
    await stat(providedCwd);
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(`Error: Directory ${providedCwd} does not exist`);
    }
    throw error;
  }
  try {
    const {
      setup
    } = await import('../../setup.js');
    await setup(providedCwd, 'default', false, false, undefined, false);
    const {
      startMCPServer
    } = await import('../../entrypoints/mcp.js');
    await startMCPServer(providedCwd, debug ?? false, verbose ?? false);
  } catch (error) {
    cliError(`Error: Failed to start MCP server: ${error}`);
  }
}

// mcp remove (lines 4545–4635)
export async function mcpRemoveHandler(name: string, options: {
  scope?: string;
}): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name);
  const cleanupSecureStorage = () => {
    if (serverBeforeRemoval && (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')) {
      clearServerTokensFromLocalStorage(name, serverBeforeRemoval);
      clearMcpClientConfig(name, serverBeforeRemoval);
    }
  };
  try {
    if (options.scope) {
      const scope = ensureConfigScope(options.scope);
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server ${name} from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig();
    const globalConfig = getGlobalConfig();

    // Check if server exists in project scope (.mcp.json)
    const {
      servers: projectServers
    } = getMcpConfigsByScope('project');
    const mcpJsonExists = !!projectServers[name];

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = [];
    if (projectConfig.mcpServers?.[name]) scopes.push('local');
    if (mcpJsonExists) scopes.push('project');
    if (globalConfig.mcpServers?.[name]) scopes.push('user');
    if (scopes.length === 0) {
      cliError(`No MCP server found with name: "${name}"`);
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!;
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Removed MCP server "${name}" from ${scope} config\n`);
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`);
    } else {
      // Server exists in multiple scopes
      process.stderr.write(`MCP server "${name}" exists in multiple scopes:\n`);
      scopes.forEach(scope => {
        process.stderr.write(`  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`);
      });
      process.stderr.write('\nTo remove from a specific scope, use:\n');
      scopes.forEach(scope => {
        process.stderr.write(`  claude mcp remove "${name}" -s ${scope}\n`);
      });
      cliError();
    }
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp list (lines 4641–4688)
export async function mcpListHandler(): Promise<void> {
  logEvent('tengu_mcp_list', {});
  const {
    servers: configs
  } = await getAllMcpConfigs();
  if (Object.keys(configs).length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('No MCP servers configured. Use `claude mcp add` to add a server.');
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Checking MCP server health...\n');

    // Check servers concurrently
    const entries = Object.entries(configs);
    const results = await pMap(entries, async ([name, server]) => ({
      name,
      server,
      status: await checkMcpServerHealth(name, server)
    }), {
      concurrency: getMcpServerConnectionBatchSize()
    });
    for (const {
      name,
      server,
      status
    } of results) {
      // Intentionally excluding sse-ide servers here since they're internal
      if (server.type === 'sse') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (SSE) - ${status}`);
      } else if (server.type === 'http') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (HTTP) - ${status}`);
      } else if (server.type === 'claudeai-proxy') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} - ${status}`);
      } else if (!server.type || server.type === 'stdio') {
        const args = Array.isArray(server.args) ? server.args : [];
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.command} ${args.join(' ')} - ${status}`);
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp get (lines 4694–4786)
export async function mcpGetHandler(name: string): Promise<void> {
  logEvent('tengu_mcp_get', {
    name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  const server = getMcpConfigByName(name);
  if (!server) {
    cliError(`No MCP server found with name: ${name}`);
  }

  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${name}:`);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Scope: ${getScopeLabel(server.scope)}`);

  // Check server health
  const status = await checkMcpServerHealth(name, server);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Status: ${status}`);

  // Intentionally excluding sse-ide servers here since they're internal
  if (server.type === 'sse') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: sse`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'http') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: http`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Headers:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('client_id configured');
        const clientConfig = getMcpClientConfig(name, server);
        if (clientConfig?.clientSecret) parts.push('client_secret configured');
      }
      if (server.oauth.callbackPort) parts.push(`callback_port ${server.oauth.callbackPort}`);
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'stdio') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Type: stdio`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Command: ${server.command}`);
    const args = Array.isArray(server.args) ? server.args : [];
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Args: ${args.join(' ')}`);
    if (server.env) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Environment:');
      for (const [key, value] of Object.entries(server.env)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}=${value}`);
      }
    }
  }
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`\nTo remove this server, run: claude mcp remove "${name}" -s ${server.scope}`);
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp add-json (lines 4801–4870)
export async function mcpAddJsonHandler(name: string, json: string, options: {
  scope?: string;
  clientSecret?: true;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const parsedJson = safeParseJSON(json);

    // Read secret before writing config so cancellation doesn't leave partial state
    const needsSecret = options.clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string' && 'oauth' in parsedJson && parsedJson.oauth && typeof parsedJson.oauth === 'object' && 'clientId' in parsedJson.oauth;
    const clientSecret = needsSecret ? await readClientSecret() : undefined;
    await addMcpConfig(name, parsedJson, scope);
    const transportType = parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson ? String(parsedJson.type || 'stdio') : 'stdio';
    if (clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string') {
      saveMcpClientSecret(name, {
        type: parsedJson.type,
        url: parsedJson.url
      }, clientSecret);
    }
    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      type: transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    cliOk(`Added ${transportType} MCP server ${name} to ${scope} config`);
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp reset-project-choices (lines 4935–4952)
export async function mcpResetChoicesHandler(): Promise<void> {
  logEvent('tengu_mcp_reset_mcpjson_choices', {});
  saveCurrentProjectConfig(current => ({
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false
  }));
  cliOk('All project-scoped (.mcp.json) server approvals and rejections have been reset.\n' + 'You will be prompted for approval next time you start DeepCode.');
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibWNwLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE1DUCBzdWJjb21tYW5kIGhhbmRsZXJzIOKAlCBleHRyYWN0ZWQgZnJvbSBtYWluLnRzeCBmb3IgbGF6eSBsb2FkaW5nLlxuICogVGhlc2UgYXJlIGR5bmFtaWNhbGx5IGltcG9ydGVkIG9ubHkgd2hlbiB0aGUgY29ycmVzcG9uZGluZyBgY2xhdWRlIG1jcCAqYCBjb21tYW5kIHJ1bnMuXG4gKi9cblxuaW1wb3J0IHsgc3RhdCB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCBwTWFwIGZyb20gJ3AtbWFwJztcbmltcG9ydCB7IGN3ZCB9IGZyb20gJ3Byb2Nlc3MnO1xuaW1wb3J0IHsgdHlwZSBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLCBsb2dFdmVudCB9IGZyb20gJy4uLy4uL3NlcnZpY2VzL2FuYWx5dGljcy9pbmRleC5qcyc7XG5pbXBvcnQgeyBjbGVhck1jcENsaWVudENvbmZpZywgY2xlYXJTZXJ2ZXJUb2tlbnNGcm9tTG9jYWxTdG9yYWdlLCBnZXRNY3BDbGllbnRDb25maWcsIHJlYWRDbGllbnRTZWNyZXQsIHNhdmVNY3BDbGllbnRTZWNyZXQgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9tY3AvYXV0aC5qcyc7XG5pbXBvcnQgeyBjb25uZWN0VG9TZXJ2ZXIsIGdldE1jcFNlcnZlckNvbm5lY3Rpb25CYXRjaFNpemUgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9tY3AvY2xpZW50LmpzJztcbmltcG9ydCB7IGFkZE1jcENvbmZpZywgZ2V0QWxsTWNwQ29uZmlncywgZ2V0TWNwQ29uZmlnQnlOYW1lLCBnZXRNY3BDb25maWdzQnlTY29wZSwgcmVtb3ZlTWNwQ29uZmlnIH0gZnJvbSAnLi4vLi4vc2VydmljZXMvbWNwL2NvbmZpZy5qcyc7XG5pbXBvcnQgdHlwZSB7IENvbmZpZ1Njb3BlLCBTY29wZWRNY3BTZXJ2ZXJDb25maWcgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9tY3AvdHlwZXMuanMnO1xuaW1wb3J0IHsgZGVzY3JpYmVNY3BDb25maWdGaWxlUGF0aCwgZW5zdXJlQ29uZmlnU2NvcGUsIGdldFNjb3BlTGFiZWwgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9tY3AvdXRpbHMuanMnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudFByb2plY3RDb25maWcsIGdldEdsb2JhbENvbmZpZywgc2F2ZUN1cnJlbnRQcm9qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vdXRpbHMvY29uZmlnLmpzJztcbmltcG9ydCB7IGlzRnNJbmFjY2Vzc2libGUgfSBmcm9tICcuLi8uLi91dGlscy9lcnJvcnMuanMnO1xuaW1wb3J0IHsgZ3JhY2VmdWxTaHV0ZG93biB9IGZyb20gJy4uLy4uL3V0aWxzL2dyYWNlZnVsU2h1dGRvd24uanMnO1xuaW1wb3J0IHsgc2FmZVBhcnNlSlNPTiB9IGZyb20gJy4uLy4uL3V0aWxzL2pzb24uanMnO1xuaW1wb3J0IHsgY2xpRXJyb3IsIGNsaU9rIH0gZnJvbSAnLi4vZXhpdC5qcyc7XG5hc3luYyBmdW5jdGlvbiBjaGVja01jcFNlcnZlckhlYWx0aChuYW1lOiBzdHJpbmcsIHNlcnZlcjogU2NvcGVkTWNwU2VydmVyQ29uZmlnKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb25uZWN0VG9TZXJ2ZXIobmFtZSwgc2VydmVyKTtcbiAgICBpZiAocmVzdWx0LnR5cGUgPT09ICdjb25uZWN0ZWQnKSB7XG4gICAgICByZXR1cm4gJ+KckyBDb25uZWN0ZWQnO1xuICAgIH0gZWxzZSBpZiAocmVzdWx0LnR5cGUgPT09ICduZWVkcy1hdXRoJykge1xuICAgICAgcmV0dXJuICchIE5lZWRzIGF1dGhlbnRpY2F0aW9uJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuICfinJcgRmFpbGVkIHRvIGNvbm5lY3QnO1xuICAgIH1cbiAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgcmV0dXJuICfinJcgQ29ubmVjdGlvbiBlcnJvcic7XG4gIH1cbn1cblxuLy8gbWNwIHNlcnZlIChsaW5lcyA0NTEy4oCTNDUzMilcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtY3BTZXJ2ZUhhbmRsZXIoe1xuICBkZWJ1ZyxcbiAgdmVyYm9zZVxufToge1xuICBkZWJ1Zz86IGJvb2xlYW47XG4gIHZlcmJvc2U/OiBib29sZWFuO1xufSk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBwcm92aWRlZEN3ZCA9IGN3ZCgpO1xuICBsb2dFdmVudCgndGVuZ3VfbWNwX3N0YXJ0Jywge30pO1xuICB0cnkge1xuICAgIGF3YWl0IHN0YXQocHJvdmlkZWRDd2QpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChpc0ZzSW5hY2Nlc3NpYmxlKGVycm9yKSkge1xuICAgICAgY2xpRXJyb3IoYEVycm9yOiBEaXJlY3RvcnkgJHtwcm92aWRlZEN3ZH0gZG9lcyBub3QgZXhpc3RgKTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCB7XG4gICAgICBzZXR1cFxuICAgIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL3NldHVwLmpzJyk7XG4gICAgYXdhaXQgc2V0dXAocHJvdmlkZWRDd2QsICdkZWZhdWx0JywgZmFsc2UsIGZhbHNlLCB1bmRlZmluZWQsIGZhbHNlKTtcbiAgICBjb25zdCB7XG4gICAgICBzdGFydE1DUFNlcnZlclxuICAgIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL2VudHJ5cG9pbnRzL21jcC5qcycpO1xuICAgIGF3YWl0IHN0YXJ0TUNQU2VydmVyKHByb3ZpZGVkQ3dkLCBkZWJ1ZyA/PyBmYWxzZSwgdmVyYm9zZSA/PyBmYWxzZSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY2xpRXJyb3IoYEVycm9yOiBGYWlsZWQgdG8gc3RhcnQgTUNQIHNlcnZlcjogJHtlcnJvcn1gKTtcbiAgfVxufVxuXG4vLyBtY3AgcmVtb3ZlIChsaW5lcyA0NTQ14oCTNDYzNSlcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtY3BSZW1vdmVIYW5kbGVyKG5hbWU6IHN0cmluZywgb3B0aW9uczoge1xuICBzY29wZT86IHN0cmluZztcbn0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gTG9vayB1cCBjb25maWcgYmVmb3JlIHJlbW92aW5nIHNvIHdlIGNhbiBjbGVhbiB1cCBzZWN1cmUgc3RvcmFnZVxuICBjb25zdCBzZXJ2ZXJCZWZvcmVSZW1vdmFsID0gZ2V0TWNwQ29uZmlnQnlOYW1lKG5hbWUpO1xuICBjb25zdCBjbGVhbnVwU2VjdXJlU3RvcmFnZSA9ICgpID0+IHtcbiAgICBpZiAoc2VydmVyQmVmb3JlUmVtb3ZhbCAmJiAoc2VydmVyQmVmb3JlUmVtb3ZhbC50eXBlID09PSAnc3NlJyB8fCBzZXJ2ZXJCZWZvcmVSZW1vdmFsLnR5cGUgPT09ICdodHRwJykpIHtcbiAgICAgIGNsZWFyU2VydmVyVG9rZW5zRnJvbUxvY2FsU3RvcmFnZShuYW1lLCBzZXJ2ZXJCZWZvcmVSZW1vdmFsKTtcbiAgICAgIGNsZWFyTWNwQ2xpZW50Q29uZmlnKG5hbWUsIHNlcnZlckJlZm9yZVJlbW92YWwpO1xuICAgIH1cbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAob3B0aW9ucy5zY29wZSkge1xuICAgICAgY29uc3Qgc2NvcGUgPSBlbnN1cmVDb25maWdTY29wZShvcHRpb25zLnNjb3BlKTtcbiAgICAgIGxvZ0V2ZW50KCd0ZW5ndV9tY3BfZGVsZXRlJywge1xuICAgICAgICBuYW1lOiBuYW1lIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgIHNjb3BlOiBzY29wZSBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHJlbW92ZU1jcENvbmZpZyhuYW1lLCBzY29wZSk7XG4gICAgICBjbGVhbnVwU2VjdXJlU3RvcmFnZSgpO1xuICAgICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoYFJlbW92ZWQgTUNQIHNlcnZlciAke25hbWV9IGZyb20gJHtzY29wZX0gY29uZmlnXFxuYCk7XG4gICAgICBjbGlPayhgRmlsZSBtb2RpZmllZDogJHtkZXNjcmliZU1jcENvbmZpZ0ZpbGVQYXRoKHNjb3BlKX1gKTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzY29wZSBzcGVjaWZpZWQsIGNoZWNrIHdoZXJlIHRoZSBzZXJ2ZXIgZXhpc3RzXG4gICAgY29uc3QgcHJvamVjdENvbmZpZyA9IGdldEN1cnJlbnRQcm9qZWN0Q29uZmlnKCk7XG4gICAgY29uc3QgZ2xvYmFsQ29uZmlnID0gZ2V0R2xvYmFsQ29uZmlnKCk7XG5cbiAgICAvLyBDaGVjayBpZiBzZXJ2ZXIgZXhpc3RzIGluIHByb2plY3Qgc2NvcGUgKC5tY3AuanNvbilcbiAgICBjb25zdCB7XG4gICAgICBzZXJ2ZXJzOiBwcm9qZWN0U2VydmVyc1xuICAgIH0gPSBnZXRNY3BDb25maWdzQnlTY29wZSgncHJvamVjdCcpO1xuICAgIGNvbnN0IG1jcEpzb25FeGlzdHMgPSAhIXByb2plY3RTZXJ2ZXJzW25hbWVdO1xuXG4gICAgLy8gQ291bnQgaG93IG1hbnkgc2NvcGVzIGNvbnRhaW4gdGhpcyBzZXJ2ZXJcbiAgICBjb25zdCBzY29wZXM6IEFycmF5PEV4Y2x1ZGU8Q29uZmlnU2NvcGUsICdkeW5hbWljJz4+ID0gW107XG4gICAgaWYgKHByb2plY3RDb25maWcubWNwU2VydmVycz8uW25hbWVdKSBzY29wZXMucHVzaCgnbG9jYWwnKTtcbiAgICBpZiAobWNwSnNvbkV4aXN0cykgc2NvcGVzLnB1c2goJ3Byb2plY3QnKTtcbiAgICBpZiAoZ2xvYmFsQ29uZmlnLm1jcFNlcnZlcnM/LltuYW1lXSkgc2NvcGVzLnB1c2goJ3VzZXInKTtcbiAgICBpZiAoc2NvcGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY2xpRXJyb3IoYE5vIE1DUCBzZXJ2ZXIgZm91bmQgd2l0aCBuYW1lOiBcIiR7bmFtZX1cImApO1xuICAgIH0gZWxzZSBpZiAoc2NvcGVzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgLy8gU2VydmVyIGV4aXN0cyBpbiBvbmx5IG9uZSBzY29wZSwgcmVtb3ZlIGl0XG4gICAgICBjb25zdCBzY29wZSA9IHNjb3Blc1swXSE7XG4gICAgICBsb2dFdmVudCgndGVuZ3VfbWNwX2RlbGV0ZScsIHtcbiAgICAgICAgbmFtZTogbmFtZSBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICAgICAgICBzY29wZTogc2NvcGUgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIU1xuICAgICAgfSk7XG4gICAgICBhd2FpdCByZW1vdmVNY3BDb25maWcobmFtZSwgc2NvcGUpO1xuICAgICAgY2xlYW51cFNlY3VyZVN0b3JhZ2UoKTtcbiAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKGBSZW1vdmVkIE1DUCBzZXJ2ZXIgXCIke25hbWV9XCIgZnJvbSAke3Njb3BlfSBjb25maWdcXG5gKTtcbiAgICAgIGNsaU9rKGBGaWxlIG1vZGlmaWVkOiAke2Rlc2NyaWJlTWNwQ29uZmlnRmlsZVBhdGgoc2NvcGUpfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTZXJ2ZXIgZXhpc3RzIGluIG11bHRpcGxlIHNjb3Blc1xuICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYE1DUCBzZXJ2ZXIgXCIke25hbWV9XCIgZXhpc3RzIGluIG11bHRpcGxlIHNjb3BlczpcXG5gKTtcbiAgICAgIHNjb3Blcy5mb3JFYWNoKHNjb3BlID0+IHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCAgLSAke2dldFNjb3BlTGFiZWwoc2NvcGUpfSAoJHtkZXNjcmliZU1jcENvbmZpZ0ZpbGVQYXRoKHNjb3BlKX0pXFxuYCk7XG4gICAgICB9KTtcbiAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKCdcXG5UbyByZW1vdmUgZnJvbSBhIHNwZWNpZmljIHNjb3BlLCB1c2U6XFxuJyk7XG4gICAgICBzY29wZXMuZm9yRWFjaChzY29wZSA9PiB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAgIGNsYXVkZSBtY3AgcmVtb3ZlIFwiJHtuYW1lfVwiIC1zICR7c2NvcGV9XFxuYCk7XG4gICAgICB9KTtcbiAgICAgIGNsaUVycm9yKCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNsaUVycm9yKChlcnJvciBhcyBFcnJvcikubWVzc2FnZSk7XG4gIH1cbn1cblxuLy8gbWNwIGxpc3QgKGxpbmVzIDQ2NDHigJM0Njg4KVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1jcExpc3RIYW5kbGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICBsb2dFdmVudCgndGVuZ3VfbWNwX2xpc3QnLCB7fSk7XG4gIGNvbnN0IHtcbiAgICBzZXJ2ZXJzOiBjb25maWdzXG4gIH0gPSBhd2FpdCBnZXRBbGxNY3BDb25maWdzKCk7XG4gIGlmIChPYmplY3Qua2V5cyhjb25maWdzKS5sZW5ndGggPT09IDApIHtcbiAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgY29uc29sZS5sb2coJ05vIE1DUCBzZXJ2ZXJzIGNvbmZpZ3VyZWQuIFVzZSBgY2xhdWRlIG1jcCBhZGRgIHRvIGFkZCBhIHNlcnZlci4nKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgY29uc29sZS5sb2coJ0NoZWNraW5nIE1DUCBzZXJ2ZXIgaGVhbHRoLi4uXFxuJyk7XG5cbiAgICAvLyBDaGVjayBzZXJ2ZXJzIGNvbmN1cnJlbnRseVxuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhjb25maWdzKTtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgcE1hcChlbnRyaWVzLCBhc3luYyAoW25hbWUsIHNlcnZlcl0pID0+ICh7XG4gICAgICBuYW1lLFxuICAgICAgc2VydmVyLFxuICAgICAgc3RhdHVzOiBhd2FpdCBjaGVja01jcFNlcnZlckhlYWx0aChuYW1lLCBzZXJ2ZXIpXG4gICAgfSksIHtcbiAgICAgIGNvbmN1cnJlbmN5OiBnZXRNY3BTZXJ2ZXJDb25uZWN0aW9uQmF0Y2hTaXplKClcbiAgICB9KTtcbiAgICBmb3IgKGNvbnN0IHtcbiAgICAgIG5hbWUsXG4gICAgICBzZXJ2ZXIsXG4gICAgICBzdGF0dXNcbiAgICB9IG9mIHJlc3VsdHMpIHtcbiAgICAgIC8vIEludGVudGlvbmFsbHkgZXhjbHVkaW5nIHNzZS1pZGUgc2VydmVycyBoZXJlIHNpbmNlIHRoZXkncmUgaW50ZXJuYWxcbiAgICAgIGlmIChzZXJ2ZXIudHlwZSA9PT0gJ3NzZScpIHtcbiAgICAgICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgICAgICBjb25zb2xlLmxvZyhgJHtuYW1lfTogJHtzZXJ2ZXIudXJsfSAoU1NFKSAtICR7c3RhdHVzfWApO1xuICAgICAgfSBlbHNlIGlmIChzZXJ2ZXIudHlwZSA9PT0gJ2h0dHAnKSB7XG4gICAgICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICAgICAgY29uc29sZS5sb2coYCR7bmFtZX06ICR7c2VydmVyLnVybH0gKEhUVFApIC0gJHtzdGF0dXN9YCk7XG4gICAgICB9IGVsc2UgaWYgKHNlcnZlci50eXBlID09PSAnY2xhdWRlYWktcHJveHknKSB7XG4gICAgICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICAgICAgY29uc29sZS5sb2coYCR7bmFtZX06ICR7c2VydmVyLnVybH0gLSAke3N0YXR1c31gKTtcbiAgICAgIH0gZWxzZSBpZiAoIXNlcnZlci50eXBlIHx8IHNlcnZlci50eXBlID09PSAnc3RkaW8nKSB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBBcnJheS5pc0FycmF5KHNlcnZlci5hcmdzKSA/IHNlcnZlci5hcmdzIDogW107XG4gICAgICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICAgICAgY29uc29sZS5sb2coYCR7bmFtZX06ICR7c2VydmVyLmNvbW1hbmR9ICR7YXJncy5qb2luKCcgJyl9IC0gJHtzdGF0dXN9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIFVzZSBncmFjZWZ1bFNodXRkb3duIHRvIHByb3Blcmx5IGNsZWFuIHVwIE1DUCBzZXJ2ZXIgY29ubmVjdGlvbnNcbiAgLy8gKHByb2Nlc3MuZXhpdCBieXBhc3NlcyBjbGVhbnVwIGhhbmRsZXJzLCBsZWF2aW5nIGNoaWxkIHByb2Nlc3NlcyBvcnBoYW5lZClcbiAgYXdhaXQgZ3JhY2VmdWxTaHV0ZG93bigwKTtcbn1cblxuLy8gbWNwIGdldCAobGluZXMgNDY5NOKAkzQ3ODYpXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWNwR2V0SGFuZGxlcihuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgbG9nRXZlbnQoJ3Rlbmd1X21jcF9nZXQnLCB7XG4gICAgbmFtZTogbmFtZSBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTXG4gIH0pO1xuICBjb25zdCBzZXJ2ZXIgPSBnZXRNY3BDb25maWdCeU5hbWUobmFtZSk7XG4gIGlmICghc2VydmVyKSB7XG4gICAgY2xpRXJyb3IoYE5vIE1DUCBzZXJ2ZXIgZm91bmQgd2l0aCBuYW1lOiAke25hbWV9YCk7XG4gIH1cblxuICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gIGNvbnNvbGUubG9nKGAke25hbWV9OmApO1xuICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gIGNvbnNvbGUubG9nKGAgIFNjb3BlOiAke2dldFNjb3BlTGFiZWwoc2VydmVyLnNjb3BlKX1gKTtcblxuICAvLyBDaGVjayBzZXJ2ZXIgaGVhbHRoXG4gIGNvbnN0IHN0YXR1cyA9IGF3YWl0IGNoZWNrTWNwU2VydmVySGVhbHRoKG5hbWUsIHNlcnZlcik7XG4gIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgY29uc29sZS5sb2coYCAgU3RhdHVzOiAke3N0YXR1c31gKTtcblxuICAvLyBJbnRlbnRpb25hbGx5IGV4Y2x1ZGluZyBzc2UtaWRlIHNlcnZlcnMgaGVyZSBzaW5jZSB0aGV5J3JlIGludGVybmFsXG4gIGlmIChzZXJ2ZXIudHlwZSA9PT0gJ3NzZScpIHtcbiAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgY29uc29sZS5sb2coYCAgVHlwZTogc3NlYCk7XG4gICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgIGNvbnNvbGUubG9nKGAgIFVSTDogJHtzZXJ2ZXIudXJsfWApO1xuICAgIGlmIChzZXJ2ZXIuaGVhZGVycykge1xuICAgICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgICAgY29uc29sZS5sb2coJyAgSGVhZGVyczonKTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlcnZlci5oZWFkZXJzKSkge1xuICAgICAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgICAgIGNvbnNvbGUubG9nKGAgICAgJHtrZXl9OiAke3ZhbHVlfWApO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc2VydmVyLm9hdXRoPy5jbGllbnRJZCB8fCBzZXJ2ZXIub2F1dGg/LmNhbGxiYWNrUG9ydCkge1xuICAgICAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gICAgICBpZiAoc2VydmVyLm9hdXRoLmNsaWVudElkKSB7XG4gICAgICAgIHBhcnRzLnB1c2goJ2NsaWVudF9pZCBjb25maWd1cmVkJyk7XG4gICAgICAgIGNvbnN0IGNsaWVudENvbmZpZyA9IGdldE1jcENsaWVudENvbmZpZyhuYW1lLCBzZXJ2ZXIpO1xuICAgICAgICBpZiAoY2xpZW50Q29uZmlnPy5jbGllbnRTZWNyZXQpIHBhcnRzLnB1c2goJ2NsaWVudF9zZWNyZXQgY29uZmlndXJlZCcpO1xuICAgICAgfVxuICAgICAgaWYgKHNlcnZlci5vYXV0aC5jYWxsYmFja1BvcnQpIHBhcnRzLnB1c2goYGNhbGxiYWNrX3BvcnQgJHtzZXJ2ZXIub2F1dGguY2FsbGJhY2tQb3J0fWApO1xuICAgICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgICAgY29uc29sZS5sb2coYCAgT0F1dGg6ICR7cGFydHMuam9pbignLCAnKX1gKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoc2VydmVyLnR5cGUgPT09ICdodHRwJykge1xuICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICBjb25zb2xlLmxvZyhgICBUeXBlOiBodHRwYCk7XG4gICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgIGNvbnNvbGUubG9nKGAgIFVSTDogJHtzZXJ2ZXIudXJsfWApO1xuICAgIGlmIChzZXJ2ZXIuaGVhZGVycykge1xuICAgICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgICAgY29uc29sZS5sb2coJyAgSGVhZGVyczonKTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlcnZlci5oZWFkZXJzKSkge1xuICAgICAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgICAgIGNvbnNvbGUubG9nKGAgICAgJHtrZXl9OiAke3ZhbHVlfWApO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc2VydmVyLm9hdXRoPy5jbGllbnRJZCB8fCBzZXJ2ZXIub2F1dGg/LmNhbGxiYWNrUG9ydCkge1xuICAgICAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gICAgICBpZiAoc2VydmVyLm9hdXRoLmNsaWVudElkKSB7XG4gICAgICAgIHBhcnRzLnB1c2goJ2NsaWVudF9pZCBjb25maWd1cmVkJyk7XG4gICAgICAgIGNvbnN0IGNsaWVudENvbmZpZyA9IGdldE1jcENsaWVudENvbmZpZyhuYW1lLCBzZXJ2ZXIpO1xuICAgICAgICBpZiAoY2xpZW50Q29uZmlnPy5jbGllbnRTZWNyZXQpIHBhcnRzLnB1c2goJ2NsaWVudF9zZWNyZXQgY29uZmlndXJlZCcpO1xuICAgICAgfVxuICAgICAgaWYgKHNlcnZlci5vYXV0aC5jYWxsYmFja1BvcnQpIHBhcnRzLnB1c2goYGNhbGxiYWNrX3BvcnQgJHtzZXJ2ZXIub2F1dGguY2FsbGJhY2tQb3J0fWApO1xuICAgICAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICAgICAgY29uc29sZS5sb2coYCAgT0F1dGg6ICR7cGFydHMuam9pbignLCAnKX1gKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoc2VydmVyLnR5cGUgPT09ICdzdGRpbycpIHtcbiAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgY29uc29sZS5sb2coYCAgVHlwZTogc3RkaW9gKTtcbiAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgY29uc29sZS5sb2coYCAgQ29tbWFuZDogJHtzZXJ2ZXIuY29tbWFuZH1gKTtcbiAgICBjb25zdCBhcmdzID0gQXJyYXkuaXNBcnJheShzZXJ2ZXIuYXJncykgPyBzZXJ2ZXIuYXJncyA6IFtdO1xuICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICBjb25zb2xlLmxvZyhgICBBcmdzOiAke2FyZ3Muam9pbignICcpfWApO1xuICAgIGlmIChzZXJ2ZXIuZW52KSB7XG4gICAgICAvLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vQ29uc29sZTo6IGludGVudGlvbmFsIGNvbnNvbGUgb3V0cHV0XG4gICAgICBjb25zb2xlLmxvZygnICBFbnZpcm9ubWVudDonKTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlcnZlci5lbnYpKSB7XG4gICAgICAgIC8vIGJpb21lLWlnbm9yZSBsaW50L3N1c3BpY2lvdXMvbm9Db25zb2xlOjogaW50ZW50aW9uYWwgY29uc29sZSBvdXRwdXRcbiAgICAgICAgY29uc29sZS5sb2coYCAgICAke2tleX09JHt2YWx1ZX1gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0NvbnNvbGU6OiBpbnRlbnRpb25hbCBjb25zb2xlIG91dHB1dFxuICBjb25zb2xlLmxvZyhgXFxuVG8gcmVtb3ZlIHRoaXMgc2VydmVyLCBydW46IGNsYXVkZSBtY3AgcmVtb3ZlIFwiJHtuYW1lfVwiIC1zICR7c2VydmVyLnNjb3BlfWApO1xuICAvLyBVc2UgZ3JhY2VmdWxTaHV0ZG93biB0byBwcm9wZXJseSBjbGVhbiB1cCBNQ1Agc2VydmVyIGNvbm5lY3Rpb25zXG4gIC8vIChwcm9jZXNzLmV4aXQgYnlwYXNzZXMgY2xlYW51cCBoYW5kbGVycywgbGVhdmluZyBjaGlsZCBwcm9jZXNzZXMgb3JwaGFuZWQpXG4gIGF3YWl0IGdyYWNlZnVsU2h1dGRvd24oMCk7XG59XG5cbi8vIG1jcCBhZGQtanNvbiAobGluZXMgNDgwMeKAkzQ4NzApXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWNwQWRkSnNvbkhhbmRsZXIobmFtZTogc3RyaW5nLCBqc29uOiBzdHJpbmcsIG9wdGlvbnM6IHtcbiAgc2NvcGU/OiBzdHJpbmc7XG4gIGNsaWVudFNlY3JldD86IHRydWU7XG59KTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgY29uc3Qgc2NvcGUgPSBlbnN1cmVDb25maWdTY29wZShvcHRpb25zLnNjb3BlKTtcbiAgICBjb25zdCBwYXJzZWRKc29uID0gc2FmZVBhcnNlSlNPTihqc29uKTtcblxuICAgIC8vIFJlYWQgc2VjcmV0IGJlZm9yZSB3cml0aW5nIGNvbmZpZyBzbyBjYW5jZWxsYXRpb24gZG9lc24ndCBsZWF2ZSBwYXJ0aWFsIHN0YXRlXG4gICAgY29uc3QgbmVlZHNTZWNyZXQgPSBvcHRpb25zLmNsaWVudFNlY3JldCAmJiBwYXJzZWRKc29uICYmIHR5cGVvZiBwYXJzZWRKc29uID09PSAnb2JqZWN0JyAmJiAndHlwZScgaW4gcGFyc2VkSnNvbiAmJiAocGFyc2VkSnNvbi50eXBlID09PSAnc3NlJyB8fCBwYXJzZWRKc29uLnR5cGUgPT09ICdodHRwJykgJiYgJ3VybCcgaW4gcGFyc2VkSnNvbiAmJiB0eXBlb2YgcGFyc2VkSnNvbi51cmwgPT09ICdzdHJpbmcnICYmICdvYXV0aCcgaW4gcGFyc2VkSnNvbiAmJiBwYXJzZWRKc29uLm9hdXRoICYmIHR5cGVvZiBwYXJzZWRKc29uLm9hdXRoID09PSAnb2JqZWN0JyAmJiAnY2xpZW50SWQnIGluIHBhcnNlZEpzb24ub2F1dGg7XG4gICAgY29uc3QgY2xpZW50U2VjcmV0ID0gbmVlZHNTZWNyZXQgPyBhd2FpdCByZWFkQ2xpZW50U2VjcmV0KCkgOiB1bmRlZmluZWQ7XG4gICAgYXdhaXQgYWRkTWNwQ29uZmlnKG5hbWUsIHBhcnNlZEpzb24sIHNjb3BlKTtcbiAgICBjb25zdCB0cmFuc3BvcnRUeXBlID0gcGFyc2VkSnNvbiAmJiB0eXBlb2YgcGFyc2VkSnNvbiA9PT0gJ29iamVjdCcgJiYgJ3R5cGUnIGluIHBhcnNlZEpzb24gPyBTdHJpbmcocGFyc2VkSnNvbi50eXBlIHx8ICdzdGRpbycpIDogJ3N0ZGlvJztcbiAgICBpZiAoY2xpZW50U2VjcmV0ICYmIHBhcnNlZEpzb24gJiYgdHlwZW9mIHBhcnNlZEpzb24gPT09ICdvYmplY3QnICYmICd0eXBlJyBpbiBwYXJzZWRKc29uICYmIChwYXJzZWRKc29uLnR5cGUgPT09ICdzc2UnIHx8IHBhcnNlZEpzb24udHlwZSA9PT0gJ2h0dHAnKSAmJiAndXJsJyBpbiBwYXJzZWRKc29uICYmIHR5cGVvZiBwYXJzZWRKc29uLnVybCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHNhdmVNY3BDbGllbnRTZWNyZXQobmFtZSwge1xuICAgICAgICB0eXBlOiBwYXJzZWRKc29uLnR5cGUsXG4gICAgICAgIHVybDogcGFyc2VkSnNvbi51cmxcbiAgICAgIH0sIGNsaWVudFNlY3JldCk7XG4gICAgfVxuICAgIGxvZ0V2ZW50KCd0ZW5ndV9tY3BfYWRkJywge1xuICAgICAgc2NvcGU6IHNjb3BlIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICBzb3VyY2U6ICdqc29uJyBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICAgICAgdHlwZTogdHJhbnNwb3J0VHlwZSBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTXG4gICAgfSk7XG4gICAgY2xpT2soYEFkZGVkICR7dHJhbnNwb3J0VHlwZX0gTUNQIHNlcnZlciAke25hbWV9IHRvICR7c2NvcGV9IGNvbmZpZ2ApO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNsaUVycm9yKChlcnJvciBhcyBFcnJvcikubWVzc2FnZSk7XG4gIH1cbn1cblxuLy8gbWNwIHJlc2V0LXByb2plY3QtY2hvaWNlcyAobGluZXMgNDkzNeKAkzQ5NTIpXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWNwUmVzZXRDaG9pY2VzSGFuZGxlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgbG9nRXZlbnQoJ3Rlbmd1X21jcF9yZXNldF9tY3Bqc29uX2Nob2ljZXMnLCB7fSk7XG4gIHNhdmVDdXJyZW50UHJvamVjdENvbmZpZyhjdXJyZW50ID0+ICh7XG4gICAgLi4uY3VycmVudCxcbiAgICBlbmFibGVkTWNwanNvblNlcnZlcnM6IFtdLFxuICAgIGRpc2FibGVkTWNwanNvblNlcnZlcnM6IFtdLFxuICAgIGVuYWJsZUFsbFByb2plY3RNY3BTZXJ2ZXJzOiBmYWxzZVxuICB9KSk7XG4gIGNsaU9rKCdBbGwgcHJvamVjdC1zY29wZWQgKC5tY3AuanNvbikgc2VydmVyIGFwcHJvdmFscyBhbmQgcmVqZWN0aW9ucyBoYXZlIGJlZW4gcmVzZXQuXFxuJyArICdZb3Ugd2lsbCBiZSBwcm9tcHRlZCBmb3IgYXBwcm92YWwgbmV4dCB0aW1lIHlvdSBzdGFydCBEZWVwQ29kZS4nKTtcbn0iXSwibWFwcGluZ3MiOiIiLCJpZ25vcmVMaXN0IjpbXX0=
