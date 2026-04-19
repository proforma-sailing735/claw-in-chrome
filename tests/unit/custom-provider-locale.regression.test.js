const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..", "..");
const sourcePath = path.join(rootDir, "custom-provider-settings.js");

function main() {
  const source = fs.readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /const uiContract = rootContract\.ui \|\| \{\};/,
    "custom provider settings should read the shared UI contract"
  );

  assert.match(
    source,
    /const PREFERRED_LOCALE_STORAGE_KEY = uiContract\.PREFERRED_LOCALE_STORAGE_KEY \|\| "preferred_locale";/,
    "custom provider settings should use the shared preferred locale storage key"
  );

  assert.match(
    source,
    /async function readStoredPreferredUiLocaleKey\(\) \{/,
    "custom provider settings should load the preferred locale from storage before rendering"
  );

  assert.match(
    source,
    /function getUiLocaleKey\(\) \{\s*return preferredUiLocaleKey \|\| detectDocumentUiLocaleKey\(\);\s*\}/s,
    "custom provider settings should prioritize the stored preferred locale and only fall back to document detection"
  );

  assert.match(
    source,
    /if \(PREFERRED_LOCALE_STORAGE_KEY in changes && applyPreferredUiLocaleKey\(changes\[PREFERRED_LOCALE_STORAGE_KEY\]\?\.newValue\)\) \{\s*scheduleUiRebuild\(\);\s*return;\s*\}/s,
    "preferred locale changes should trigger a full UI rebuild"
  );

  assert.match(
    source,
    /async function bootstrapUi\(\) \{\s*applyPreferredUiLocaleKey\(await readStoredPreferredUiLocaleKey\(\)\);\s*buildUi\(\);\s*\}/s,
    "bootstrap should resolve the preferred locale before the first render"
  );

  assert.doesNotMatch(
    source,
    /document\.addEventListener\("DOMContentLoaded", buildUi, \{\s*once: true\s*\}\);/s,
    "custom provider settings should no longer render immediately on DOMContentLoaded without loading the preferred locale first"
  );

  console.log("custom provider locale regression test passed");
}

main();
