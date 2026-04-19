const assert = require("node:assert/strict");
const path = require("node:path");

const {
  createChromeMock,
  flushMicrotasks,
  runScriptInSandbox
} = require("../helpers/chrome-test-utils");
const {
  FakeDocument,
  FakeElement,
  FakeMutationObserver
} = require("../helpers/fake-dom");

const corePath = path.join(__dirname, "..", "..", "visualizer-core.js");
const contractPath = path.join(__dirname, "..", "..", "claw-contract.js");
const scriptPath = path.join(__dirname, "..", "..", "visualizer.js");

function createVisualizerLocaleHarness(options = {}) {
  const chromeMock = createChromeMock({
    storageState: options.storageState || {}
  });
  const document = new FakeDocument({
    readyState: "complete",
    lang: options.lang || "en"
  });
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);

  const sandbox = {
    console,
    chrome: chromeMock.chrome,
    document,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    navigator: {
      language: options.language || "en-US"
    },
    location: {
      search: options.search || ""
    },
    URLSearchParams,
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;

  runScriptInSandbox(contractPath, sandbox);
  runScriptInSandbox(corePath, sandbox);
  runScriptInSandbox(scriptPath, sandbox);

  return {
    chromeMock,
    document,
    root,
    async flush() {
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    }
  };
}

async function testVisualizerUsesStoredPreferredLocaleOnDirectOpen() {
  const harness = createVisualizerLocaleHarness({
    language: "en-US",
    storageState: {
      preferred_locale: "zh-CN"
    }
  });

  await harness.flush();

  assert.equal(harness.document.title, "Claw 执行可视化");
  assert.equal(harness.document.documentElement.lang, "zh-CN");
  assert.match(String(harness.root.innerHTML || ""), /请先发起一次会话后再来此界面/);
}

async function testVisualizerRerendersWhenPreferredLocaleChanges() {
  const harness = createVisualizerLocaleHarness({
    language: "en-US",
    storageState: {
      preferred_locale: "en-US"
    }
  });

  await harness.flush();
  assert.equal(harness.document.title, "Claw Visualizer");
  assert.equal(harness.document.documentElement.lang, "en");

  await harness.chromeMock.storageMock.area.set({
    preferred_locale: "zh-CN"
  });
  await harness.flush();

  assert.equal(harness.document.title, "Claw 执行可视化");
  assert.equal(harness.document.documentElement.lang, "zh-CN");
}

async function main() {
  await testVisualizerUsesStoredPreferredLocaleOnDirectOpen();
  await testVisualizerRerendersWhenPreferredLocaleChanges();
  console.log("visualizer locale tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
