const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createChromeMock,
  runScriptInSandbox
} = require("../helpers/chrome-test-utils");

const rootDir = path.join(__dirname, "..", "..");
const contractPath = path.join(rootDir, "claw-contract.js");
const modelsPath = path.join(rootDir, "custom-provider-models.js");
const runtimePath = path.join(rootDir, "service-worker-runtime.js");
const loaderPath = path.join(rootDir, "service-worker-loader.js");
const manifestPath = path.join(rootDir, "manifest.json");
const sidepanelHtmlPath = path.join(rootDir, "sidepanel.html");
const optionsHtmlPath = path.join(rootDir, "options.html");
const releaseWorkflowPath = path.join(rootDir, ".github", "workflows", "release-extension.yml");

function createSandbox(overrides = {}) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    ...overrides
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadContractSandbox(overrides = {}) {
  const sandbox = createSandbox(overrides);
  runScriptInSandbox(contractPath, sandbox);
  return sandbox;
}

function indexOfOrFail(source, token, label) {
  const index = source.indexOf(token);
  assert.notEqual(index, -1, `${label} should include ${token}`);
  return index;
}

async function testContractExposesFrozenStableKeys() {
  const sandbox = loadContractSandbox();
  const contract = sandbox.__CP_CONTRACT__;

  assert.ok(contract, "contract should be attached to globalThis");
  assert.equal(contract.version, 1);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.customProvider), true);
  assert.equal(Object.isFrozen(contract.session), true);
  assert.equal(Object.isFrozen(contract.detachedWindow), true);
  assert.equal(contract.customProvider.STORAGE_KEY, "customProviderConfig");
  assert.equal(contract.customProvider.HTTP_PROVIDER_STORAGE_KEY, "customProviderAllowHttp");
  assert.equal(contract.session.CHAT_SCOPE_PREFIX, "claw.chat.scopes.");
  assert.equal(contract.detachedWindow.OPEN_GROUP_MESSAGE_TYPE, "OPEN_GROUP_DETACHED_WINDOW");
}

async function testRecoveredModulesReadFrozenContract() {
  const chromeMock = createChromeMock();
  const sandbox = loadContractSandbox({
    chrome: chromeMock.chrome,
    fetch: async () => {
      throw new Error("fetch should not be called in contract freeze test");
    }
  });
  runScriptInSandbox(modelsPath, sandbox);
  runScriptInSandbox(runtimePath, sandbox);

  const contract = sandbox.__CP_CONTRACT__;
  const helpers = sandbox.CustomProviderModels;
  const serviceWorkerApi = sandbox.__CP_SERVICE_WORKER_RUNTIME__;

  assert.equal(helpers.LEGACY_STORAGE_KEY, contract.customProvider.STORAGE_KEY);
  assert.equal(helpers.PROFILES_STORAGE_KEY, contract.customProvider.PROFILES_STORAGE_KEY);
  assert.equal(helpers.ACTIVE_PROFILE_STORAGE_KEY, contract.customProvider.ACTIVE_PROFILE_STORAGE_KEY);
  assert.equal(helpers.HTTP_PROVIDER_STORAGE_KEY, contract.customProvider.HTTP_PROVIDER_STORAGE_KEY);
  assert.equal(serviceWorkerApi.constants.CHAT_SCOPE_PREFIX, contract.session.CHAT_SCOPE_PREFIX);
  assert.equal(serviceWorkerApi.constants.CHAT_CLEANUP_AUDIT_KEY, contract.session.CHAT_CLEANUP_AUDIT_KEY);
}

async function testServiceWorkerRuntimeAcceptsContractMessageType() {
  const chromeMock = createChromeMock();
  const sandbox = loadContractSandbox({
    chrome: chromeMock.chrome
  });
  runScriptInSandbox(runtimePath, sandbox);

  let openCalls = 0;
  sandbox.__CP_SERVICE_WORKER_RUNTIME__.registerServiceWorkerRuntimeHandlers({
    chrome: chromeMock.chrome,
    console,
    openDetachedWindowForGroup: async () => {
      openCalls += 1;
      return {
        success: true
      };
    }
  });

  const listener = chromeMock.events.runtimeOnMessage.listeners[0];
  const response = await new Promise((resolve, reject) => {
    try {
      listener({
        type: sandbox.__CP_CONTRACT__.detachedWindow.OPEN_GROUP_MESSAGE_TYPE
      }, {
        tab: {
          id: 42
        }
      }, resolve);
    } catch (error) {
      reject(error);
    }
  });

  assert.equal(openCalls, 1);
  assert.equal(response.success, true);
}

async function testShellEntryPointsLoadContractBeforeRecoveredModules() {
  const sidepanelHtml = fs.readFileSync(sidepanelHtmlPath, "utf8");
  const optionsHtml = fs.readFileSync(optionsHtmlPath, "utf8");
  const loaderSource = fs.readFileSync(loaderPath, "utf8");

  const sidepanelContractIndex = indexOfOrFail(sidepanelHtml, "/claw-contract.js", "sidepanel.html");
  assert.ok(sidepanelContractIndex < indexOfOrFail(sidepanelHtml, "/custom-provider-models.js", "sidepanel.html"));
  assert.ok(sidepanelContractIndex < indexOfOrFail(sidepanelHtml, "/provider-format-adapter.js", "sidepanel.html"));
  assert.ok(sidepanelContractIndex < indexOfOrFail(sidepanelHtml, "/assets/sidepanel-BoLm9pmH.js", "sidepanel.html"));

  const optionsContractIndex = indexOfOrFail(optionsHtml, "/claw-contract.js", "options.html");
  assert.ok(optionsContractIndex < indexOfOrFail(optionsHtml, "/assets/options-Hyb_OzME.js", "options.html"));
  assert.ok(optionsContractIndex < indexOfOrFail(optionsHtml, "/custom-provider-models.js", "options.html"));

  assert.match(loaderSource, /import\s+"\.\/claw-contract\.js";/);
}

async function testReleaseAndManifestKeepFrozenShellInterfaces() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const workflow = fs.readFileSync(releaseWorkflowPath, "utf8");

  assert.equal(manifest.background?.service_worker, "service-worker-loader.js");
  assert.equal(manifest.options_page, "options.html");
  assert.match(workflow, /\bclaw-contract\.js\b/);
}

async function main() {
  await testContractExposesFrozenStableKeys();
  await testRecoveredModulesReadFrozenContract();
  await testServiceWorkerRuntimeAcceptsContractMessageType();
  await testShellEntryPointsLoadContractBeforeRecoveredModules();
  await testReleaseAndManifestKeepFrozenShellInterfaces();
  console.log("recovery contract freeze tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
