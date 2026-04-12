const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const repoRoot = path.join(__dirname, "..", "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function findBrowserExecutable() {
  const envPath = process.env.CLAW_E2E_BROWSER_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  return null;
}

function computeExtensionIdFromKey(publicKeyBase64) {
  const publicKeyBytes = Buffer.from(String(publicKeyBase64 || "").trim(), "base64");
  const digest = crypto.createHash("sha256").update(publicKeyBytes).digest("hex").slice(0, 32);
  return digest.split("").map((char) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(char, 16))).join("");
}

async function launchExtensionContext() {
  const browserPath = findBrowserExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-extension-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(browserPath ? {
      executablePath: browserPath
    } : {}),
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${repoRoot}`,
      `--load-extension=${repoRoot}`
    ]
  });
  return {
    browserPath,
    userDataDir,
    context
  };
}

async function closeExtensionContext(contextInfo) {
  try {
    await contextInfo.context.close();
  } finally {
    fs.rmSync(contextInfo.userDataDir, {
      recursive: true,
      force: true
    });
  }
}

async function waitForExtensionServiceWorker(context, extensionId) {
  const existing = context.serviceWorkers().find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`));
  if (existing) {
    return existing;
  }
  try {
    return await context.waitForEvent("serviceworker", {
      timeout: 5000,
      predicate: (worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`)
    });
  } catch {
    return null;
  }
}

async function capturePageErrors(page, action) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error || ""));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await action({
    pageErrors,
    consoleErrors
  });
  return {
    pageErrors,
    consoleErrors
  };
}

async function testExtensionPagesLoad() {
  const extensionId = computeExtensionIdFromKey(manifest.key);
  const contextInfo = await launchExtensionContext();
  try {
    const optionsPage = await contextInfo.context.newPage();
    const optionsResult = await capturePageErrors(optionsPage, async () => {
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded"
      });
      await optionsPage.waitForFunction(() => {
        return Boolean(document.querySelector("#root")) &&
          Boolean(globalThis.__CP_GITHUB_UPDATE_SHARED__) &&
          Boolean(globalThis.CustomProviderModels);
      }, null, {
        timeout: 15000
      });
    });

    assert.equal(await optionsPage.title(), "Claw in Chrome Options");
    const optionsManifest = await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        __claw_e2e_options: "ok"
      });
      const stored = await chrome.storage.local.get("__claw_e2e_options");
      return {
        runtimeId: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
        version: chrome.runtime.getManifest().version,
        stored: stored.__claw_e2e_options
      };
    });
    assert.equal(optionsManifest.runtimeId, extensionId);
    assert.equal(optionsManifest.name, manifest.name);
    assert.equal(optionsManifest.version, manifest.version);
    assert.equal(optionsManifest.stored, "ok");
    assert.deepEqual(optionsResult.pageErrors, []);

    const sidepanelPage = await contextInfo.context.newPage();
    const sidepanelResult = await capturePageErrors(sidepanelPage, async () => {
      await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
        waitUntil: "domcontentloaded"
      });
      await sidepanelPage.waitForFunction(() => {
        return Boolean(document.querySelector("#root")) &&
          Boolean(globalThis.__CP_GITHUB_UPDATE_SHARED__) &&
          Boolean(globalThis.CustomProviderModels);
      }, null, {
        timeout: 15000
      });
    });

    assert.equal(await sidepanelPage.title(), "Claw in Chrome");
    const sidepanelManifest = await sidepanelPage.evaluate(() => ({
      runtimeId: chrome.runtime.id,
      name: chrome.runtime.getManifest().name,
      version: chrome.runtime.getManifest().version
    }));
    assert.equal(sidepanelManifest.runtimeId, extensionId);
    assert.equal(sidepanelManifest.name, manifest.name);
    assert.equal(sidepanelManifest.version, manifest.version);
    assert.deepEqual(sidepanelResult.pageErrors, []);

    const serviceWorker = await waitForExtensionServiceWorker(contextInfo.context, extensionId);
    if (serviceWorker) {
      assert.equal(serviceWorker.url().startsWith(`chrome-extension://${extensionId}/`), true);
    }
  } finally {
    await closeExtensionContext(contextInfo);
  }
}

async function main() {
  await testExtensionPagesLoad();
  console.log("extension pages e2e smoke tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
