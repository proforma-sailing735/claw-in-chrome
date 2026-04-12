const { runSuites } = require("./run-suite");

function main() {
  const result = runSuites(["unit", "integration", "e2e"]);
  console.log(`all suites passed (${result.fileCount} files)`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
