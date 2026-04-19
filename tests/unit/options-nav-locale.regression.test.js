const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..", "..");
const optionsBundlePath = path.join(rootDir, "assets", "options-Hyb_OzME.js");
const optionsEnhancerPath = path.join(rootDir, "options-update-enhancer.js");
const optionsUpdatePreviewPath = path.join(rootDir, "options-update-preview.local.js");

function main() {
  const optionsBundleSource = fs.readFileSync(optionsBundlePath, "utf8");
  const optionsEnhancerSource = fs.readFileSync(optionsEnhancerPath, "utf8");
  const optionsUpdatePreviewSource = fs.readFileSync(optionsUpdatePreviewPath, "utf8");

  assert.match(
    optionsBundleSource,
    /function cpGetOptionsLocaleKey\(e\) \{/,
    "options bundle should normalize locale through a shared helper"
  );

  assert.match(
    optionsBundleSource,
    /const intl = e\(\);\s*const locale = intl\?\.locale \|\| "en-US";/s,
    "update card should read locale from the options page intl context"
  );

  assert.match(
    optionsBundleSource,
    /const h = cpGetGithubUpdateStrings\(locale\);/,
    "update card copy should be derived from the intl locale"
  );

  assert.match(
    optionsBundleSource,
    /function ce\(\) \{\s*const intl = e\(\);\s*const navStrings = cpGetOptionsNavStrings\(intl\?\.locale \|\| "en-US"\);/s,
    "options sub-navigation should use the already resolved intl locale on the first visible render"
  );

  assert.doesNotMatch(
    optionsBundleSource,
    /useState\(\(\) => cpGetOptionsNavStrings\(navigator\.language\)\)/,
    "options sub-navigation should no longer bootstrap from navigator.language and then correct itself later"
  );

  assert.doesNotMatch(
    optionsBundleSource,
    /const p = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\) \? "zh-CN" : "en-US";/,
    "update card timestamps should no longer derive locale directly from navigator.language"
  );

  assert.doesNotMatch(
    optionsBundleSource,
    /const cpGithubUpdateStrings = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\)/,
    "update card copy should no longer hardcode locale selection from navigator.language at bundle load time"
  );

  assert.match(
    optionsEnhancerSource,
    /function getOptionsLocaleKey\(\) \{/,
    "options enhancer should resolve locale from the current options page instead of freezing browser language at load time"
  );

  assert.match(
    optionsEnhancerSource,
    /return detectUiLocaleKey\(getOptionsLocaleOptions\(\)\);/,
    "options enhancer should delegate locale detection to the shared github update locale helper"
  );

  assert.match(
    optionsEnhancerSource,
    /function getStrings\(\) \{\s*return STRINGS\[getOptionsLocaleKey\(\)\];\s*\}/s,
    "options enhancer should derive all copy from the live locale helper"
  );

  assert.match(
    optionsEnhancerSource,
    /httpCardTitle: "HTTP 协议"/,
    "options enhancer should provide a Chinese title for the HTTP card"
  );

  assert.doesNotMatch(
    optionsEnhancerSource,
    /const localeKey = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\) \? "zh" : "en";/,
    "options enhancer should no longer freeze its locale from navigator.language at script load time"
  );

  assert.match(
    optionsUpdatePreviewSource,
    /function getOptionsLocaleKey\(\) \{/,
    "update preview addon should resolve locale from the live options page instead of freezing browser language"
  );

  assert.match(
    optionsUpdatePreviewSource,
    /return detectUiLocaleKey\(getOptionsLocaleOptions\(\)\);/,
    "update preview addon should delegate locale detection to the shared github update locale helper"
  );

  assert.match(
    optionsUpdatePreviewSource,
    /function getStrings\(\) \{\s*return STRINGS\[getOptionsLocaleKey\(\)\];\s*\}/s,
    "update preview addon should derive its copy from the live locale helper"
  );

  assert.match(
    optionsUpdatePreviewSource,
    /title: "更新 UI 预览"/,
    "update preview addon should keep a Chinese title for the local preview card"
  );

  assert.doesNotMatch(
    optionsUpdatePreviewSource,
    /const localeKey = String\(navigator\.language \|\| ""\)\.toLowerCase\(\)\.startsWith\("zh"\) \? "zh" : "en";/,
    "update preview addon should no longer freeze its locale from navigator.language at script load time"
  );

  console.log("options nav locale regression test passed");
}

main();
