(function () {
  if (globalThis.__CP_DETACHED_WINDOW_RUNTIME__) {
    return;
  }

  const detachedWindowContract = globalThis.__CP_CONTRACT__?.detachedWindow || {};

  function createNoopConsole() {
    return {
      warn() {}
    };
  }

  function normalizeWindowSize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const normalizeDimension = (value, fallbackValue) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : fallbackValue;
    };
    return Object.freeze({
      width: normalizeDimension(source.width, 500),
      height: normalizeDimension(source.height, 768),
      left: normalizeDimension(source.left, 100),
      top: normalizeDimension(source.top, 100)
    });
  }

  function createDetachedWindowRuntime(deps) {
    const options = deps && typeof deps === "object" ? deps : {};
    const chromeApi = options.chrome || globalThis.chrome;
    if (!chromeApi?.runtime?.getURL || !chromeApi?.storage?.local || !chromeApi?.windows || !chromeApi?.tabs || !chromeApi?.tabGroups) {
      throw new Error("createDetachedWindowRuntime requires chrome runtime, storage, tabs, windows, and tabGroups");
    }

    const consoleApi = options.console || globalThis.console || createNoopConsole();
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const locksStorageKey = String(options.locksStorageKey || detachedWindowContract.LOCKS_STORAGE_KEY || "claw.detachedWindowLocks");
    const pagePath = String(options.pagePath || detachedWindowContract.PAGE_PATH || "sidepanel.html");
    const pageUrl = String(options.pageUrl || chromeApi.runtime.getURL(pagePath));
    const pageMeta = new URL(pageUrl);
    const detachedWindowSize = normalizeWindowSize(options.defaultSize || detachedWindowContract.DEFAULT_SIZE);

    const normalizePositiveNumber = value => {
      const normalizedValue = Number(value);
      return Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.trunc(normalizedValue) : null;
    };

    const normalizeWindowGroupId = value => {
      const normalizedValue = Number(value);
      return Number.isFinite(normalizedValue) && normalizedValue !== chromeApi.tabGroups.TAB_GROUP_ID_NONE ? Math.trunc(normalizedValue) : null;
    };

    const normalizeDetachedWindowLockEntry = value => {
      const groupId = normalizeWindowGroupId(value?.groupId);
      const windowId = normalizePositiveNumber(value?.windowId);
      if (groupId === null || windowId === null) {
        return null;
      }

      return {
        groupId,
        windowId,
        popupTabId: normalizePositiveNumber(value?.popupTabId),
        mainTabId: normalizePositiveNumber(value?.mainTabId),
        hostWindowId: normalizePositiveNumber(value?.hostWindowId),
        updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Math.trunc(Number(value.updatedAt)) : now()
      };
    };

    const readDetachedWindowLocks = async () => {
      try {
        const stored = await chromeApi.storage.local.get(locksStorageKey);
        const rawLocks = stored?.[locksStorageKey];
        const normalizedLocks = {};
        if (!rawLocks || typeof rawLocks !== "object") {
          return normalizedLocks;
        }
        for (const [rawGroupId, rawEntry] of Object.entries(rawLocks)) {
          const normalizedEntry = normalizeDetachedWindowLockEntry(rawEntry);
          if (!normalizedEntry) {
            continue;
          }
          normalizedLocks[String(normalizedEntry.groupId || rawGroupId)] = normalizedEntry;
        }
        return normalizedLocks;
      } catch {
        return {};
      }
    };

    const writeDetachedWindowLocks = async locks => {
      await chromeApi.storage.local.set({
        [locksStorageKey]: locks
      });
      return locks;
    };

    const upsertDetachedWindowLock = async entry => {
      const normalizedEntry = normalizeDetachedWindowLockEntry({
        ...entry,
        updatedAt: now()
      });
      if (!normalizedEntry) {
        return null;
      }

      const locks = await readDetachedWindowLocks();
      locks[String(normalizedEntry.groupId)] = normalizedEntry;
      await writeDetachedWindowLocks(locks);
      return normalizedEntry;
    };

    const removeDetachedWindowLockByWindowId = async windowIdValue => {
      const windowId = normalizePositiveNumber(windowIdValue);
      if (windowId === null) {
        return [];
      }

      const locks = await readDetachedWindowLocks();
      const removedLocks = [];
      let changed = false;
      for (const [groupId, lockEntry] of Object.entries(locks)) {
        if (lockEntry?.windowId !== windowId) {
          continue;
        }
        removedLocks.push(lockEntry);
        delete locks[groupId];
        changed = true;
      }

      if (changed) {
        await writeDetachedWindowLocks(locks);
      }
      return removedLocks;
    };

    const buildDetachedWindowUrl = ({
      tabId,
      groupId
    }) => chromeApi.runtime.getURL(`${pagePath}?mode=window&tabId=${encodeURIComponent(tabId)}&groupId=${encodeURIComponent(groupId)}`);

    const parseDetachedWindowUrl = url => {
      try {
        const parsedUrl = new URL(String(url || ""));
        if (parsedUrl.origin !== pageMeta.origin || parsedUrl.pathname !== pageMeta.pathname) {
          return null;
        }
        if (parsedUrl.searchParams.get("mode") !== "window") {
          return null;
        }
        const groupId = normalizeWindowGroupId(parsedUrl.searchParams.get("groupId"));
        if (groupId === null) {
          return null;
        }
        return {
          groupId,
          tabId: normalizePositiveNumber(parsedUrl.searchParams.get("tabId"))
        };
      } catch {
        return null;
      }
    };

    const ensureDetachedWindowGroupContext = async preferredTabId => {
      const tabId = normalizePositiveNumber(preferredTabId);
      if (tabId === null) {
        throw new Error("Missing target tab id");
      }

      const tab = await chromeApi.tabs.get(tabId);
      let groupId = normalizeWindowGroupId(tab?.groupId);
      if (groupId === null) {
        groupId = normalizeWindowGroupId(await chromeApi.tabs.group({
          tabIds: [tabId]
        }));
      }
      if (groupId === null) {
        throw new Error("Failed to resolve tab group");
      }

      return {
        tabId,
        groupId,
        hostWindowId: normalizePositiveNumber(tab?.windowId)
      };
    };

    const closeDetachedWindowForLockEntry = async lockEntryValue => {
      const lockEntry = normalizeDetachedWindowLockEntry(lockEntryValue);
      if (!lockEntry) {
        return false;
      }

      const locks = await readDetachedWindowLocks();
      delete locks[String(lockEntry.groupId)];
      await writeDetachedWindowLocks(locks);

      try {
        await chromeApi.windows.remove(lockEntry.windowId);
      } catch {}
      return true;
    };

    const findDetachedWindowByGroupId = async groupIdValue => {
      const groupId = normalizeWindowGroupId(groupIdValue);
      if (groupId === null) {
        return null;
      }

      const popupWindows = await chromeApi.windows.getAll({
        populate: true
      });
      for (const popupWindow of popupWindows) {
        if (popupWindow?.type !== "popup") {
          continue;
        }
        for (const popupTab of popupWindow.tabs || []) {
          const detachedWindowMeta = parseDetachedWindowUrl(popupTab?.url);
          if (detachedWindowMeta?.groupId === groupId) {
            return {
              windowId: normalizePositiveNumber(popupWindow.id),
              tabId: normalizePositiveNumber(popupTab.id),
              meta: detachedWindowMeta
            };
          }
        }
      }

      return null;
    };

    const focusDetachedWindow = async ({
      windowId,
      tabId
    }) => {
      const normalizedWindowId = normalizePositiveNumber(windowId);
      if (tabId) {
        await chromeApi.tabs.update(tabId, {
          active: true
        });
      }
      if (normalizedWindowId !== null) {
        await chromeApi.windows.update(normalizedWindowId, {
          focused: true
        });
      }
    };

    const createDetachedWindow = async ({
      tabId,
      groupId
    }) => {
      const detachedWindow = await chromeApi.windows.create({
        url: buildDetachedWindowUrl({
          tabId,
          groupId
        }),
        type: "popup",
        width: detachedWindowSize.width,
        height: detachedWindowSize.height,
        left: detachedWindowSize.left,
        top: detachedWindowSize.top,
        focused: true
      });
      return {
        success: true,
        reused: false,
        groupId,
        windowId: normalizePositiveNumber(detachedWindow?.id),
        popupTabId: normalizePositiveNumber(detachedWindow?.tabs?.[0]?.id)
      };
    };

    const sweepDetachedWindowLocks = async () => {
      const existingLocks = await readDetachedWindowLocks();
      const nextLocks = {};

      for (const lockEntry of Object.values(existingLocks)) {
        const activeDetachedWindow = await findDetachedWindowByGroupId(lockEntry.groupId);
        if (!activeDetachedWindow?.windowId) {
          continue;
        }
        let hostWindowId = lockEntry.hostWindowId;
        if (lockEntry.mainTabId) {
          try {
            hostWindowId = normalizePositiveNumber((await chromeApi.tabs.get(lockEntry.mainTabId)).windowId) ?? hostWindowId;
          } catch {}
        }
        const normalizedLock = normalizeDetachedWindowLockEntry({
          groupId: lockEntry.groupId,
          windowId: activeDetachedWindow.windowId,
          popupTabId: activeDetachedWindow.tabId,
          mainTabId: lockEntry.mainTabId ?? activeDetachedWindow.meta?.tabId,
          hostWindowId,
          updatedAt: now()
        });
        if (!normalizedLock) {
          continue;
        }
        nextLocks[String(normalizedLock.groupId)] = normalizedLock;
      }

      const existingEntries = Object.entries(existingLocks);
      const nextEntries = Object.entries(nextLocks);
      const hasChanged = existingEntries.length !== nextEntries.length || nextEntries.some(([groupId, lockEntry]) => {
        const existingLock = existingLocks[groupId];
        return !existingLock || existingLock.windowId !== lockEntry.windowId || existingLock.popupTabId !== lockEntry.popupTabId || existingLock.mainTabId !== lockEntry.mainTabId || existingLock.hostWindowId !== lockEntry.hostWindowId;
      });

      if (hasChanged) {
        await writeDetachedWindowLocks(nextLocks);
      }

      return nextLocks;
    };

    const openDetachedWindowForGroup = async payload => {
      await sweepDetachedWindowLocks();
      const preferredTabId = normalizePositiveNumber(payload?.mainTabId) ?? normalizePositiveNumber(payload?.tabId);
      const {
        tabId,
        groupId,
        hostWindowId
      } = await ensureDetachedWindowGroupContext(preferredTabId);
      const existingDetachedWindow = await findDetachedWindowByGroupId(groupId);

      if (existingDetachedWindow && existingDetachedWindow.windowId !== null) {
        try {
          if (existingDetachedWindow.tabId && existingDetachedWindow.meta?.tabId !== tabId) {
            await chromeApi.tabs.update(existingDetachedWindow.tabId, {
              url: buildDetachedWindowUrl({
                tabId,
                groupId
              }),
              active: true
            });
          }
          await focusDetachedWindow(existingDetachedWindow);
          await upsertDetachedWindowLock({
            groupId,
            windowId: existingDetachedWindow.windowId,
            popupTabId: existingDetachedWindow.tabId,
            mainTabId: tabId,
            hostWindowId
          });
          return {
            success: true,
            reused: true,
            groupId,
            windowId: existingDetachedWindow.windowId,
            popupTabId: existingDetachedWindow.tabId
          };
        } catch (error) {
          consoleApi.warn?.("[detached-window] failed to reuse popup", {
            groupId,
            message: error instanceof Error ? error.message : String(error || "")
          });
        }
      }

      const createdDetachedWindow = await createDetachedWindow({
        tabId,
        groupId
      });
      await upsertDetachedWindowLock({
        groupId,
        windowId: createdDetachedWindow.windowId,
        popupTabId: createdDetachedWindow.popupTabId,
        mainTabId: tabId,
        hostWindowId
      });
      return createdDetachedWindow;
    };

    return {
      constants: {
        LOCKS_STORAGE_KEY: locksStorageKey,
        PAGE_PATH: pagePath,
        DEFAULT_SIZE: detachedWindowSize
      },
      normalizePositiveNumber,
      normalizeWindowGroupId,
      normalizeDetachedWindowLockEntry,
      readDetachedWindowLocks,
      writeDetachedWindowLocks,
      upsertDetachedWindowLock,
      removeDetachedWindowLockByWindowId,
      buildDetachedWindowUrl,
      parseDetachedWindowUrl,
      ensureDetachedWindowGroupContext,
      closeDetachedWindowForLockEntry,
      findDetachedWindowByGroupId,
      focusDetachedWindow,
      createDetachedWindow,
      sweepDetachedWindowLocks,
      openDetachedWindowForGroup
    };
  }

  globalThis.__CP_DETACHED_WINDOW_RUNTIME__ = {
    createDetachedWindowRuntime
  };
})();
