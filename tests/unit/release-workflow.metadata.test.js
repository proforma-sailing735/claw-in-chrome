const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", "..", ".github", "workflows", "release-extension.yml");
const workflowSource = fs.readFileSync(workflowPath, "utf8");

function testPackageListIncludesRuntimeDependencies() {
  assert.match(workflowSource, /github-update-worker-runtime\.js/, "release archive should include github-update-worker-runtime.js");
  assert.match(workflowSource, /service-worker-runtime\.js/, "release archive should include service-worker-runtime.js");
  assert.match(workflowSource, /options-update-enhancer\.js/, "release archive should include options-update-enhancer.js");
}

function testMinSupportedVersionIsOptional() {
  assert.match(workflowSource, /workflow_dispatch:\s+inputs:\s+min_supported_version:/m, "workflow_dispatch should expose optional min_supported_version input");
  assert.doesNotMatch(workflowSource, /min_supported_version:\s*version/, "workflow should not force every release to block all older versions");
  assert.match(workflowSource, /if \(minSupportedVersion\)\s*\{\s*payload\.min_supported_version = minSupportedVersion;/m, "latest.json should only include min_supported_version when explicitly provided");
}

function testReleaseNotesPreferPreviousTagRange() {
  assert.match(workflowSource, /git tag --list 'v\*' --sort=-version:refname/, "workflow should look up the previous release tag");
  assert.match(workflowSource, /git log --format='- %s' "\$\{PREVIOUS_TAG\}\.\.HEAD"/, "workflow should build notes from the previous tag to HEAD");
}

function main() {
  testPackageListIncludesRuntimeDependencies();
  testMinSupportedVersionIsOptional();
  testReleaseNotesPreferPreviousTagRange();
  console.log("release workflow metadata tests passed");
}

main();
