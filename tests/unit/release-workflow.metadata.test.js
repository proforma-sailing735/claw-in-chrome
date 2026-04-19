const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", "..", ".github", "workflows", "release-extension.yml");
const optionsHtmlPath = path.join(__dirname, "..", "..", "options.html");
const sidepanelHtmlPath = path.join(__dirname, "..", "..", "sidepanel.html");
const pairingHtmlPath = path.join(__dirname, "..", "..", "pairing.html");
const offscreenHtmlPath = path.join(__dirname, "..", "..", "offscreen.html");
const gifViewerHtmlPath = path.join(__dirname, "..", "..", "gif_viewer.html");
const serviceWorkerLoaderPath = path.join(__dirname, "..", "..", "service-worker-loader.js");
const workflowSource = fs.readFileSync(workflowPath, "utf8");
const optionsHtml = fs.readFileSync(optionsHtmlPath, "utf8");
const sidepanelHtml = fs.readFileSync(sidepanelHtmlPath, "utf8");
const pairingHtml = fs.readFileSync(pairingHtmlPath, "utf8");
const offscreenHtml = fs.readFileSync(offscreenHtmlPath, "utf8");
const gifViewerHtml = fs.readFileSync(gifViewerHtmlPath, "utf8");
const serviceWorkerLoaderSource = fs.readFileSync(serviceWorkerLoaderPath, "utf8");

function getPackageItems() {
  const packageBlockMatch = workflowSource.match(/PACKAGE_ITEMS=\(\s*([\s\S]*?)\s*\)/);
  assert.ok(packageBlockMatch, "release workflow should define PACKAGE_ITEMS");
  return new Set(
    packageBlockMatch[1]
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  );
}

function getLocalShellDependencies(htmlSource) {
  const dependencies = new Set();
  const pattern = /\b(?:src|href)="\/([^"]+)"/g;
  let match = null;
  while ((match = pattern.exec(htmlSource))) {
    const target = String(match[1] || "").trim();
    if (!target || target.startsWith("assets/")) {
      continue;
    }
    dependencies.add(target);
  }
  return dependencies;
}

function getLocalHtmlScriptDependencies(htmlSource) {
  const dependencies = new Set();
  const pattern = /\bscript\s+src="([^"]+)"/g;
  let match = null;
  while ((match = pattern.exec(htmlSource))) {
    const target = String(match[1] || "").trim().replace(/^\/+/, "");
    if (!target || target.startsWith("assets/")) {
      continue;
    }
    dependencies.add(target);
  }
  return dependencies;
}

function getLocalImportedModules(source) {
  const dependencies = new Set();
  const pattern = /import\s+["']\.\/([^"']+)["'];/g;
  let match = null;
  while ((match = pattern.exec(source))) {
    const target = String(match[1] || "").trim();
    if (!target || target.startsWith("assets/")) {
      continue;
    }
    dependencies.add(target);
  }
  return dependencies;
}

function testPackageListIncludesRuntimeDependencies() {
  const packageItems = getPackageItems();
  const requiredDependencies = new Set([
    ...getLocalShellDependencies(optionsHtml),
    ...getLocalShellDependencies(sidepanelHtml),
    ...getLocalShellDependencies(pairingHtml),
    ...getLocalHtmlScriptDependencies(offscreenHtml),
    ...getLocalHtmlScriptDependencies(gifViewerHtml),
    ...getLocalImportedModules(serviceWorkerLoaderSource),
    "github-update-worker-runtime.js",
    "service-worker-runtime.js",
    "options-update-enhancer.js"
  ]);

  for (const dependency of requiredDependencies) {
    assert.ok(packageItems.has(dependency), `release archive should include ${dependency}`);
  }
}

function testReleaseArchiveExcludesLocalPreviewAddon() {
  const packageItems = getPackageItems();
  assert.equal(
    packageItems.has("options-update-preview.local.js"),
    false,
    "release archive should exclude the local-only update preview addon"
  );
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
  testReleaseArchiveExcludesLocalPreviewAddon();
  testMinSupportedVersionIsOptional();
  testReleaseNotesPreferPreviousTagRange();
  console.log("release workflow metadata tests passed");
}

main();
