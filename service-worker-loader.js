import "./claw-contract.js";
import "./custom-provider-models.js";
import "./provider-format-adapter.js";
import "./assets/service-worker.ts-H0DVM1LS.js";
import "./github-update-shared.js";
import "./github-update-worker.js";
import "./service-worker-detached-window-runtime.js";
import "./service-worker-shortcut-workflow-sync.js";
import "./service-worker-runtime.js";

const serviceWorkerRuntimeApi = globalThis.__CP_SERVICE_WORKER_RUNTIME__;
const detachedWindowRuntimeApi = globalThis.__CP_DETACHED_WINDOW_RUNTIME__;
const detachedWindowRuntime = detachedWindowRuntimeApi?.createDetachedWindowRuntime({
  chrome,
  console
});

// Clear the uninstall survey URL registered by the bundled worker.
const clearUninstallUrl = async () => {
  try {
    await chrome.runtime.setUninstallURL("");
  } catch {}
};

if (serviceWorkerRuntimeApi && detachedWindowRuntime) {
  serviceWorkerRuntimeApi.registerServiceWorkerRuntimeHandlers({
    chrome,
    console,
    clearUninstallUrl,
    sweepDetachedWindowLocks: detachedWindowRuntime.sweepDetachedWindowLocks,
    readDetachedWindowLocks: detachedWindowRuntime.readDetachedWindowLocks,
    closeDetachedWindowForLockEntry: detachedWindowRuntime.closeDetachedWindowForLockEntry,
    removeDetachedWindowLockByWindowId: detachedWindowRuntime.removeDetachedWindowLockByWindowId,
    openDetachedWindowForGroup: detachedWindowRuntime.openDetachedWindowForGroup,
    normalizePositiveNumber: detachedWindowRuntime.normalizePositiveNumber
  });
}
