(function () {
  if (globalThis.__CP_SERVICE_WORKER_RUNTIME__) {
    return;
  }

  const sessionContract = globalThis.__CP_CONTRACT__?.session || {};
  const detachedWindowContract = globalThis.__CP_CONTRACT__?.detachedWindow || {};
  const CHAT_SCOPE_PREFIX = sessionContract.CHAT_SCOPE_PREFIX || "claw.chat.scopes.";
  const CHAT_CLEANUP_AUDIT_KEY = sessionContract.CHAT_CLEANUP_AUDIT_KEY || "claw.chat.cleanup.audit";
  const CHAT_CLEANUP_AUDIT_LIMIT = Number.isFinite(Number(sessionContract.CHAT_CLEANUP_AUDIT_LIMIT)) ? Math.trunc(Number(sessionContract.CHAT_CLEANUP_AUDIT_LIMIT)) : 40;
  const OPEN_GROUP_DETACHED_WINDOW_MESSAGE_TYPE = detachedWindowContract.OPEN_GROUP_MESSAGE_TYPE || "OPEN_GROUP_DETACHED_WINDOW";

  function createNoopConsole() {
    return {
      debug() {},
      warn() {}
    };
  }

  function normalizeStorageScopeId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function extractScopeIdFromStorageKey(key) {
    const rawKey = String(key || "");
    if (!rawKey.startsWith(CHAT_SCOPE_PREFIX)) {
      return "";
    }
    const suffix = rawKey.slice(CHAT_SCOPE_PREFIX.length);
    const separatorIndex = suffix.indexOf(".");
    return separatorIndex > 0 ? suffix.slice(0, separatorIndex) : "";
  }

  function createScopeCleanupRuntime(deps) {
    const options = deps && typeof deps === "object" ? deps : {};
    const chromeApi = options.chrome;
    if (!chromeApi?.storage?.local) {
      throw new Error("createScopeCleanupRuntime requires chrome.storage.local");
    }
    const consoleApi = options.console || globalThis.console || createNoopConsole();
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    function getGroupIdFromScopeId(scopeId) {
      const normalizedScopeId = normalizeStorageScopeId(scopeId);
      if (!normalizedScopeId.startsWith("chrome-group:")) {
        return null;
      }
      const groupId = Number(normalizedScopeId.slice("chrome-group:".length));
      return Number.isFinite(groupId) && groupId !== chromeApi.tabGroups?.TAB_GROUP_ID_NONE ? groupId : null;
    }

    function isChromeGroupScopeId(scopeId) {
      return normalizeStorageScopeId(scopeId).startsWith("chrome-group:");
    }

    function getMainTabIdFromScopeId(scopeId) {
      const normalizedScopeId = normalizeStorageScopeId(scopeId);
      if (!normalizedScopeId.startsWith("group:")) {
        return null;
      }
      const mainTabId = Number(normalizedScopeId.slice("group:".length));
      return Number.isFinite(mainTabId) && mainTabId > 0 ? mainTabId : null;
    }

    function collectGroupIdsFromStorageValue(value) {
      const groupIds = new Set();
      const addGroupId = candidate => {
        const groupId = Number(candidate);
        if (Number.isFinite(groupId) && groupId !== chromeApi.tabGroups?.TAB_GROUP_ID_NONE) {
          groupIds.add(groupId);
        }
      };

      if (Array.isArray(value)) {
        for (const item of value) {
          addGroupId(item?.chromeGroupId);
        }
        return groupIds;
      }

      if (value && typeof value === "object") {
        addGroupId(value.chromeGroupId);
        addGroupId(value?.meta?.chromeGroupId);
      }

      return groupIds;
    }

    function collectMainTabIdsFromStorageValue(value) {
      const mainTabIds = new Set();
      const addMainTabId = candidate => {
        const mainTabId = Number(candidate);
        if (Number.isFinite(mainTabId) && mainTabId > 0) {
          mainTabIds.add(mainTabId);
        }
      };

      if (Array.isArray(value)) {
        for (const item of value) {
          addMainTabId(item?.mainTabId);
        }
        return mainTabIds;
      }

      if (value && typeof value === "object") {
        addMainTabId(value.mainTabId);
        addMainTabId(value?.meta?.mainTabId);
      }

      return mainTabIds;
    }

    function collectStoredScopeEntries(storageSnapshot) {
      const scopeEntries = new Map();
      for (const [storageKey, storageValue] of Object.entries(storageSnapshot || {})) {
        const scopeId = extractScopeIdFromStorageKey(storageKey);
        if (!scopeId) {
          continue;
        }
        if (!scopeEntries.has(scopeId)) {
          scopeEntries.set(scopeId, {
            keys: [],
            groupIds: new Set(),
            mainTabIds: new Set()
          });
        }
        const entry = scopeEntries.get(scopeId);
        entry.keys.push(storageKey);
        const scopeGroupId = getGroupIdFromScopeId(scopeId);
        if (scopeGroupId !== null) {
          entry.groupIds.add(scopeGroupId);
        }
        const scopeMainTabId = getMainTabIdFromScopeId(scopeId);
        if (scopeMainTabId !== null) {
          entry.mainTabIds.add(scopeMainTabId);
        }
        for (const groupId of collectGroupIdsFromStorageValue(storageValue)) {
          entry.groupIds.add(groupId);
        }
        for (const mainTabId of collectMainTabIdsFromStorageValue(storageValue)) {
          entry.mainTabIds.add(mainTabId);
        }
      }
      return scopeEntries;
    }

    function findScopeIdsByGroupId(scopeEntries, groupId) {
      const matchedScopeIds = [];
      for (const [scopeId, entry] of scopeEntries.entries()) {
        if (entry.groupIds.has(groupId)) {
          matchedScopeIds.push(scopeId);
        }
      }
      return matchedScopeIds;
    }

    async function appendCleanupAudit(type, payload = {}) {
      try {
        const existing = await chromeApi.storage.local.get(CHAT_CLEANUP_AUDIT_KEY);
        const currentItems = Array.isArray(existing[CHAT_CLEANUP_AUDIT_KEY]) ? existing[CHAT_CLEANUP_AUDIT_KEY] : [];
        const nextItems = [
          ...currentItems,
          {
            ts: new Date(now()).toISOString(),
            type,
            payload
          }
        ].slice(-CHAT_CLEANUP_AUDIT_LIMIT);
        await chromeApi.storage.local.set({
          [CHAT_CLEANUP_AUDIT_KEY]: nextItems
        });
      } catch {}
    }

    async function removeScopeEntries(scopeIds, storageSnapshot = null) {
      const normalizedScopeIds = [
        ...new Set((Array.isArray(scopeIds) ? scopeIds : []).map(normalizeStorageScopeId).filter(Boolean))
      ];
      if (normalizedScopeIds.length === 0) {
        return {
          removedScopeIds: [],
          removedKeyCount: 0
        };
      }

      const scopeIdSet = new Set(normalizedScopeIds);
      const snapshot = storageSnapshot ?? await chromeApi.storage.local.get(null);
      const keysToRemove = [];
      for (const storageKey of Object.keys(snapshot)) {
        const scopeId = extractScopeIdFromStorageKey(storageKey);
        if (scopeId && scopeIdSet.has(scopeId)) {
          keysToRemove.push(storageKey);
        }
      }

      if (keysToRemove.length > 0) {
        await chromeApi.storage.local.remove(keysToRemove);
      }

      consoleApi.debug?.("[session-cleanup] removed scopes", {
        scopeIds: normalizedScopeIds,
        removedKeyCount: keysToRemove.length
      });
      await appendCleanupAudit("removed_scopes", {
        scopeIds: normalizedScopeIds,
        removedKeyCount: keysToRemove.length
      });

      return {
        removedScopeIds: normalizedScopeIds,
        removedKeyCount: keysToRemove.length
      };
    }

    async function cleanupClosedGroupScopes(groupIdValue) {
      const groupId = Number(groupIdValue);
      if (!Number.isFinite(groupId) || groupId === chromeApi.tabGroups?.TAB_GROUP_ID_NONE) {
        return {
          removedScopeIds: [],
          removedKeyCount: 0
        };
      }

      const storageSnapshot = await chromeApi.storage.local.get(null);
      const scopeEntries = collectStoredScopeEntries(storageSnapshot);
      const scopeIds = findScopeIdsByGroupId(scopeEntries, groupId);

      if (scopeIds.length === 0) {
        consoleApi.debug?.("[session-cleanup] no scopes matched closed group", {
          groupId
        });
        await appendCleanupAudit("closed_group_no_match", {
          groupId
        });
        return {
          removedScopeIds: [],
          removedKeyCount: 0
        };
      }

      const relatedMainTabIds = new Set();
      for (const scopeId of scopeIds) {
        const entry = scopeEntries.get(scopeId);
        if (!entry) {
          continue;
        }
        for (const mainTabId of entry.mainTabIds) {
          relatedMainTabIds.add(mainTabId);
        }
      }

      const relatedScopeIds = new Set(scopeIds);
      if (relatedMainTabIds.size > 0) {
        for (const [scopeId, entry] of scopeEntries.entries()) {
          if ([...entry.mainTabIds].some(mainTabId => relatedMainTabIds.has(mainTabId))) {
            relatedScopeIds.add(scopeId);
          }
        }
      }

      return removeScopeEntries([...relatedScopeIds], storageSnapshot);
    }

    async function canResolveTabGroup(groupId) {
      if (typeof chromeApi.tabGroups?.get !== "function") {
        return false;
      }
      try {
        await chromeApi.tabGroups.get(groupId);
        return true;
      } catch {
        return false;
      }
    }

    async function cleanupOrphanGroupScopes() {
      const storageSnapshot = await chromeApi.storage.local.get(null);
      const scopeEntries = collectStoredScopeEntries(storageSnapshot);
      const candidateGroupIds = new Set();

      for (const entry of scopeEntries.values()) {
        for (const groupId of entry.groupIds) {
          candidateGroupIds.add(groupId);
        }
      }

      if (candidateGroupIds.size === 0) {
        await appendCleanupAudit("orphan_scan_no_groups", {});
        return {
          removedScopeIds: [],
          removedKeyCount: 0
        };
      }

      const orphanScopeIds = new Set();
      for (const groupId of candidateGroupIds) {
        const exists = await canResolveTabGroup(groupId);
        if (!exists) {
          for (const scopeId of findScopeIdsByGroupId(scopeEntries, groupId)) {
            if (isChromeGroupScopeId(scopeId)) {
              orphanScopeIds.add(scopeId);
            }
          }
        }
      }

      if (orphanScopeIds.size === 0) {
        consoleApi.debug?.("[session-cleanup] orphan scope scan found nothing to remove");
        await appendCleanupAudit("orphan_scan_noop", {
          groupIds: [...candidateGroupIds]
        });
        return {
          removedScopeIds: [],
          removedKeyCount: 0
        };
      }

      return removeScopeEntries([...orphanScopeIds], storageSnapshot);
    }

    return {
      constants: {
        CHAT_SCOPE_PREFIX,
        CHAT_CLEANUP_AUDIT_KEY,
        CHAT_CLEANUP_AUDIT_LIMIT
      },
      normalizeStorageScopeId,
      extractScopeIdFromStorageKey,
      getGroupIdFromScopeId,
      isChromeGroupScopeId,
      getMainTabIdFromScopeId,
      collectGroupIdsFromStorageValue,
      collectMainTabIdsFromStorageValue,
      collectStoredScopeEntries,
      findScopeIdsByGroupId,
      appendCleanupAudit,
      removeScopeEntries,
      canResolveTabGroup,
      cleanupClosedGroupScopes,
      cleanupOrphanGroupScopes
    };
  }

  function createServiceWorkerRuntimeHandlers(deps) {
    const options = deps && typeof deps === "object" ? deps : {};
    const chromeApi = options.chrome;
    if (!chromeApi) {
      throw new Error("createServiceWorkerRuntimeHandlers requires a chrome dependency");
    }
    const consoleApi = options.console || globalThis.console || createNoopConsole();
    const cleanupRuntime = options.cleanupRuntime || createScopeCleanupRuntime(options);
    const normalizePositiveNumber = typeof options.normalizePositiveNumber === "function" ? options.normalizePositiveNumber : value => {
      const normalizedValue = Number(value);
      return Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.trunc(normalizedValue) : null;
    };
    const clearUninstallUrl = typeof options.clearUninstallUrl === "function" ? options.clearUninstallUrl : async () => {};
    const sweepDetachedWindowLocks = typeof options.sweepDetachedWindowLocks === "function" ? options.sweepDetachedWindowLocks : async () => ({});
    const readDetachedWindowLocks = typeof options.readDetachedWindowLocks === "function" ? options.readDetachedWindowLocks : async () => ({});
    const closeDetachedWindowForLockEntry = typeof options.closeDetachedWindowForLockEntry === "function" ? options.closeDetachedWindowForLockEntry : async () => false;
    const removeDetachedWindowLockByWindowId = typeof options.removeDetachedWindowLockByWindowId === "function" ? options.removeDetachedWindowLockByWindowId : async () => [];
    const openDetachedWindowForGroup = typeof options.openDetachedWindowForGroup === "function" ? options.openDetachedWindowForGroup : async () => ({
      success: false,
      error: "Missing openDetachedWindowForGroup dependency"
    });

    async function runBackgroundMaintenance() {
      await clearUninstallUrl();
      await cleanupRuntime.cleanupOrphanGroupScopes();
      await sweepDetachedWindowLocks();
    }

    function onInstalled() {
      runBackgroundMaintenance().catch(error => {
        consoleApi.warn?.("[background-maintenance] install maintenance failed", error);
      });
    }

    function onStartup() {
      runBackgroundMaintenance().catch(error => {
        consoleApi.warn?.("[background-maintenance] startup maintenance failed", error);
      });
    }

    function onTabGroupRemoved(group) {
      cleanupRuntime.cleanupClosedGroupScopes(group?.id).catch(error => {
        consoleApi.warn?.("[session-cleanup] closed group cleanup failed", error);
        cleanupRuntime.appendCleanupAudit("closed_group_failed", {
          groupId: Number(group?.id),
          message: error instanceof Error ? error.message : String(error || "")
        });
      });
    }

    function onWindowRemoved(windowId) {
      (async () => {
        const normalizedWindowId = normalizePositiveNumber(windowId);
        const locks = await readDetachedWindowLocks();
        const hostWindowLocks = Object.values(locks).filter(lockEntry =>
          lockEntry?.hostWindowId === normalizedWindowId &&
          lockEntry?.windowId !== normalizedWindowId
        );
        for (const lockEntry of hostWindowLocks) {
          await closeDetachedWindowForLockEntry(lockEntry);
        }
        await removeDetachedWindowLockByWindowId(windowId);
      })().catch(error => {
        consoleApi.warn?.("[detached-window] failed to cleanup popup lock", {
          windowId,
          message: error instanceof Error ? error.message : String(error || "")
        });
      });
    }

    function onTabRemoved(tabId) {
      (async () => {
        const locks = await readDetachedWindowLocks();
        const normalizedTabId = normalizePositiveNumber(tabId);
        for (const lockEntry of Object.values(locks)) {
          if (lockEntry?.mainTabId !== normalizedTabId) {
            continue;
          }
          await closeDetachedWindowForLockEntry(lockEntry);
        }
      })().catch(error => {
        consoleApi.warn?.("[detached-window] failed to cleanup popup after main tab removed", {
          tabId,
          message: error instanceof Error ? error.message : String(error || "")
        });
      });
    }

    function onMessage(message, sender, sendResponse) {
      if (message?.type !== OPEN_GROUP_DETACHED_WINDOW_MESSAGE_TYPE) {
        return false;
      }

      openDetachedWindowForGroup({
        ...message,
        tabId: normalizePositiveNumber(message?.tabId) ?? normalizePositiveNumber(sender?.tab?.id),
        mainTabId: normalizePositiveNumber(message?.mainTabId)
      }).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error || "Unknown detached window error")
        });
      });

      return true;
    }

    return {
      chrome: chromeApi,
      cleanupRuntime,
      clearUninstallUrl,
      runBackgroundMaintenance,
      handlers: {
        onInstalled,
        onStartup,
        onTabGroupRemoved,
        onWindowRemoved,
        onTabRemoved,
        onMessage
      }
    };
  }

  function registerServiceWorkerRuntimeHandlers(deps) {
    const runtime = createServiceWorkerRuntimeHandlers(deps);
    Promise.resolve(runtime.clearUninstallUrl()).catch(() => {});
    runtime.chrome.runtime?.onInstalled?.addListener?.(runtime.handlers.onInstalled);
    runtime.chrome.runtime?.onStartup?.addListener?.(runtime.handlers.onStartup);
    runtime.chrome.tabGroups?.onRemoved?.addListener?.(runtime.handlers.onTabGroupRemoved);
    runtime.chrome.windows?.onRemoved?.addListener?.(runtime.handlers.onWindowRemoved);
    runtime.chrome.tabs?.onRemoved?.addListener?.(runtime.handlers.onTabRemoved);
    runtime.chrome.runtime?.onMessage?.addListener?.(runtime.handlers.onMessage);
    return runtime;
  }

  globalThis.__CP_SERVICE_WORKER_RUNTIME__ = {
    constants: {
      CHAT_SCOPE_PREFIX,
      CHAT_CLEANUP_AUDIT_KEY,
      CHAT_CLEANUP_AUDIT_LIMIT
    },
    normalizeStorageScopeId,
    extractScopeIdFromStorageKey,
    createScopeCleanupRuntime,
    createServiceWorkerRuntimeHandlers,
    registerServiceWorkerRuntimeHandlers
  };
})();
