import "./claw-contract.js";
import "./custom-provider-models.js";
import "./provider-format-adapter.js";
import "./assets/service-worker.ts-H0DVM1LS.js";
import "./github-update-shared.js";
import "./github-update-worker.js";
import "./service-worker-runtime.js";

const serviceWorkerRuntimeApi = globalThis.__CP_SERVICE_WORKER_RUNTIME__;
const detachedWindowContract = globalThis.__CP_CONTRACT__?.detachedWindow || {};
const detachedWindowDefaultSize = detachedWindowContract.DEFAULT_SIZE && typeof detachedWindowContract.DEFAULT_SIZE === "object"
  ? detachedWindowContract.DEFAULT_SIZE
  : {};

const DETACHED_WINDOW_SIZE = Object.freeze({
  width: Number.isFinite(Number(detachedWindowDefaultSize.width)) ? Math.trunc(Number(detachedWindowDefaultSize.width)) : 500,
  height: Number.isFinite(Number(detachedWindowDefaultSize.height)) ? Math.trunc(Number(detachedWindowDefaultSize.height)) : 768,
  left: Number.isFinite(Number(detachedWindowDefaultSize.left)) ? Math.trunc(Number(detachedWindowDefaultSize.left)) : 100,
  top: Number.isFinite(Number(detachedWindowDefaultSize.top)) ? Math.trunc(Number(detachedWindowDefaultSize.top)) : 100
});
const DETACHED_WINDOW_LOCKS_KEY = detachedWindowContract.LOCKS_STORAGE_KEY || "claw.detachedWindowLocks";
const DETACHED_WINDOW_PAGE_PATH = detachedWindowContract.PAGE_PATH || "sidepanel.html";
const DETACHED_WINDOW_PAGE_URL = chrome.runtime.getURL(DETACHED_WINDOW_PAGE_PATH);
const DETACHED_WINDOW_PAGE_META = new URL(DETACHED_WINDOW_PAGE_URL);

const normalizePositiveNumber = value => {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.trunc(normalizedValue) : null;
};

const normalizeWindowGroupId = value => {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) && normalizedValue !== chrome.tabGroups.TAB_GROUP_ID_NONE ? Math.trunc(normalizedValue) : null;
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
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Math.trunc(Number(value.updatedAt)) : Date.now()
  };
};

const readDetachedWindowLocks = async () => {
  try {
    const stored = await chrome.storage.local.get(DETACHED_WINDOW_LOCKS_KEY);
    const rawLocks = stored?.[DETACHED_WINDOW_LOCKS_KEY];
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
  await chrome.storage.local.set({
    [DETACHED_WINDOW_LOCKS_KEY]: locks
  });
  return locks;
};

const upsertDetachedWindowLock = async entry => {
  const normalizedEntry = normalizeDetachedWindowLockEntry({
    ...entry,
    updatedAt: Date.now()
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
        hostWindowId = normalizePositiveNumber((await chrome.tabs.get(lockEntry.mainTabId)).windowId) ?? hostWindowId;
      } catch {}
    }
    const normalizedLock = normalizeDetachedWindowLockEntry({
      groupId: lockEntry.groupId,
      windowId: activeDetachedWindow.windowId,
      popupTabId: activeDetachedWindow.tabId,
      mainTabId: lockEntry.mainTabId ?? activeDetachedWindow.meta?.tabId,
      hostWindowId,
      updatedAt: Date.now()
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

const buildDetachedWindowUrl = ({
  tabId,
  groupId
}) => chrome.runtime.getURL(`${DETACHED_WINDOW_PAGE_PATH}?mode=window&tabId=${encodeURIComponent(tabId)}&groupId=${encodeURIComponent(groupId)}`);

const parseDetachedWindowUrl = url => {
  try {
    const parsedUrl = new URL(String(url || ""));
    if (parsedUrl.origin !== DETACHED_WINDOW_PAGE_META.origin || parsedUrl.pathname !== DETACHED_WINDOW_PAGE_META.pathname) {
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

  const tab = await chrome.tabs.get(tabId);
  let groupId = normalizeWindowGroupId(tab?.groupId);
  if (groupId === null) {
    groupId = normalizeWindowGroupId(await chrome.tabs.group({
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
    await chrome.windows.remove(lockEntry.windowId);
  } catch {}
  return true;
};

const findDetachedWindowByGroupId = async groupIdValue => {
  const groupId = normalizeWindowGroupId(groupIdValue);
  if (groupId === null) {
    return null;
  }

  const popupWindows = await chrome.windows.getAll({
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
    await chrome.tabs.update(tabId, {
      active: true
    });
  }
  if (normalizedWindowId !== null) {
    await chrome.windows.update(normalizedWindowId, {
      focused: true
    });
  }
};

const createDetachedWindow = async ({
  tabId,
  groupId
}) => {
  const detachedWindow = await chrome.windows.create({
    url: buildDetachedWindowUrl({
      tabId,
      groupId
    }),
    type: "popup",
    width: DETACHED_WINDOW_SIZE.width,
    height: DETACHED_WINDOW_SIZE.height,
    left: DETACHED_WINDOW_SIZE.left,
    top: DETACHED_WINDOW_SIZE.top,
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
        await chrome.tabs.update(existingDetachedWindow.tabId, {
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
      console.warn("[detached-window] failed to reuse popup", {
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

// Clear the uninstall survey URL registered by the bundled worker.
const clearUninstallUrl = async () => {
  try {
    await chrome.runtime.setUninstallURL("");
  } catch {}
};

if (serviceWorkerRuntimeApi) {
  serviceWorkerRuntimeApi.registerServiceWorkerRuntimeHandlers({
    chrome,
    console,
    clearUninstallUrl,
    sweepDetachedWindowLocks,
    readDetachedWindowLocks,
    closeDetachedWindowForLockEntry,
    removeDetachedWindowLockByWindowId,
    openDetachedWindowForGroup,
    normalizePositiveNumber
  });
}
