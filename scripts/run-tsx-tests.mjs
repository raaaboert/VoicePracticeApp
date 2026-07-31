import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const selectors = process.argv.slice(2);

if (selectors.length === 0) {
  console.error("At least one test selector in the form <directory>=<file-suffix> is required.");
  process.exit(1);
}

async function findMatchingFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findMatchingFiles(entryPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      matches.push(entryPath);
    }
  }

  return matches;
}

const discoveredTests = new Set();

for (const selector of selectors) {
  const separatorIndex = selector.lastIndexOf("=");
  if (separatorIndex === -1) {
    const fileStats = await stat(selector);
    if (!fileStats.isFile()) {
      console.error(`Explicit test path is not a file: ${selector}`);
      process.exit(1);
    }
    discoveredTests.add(selector);
    continue;
  }

  if (separatorIndex <= 0 || separatorIndex === selector.length - 1) {
    console.error(
      `Invalid test selector "${selector}". Expected <directory>=<file-suffix> or an explicit test file.`
    );
    process.exit(1);
  }

  const directory = selector.slice(0, separatorIndex);
  const suffix = selector.slice(separatorIndex + 1);
  for (const testPath of await findMatchingFiles(directory, suffix)) {
    discoveredTests.add(testPath);
  }
}

const testFiles = [...discoveredTests].sort((left, right) => left.localeCompare(right));
if (testFiles.length === 0) {
  console.error(`No test files matched: ${selectors.join(", ")}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve("tsx/cli");
const result = spawnSync(process.execPath, [tsxCliPath, "--test", ...testFiles], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.signal) {
  console.error(`Test process terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
