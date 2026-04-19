const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..", "..");
const sharedPath = path.join(rootDir, "github-update-shared.js");
const optionsPath = path.join(rootDir, "github-update-options.js");
const sidepanelPath = path.join(rootDir, "github-update-sidepanel.js");

function main() {
  const sharedSource = fs.readFileSync(sharedPath, "utf8");
  const optionsSource = fs.readFileSync(optionsPath, "utf8");
  const sidepanelSource = fs.readFileSync(sidepanelPath, "utf8");

  assert.match(
    sharedSource,
    /function detectUiLocaleKey\(options\) \{/,
    "github update shared should expose a shared UI locale detector"
  );

  assert.match(
    sharedSource,
    /function getUiLocaleTag\(options\) \{/,
    "github update shared should expose a locale tag helper"
  );

  assert.match(
    optionsSource,
    /return detectUiLocaleKey\(getLocaleOptions\(\)\);/,
    "github update options should derive locale from the shared detector"
  );

  assert.doesNotMatch(
    optionsSource,
    /const localeKey = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\) \? "zh" : "en";/,
    "github update options should no longer freeze locale from navigator.language"
  );

  assert.match(
    sidepanelSource,
    /return detectUiLocaleKey\(getLocaleOptions\(\)\);/,
    "github update sidepanel should derive locale from the shared detector"
  );

  assert.doesNotMatch(
    sidepanelSource,
    /const localeKey = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\) \? "zh" : "en";/,
    "github update sidepanel should no longer freeze locale from navigator.language"
  );

  assert.match(
    sidepanelSource,
    /if \(nextLocaleKey !== lastLocaleKey\) \{\s*render\(\);/s,
    "github update sidepanel should rerender when the detected UI locale changes after bootstrap"
  );

  console.log("github update locale regression test passed");
}

main();
