const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..", "..");
const sidepanelPath = path.join(rootDir, "assets", "sidepanel-BoLm9pmH.js");
const permissionManagerPath = path.join(rootDir, "assets", "PermissionManager-9s959502.js");
const storageChunkPath = path.join(rootDir, "assets", "useStorageState-hbwNMVUA.js");
const mapPath = path.join(rootDir, "DEOBFUSCATION_MAP.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(source, needle, label) {
  assert.equal(source.includes(needle), true, `${label} should include ${needle}`);
}

async function testSidepanelAnchorsExist() {
  const source = read(sidepanelPath);
  assertIncludes(source, "const __cpPermissionPromptStore = t1;", "sidepanel bundle");
  assertIncludes(source, "语义锚点：首屏模型 bootstrap 主链", "sidepanel bundle");
  assertIncludes(source, "语义锚点：这里是 sidepanel 的凭据刷新主入口", "sidepanel bundle");
}

async function testPermissionManagerAnchorsExist() {
  const source = read(permissionManagerPath);
  assertIncludes(source, "const __cpPermissionModesWithRelaxedPrompts = Sy;", "PermissionManager bundle");
  assertIncludes(source, "const __cpDefaultPlanApprovalMode = Ty;", "PermissionManager bundle");
  assertIncludes(source, "const __cpPermissionManagerClass = xy;", "PermissionManager bundle");
}

async function testStorageChunkAnchorExists() {
  const source = read(storageChunkPath);
  assertIncludes(source, "const __cpSidepanelStorageSupportChunk = true;", "useStorageState bundle");
}

async function testDeobfuscationMapMentionsCurrentFocusFiles() {
  const source = read(mapPath);
  assertIncludes(source, "assets/sidepanel-BoLm9pmH.js", "DEOBFUSCATION_MAP");
  assertIncludes(source, "assets/PermissionManager-9s959502.js", "DEOBFUSCATION_MAP");
  assertIncludes(source, "assets/useStorageState-hbwNMVUA.js", "DEOBFUSCATION_MAP");
}

async function main() {
  await testSidepanelAnchorsExist();
  await testPermissionManagerAnchorsExist();
  await testStorageChunkAnchorExists();
  await testDeobfuscationMapMentionsCurrentFocusFiles();
  console.log("deobfuscation anchor regression tests passed");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
