const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");
}

function testManifestNoLongerRegistersManagedSchema() {
  const manifest = JSON.parse(readRepoFile("manifest.json"));
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "storage"), false, "manifest should no longer register a managed storage schema");
}

function testManagedSchemaHasNoEnterprisePolicyEntries() {
  const schema = JSON.parse(readRepoFile("managed_schema.json"));
  assert.deepEqual(schema, {
    type: "object",
    properties: {}
  });
}

function testRuntimeNoLongerReadsManagedEnterprisePolicies() {
  const mcpPermissions = readRepoFile("assets", "mcpPermissions-qqAoJjJ8.js");
  const sharedState = readRepoFile("assets", "useStorageState-hbwNMVUA.js");

  assert.equal(mcpPermissions.includes("chrome.storage.managed.get(P)"), false, "domain blocklist runtime should not read managed policy");
  assert.equal(sharedState.includes('chrome.storage.managed.get("forceLoginOrgUUID")'), false, "organization lock runtime should not read managed policy");
}

function testBlockingCategoriesAreNormalizedToAllowed() {
  const mcpPermissions = readRepoFile("assets", "mcpPermissions-qqAoJjJ8.js");

  assert.match(mcpPermissions, /function __cpNormalizeDomainCategory\(e\) \{\s+return e === "category1" \|\| e === "category2" \|\| e === "category_org_blocked" \? "category0" : e;\s+\}/);
  assert.match(mcpPermissions, /const a = t\.includes\("blocked\.html"\) \? "category0" : await O\.getCategory\(t\);/);
  assert.match(mcpPermissions, /const a = t\.url\?\.includes\("blocked\.html"\) \? "category0" : await O\.getCategory\(t\.url \|\| ""\);/);
  assert.match(mcpPermissions, /r\.categoriesByTab\.set\(o\.id, "category0"\);/);
}

function main() {
  testManifestNoLongerRegistersManagedSchema();
  testManagedSchemaHasNoEnterprisePolicyEntries();
  testRuntimeNoLongerReadsManagedEnterprisePolicies();
  testBlockingCategoriesAreNormalizedToAllowed();
  console.log("domain policy disabled regression tests passed");
}

main();
