import * as React from 'react';
import { Text } from '../../ink.js';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import { clearPolicyLimitsCache } from '../../services/policyLimits/index.js';
// flushTelemetry is loaded lazily to avoid pulling in ~1.1MB of OpenTelemetry at startup
import { clearRemoteManagedSettingsCache } from '../../services/remoteManagedSettings/index.js';
import { clearBetasCaches } from '../../utils/betas.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getSecureStorage } from '../../utils/secureStorage/index.js';
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js';
import { resetUserCache } from '../../utils/user.js';

// Local no-op stub — trusted-device bridge module removed in P1.1.C.
// P1.3 will rewrite logout for DeepSeek API-key clear.
function clearTrustedDeviceTokenCache(): void {}

export async function performLogout({
  clearOnboarding = false
}): Promise<void> {
  // Flush telemetry BEFORE clearing credentials to prevent org data leakage
  const {
    flushTelemetry
  } = await import('../../utils/telemetry/instrumentation.js');
  await flushTelemetry();
  // Wipe all secure storage data on logout
  const secureStorage = getSecureStorage();
  secureStorage.delete();
  await clearAuthRelatedCaches();
  saveGlobalConfig(current => {
    const updated = {
      ...current
    };
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false;
      updated.subscriptionNoticeCount = 0;
      updated.hasAvailableSubscription = false;
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: []
        };
      }
    }
    updated.oauthAccount = undefined;
    return updated;
  });
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
  clearTrustedDeviceTokenCache();
  clearBetasCaches();
  clearToolSchemaCache();

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache();
  refreshGrowthBookAfterAuthChange();

  // Clear remotely managed settings cache
  await clearRemoteManagedSettingsCache();

  // Clear policy limits cache
  await clearPolicyLimitsCache();
}
export async function call(): Promise<React.ReactNode> {
  // Clear DeepSeek config (primary credential store)
  const { deleteDeepSeekConfigFile } = await import('../../services/providers/deepseek-config-store.mjs');
  try {
    deleteDeepSeekConfigFile();
  } catch (error) {
    // Best-effort: surface the error to the user but still proceed with OAuth cleanup.
    return <Text>Failed to clear DeepSeek config: {(error as Error).message}</Text>;
  }

  // Clear residual OAuth state (legacy; this branch goes away in P1.3.E
  // when utils/auth.ts is dismantled).
  await performLogout({
    clearOnboarding: true
  });

  const message = <Text>Successfully cleared DeepSeek credentials. Restart Deep Code to configure a new key.</Text>;
  setTimeout(() => {
    gracefulShutdownSync(0, 'logout');
  }, 200);
  return message;
}
