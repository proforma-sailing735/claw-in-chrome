(function () {
  if (globalThis.__CP_CONTRACT__) {
    return;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    return value;
  }

  const contract = {
    version: 1,
    customProvider: {
      STORAGE_KEY: "customProviderConfig",
      PROFILES_STORAGE_KEY: "customProviderProfiles",
      ACTIVE_PROFILE_STORAGE_KEY: "customProviderActiveProfileId",
      BACKUP_KEY: "customProviderOriginalApiKey",
      ANTHROPIC_API_KEY_STORAGE_KEY: "anthropicApiKey",
      FETCHED_MODELS_CACHE_KEY: "customProviderFetchedModelsCache",
      SELECTED_MODEL_STORAGE_KEY: "selectedModel",
      SELECTED_MODEL_QUICK_MODE_STORAGE_KEY: "selectedModelQuickMode",
      MODEL_SELECTION_SYNC_SIGNATURE_KEY: "customProviderSelectedModelSyncSignature",
      QUICK_MODEL_SELECTION_SYNC_SIGNATURE_KEY: "customProviderSelectedModelQuickModeSyncSignature",
      HTTP_PROVIDER_STORAGE_KEY: "customProviderAllowHttp",
      HTTP_PROVIDER_MIGRATED_KEY: "customProviderAllowHttpMigrated"
    },
    session: {
      CHAT_SCOPE_PREFIX: "claw.chat.scopes.",
      CHAT_CLEANUP_AUDIT_KEY: "claw.chat.cleanup.audit",
      CHAT_CLEANUP_AUDIT_LIMIT: 40
    },
    detachedWindow: {
      LOCKS_STORAGE_KEY: "claw.detachedWindowLocks",
      OPEN_GROUP_MESSAGE_TYPE: "OPEN_GROUP_DETACHED_WINDOW",
      PAGE_PATH: "sidepanel.html",
      DEFAULT_SIZE: {
        width: 500,
        height: 768,
        left: 100,
        top: 100
      }
    },
    debug: {
      RELEVANT_STORAGE_KEYS: [
        "customProviderConfig",
        "anthropicApiKey",
        "accessToken",
        "refreshToken",
        "lastAuthFailureReason",
        "selectedModel",
        "selectedModelQuickMode",
        "lastPermissionModePreference",
        "chrome_ext_models"
      ]
    }
  };

  globalThis.__CP_CONTRACT__ = deepFreeze(contract);
})();
