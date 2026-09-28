import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, relative } from "node:path";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const servicesRoot = join(sourceRoot, "services");
const forbiddenLowerLevelModules = [
  "authorizedOrganizationEvidenceCandidates",
  "organizationPerformanceAggregation",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function isRouteFacing(path: string): boolean {
  const name = basename(path);
  if (relative(sourceRoot, path).replaceAll("\\", "/") === "index.ts") return true;
  return !name.includes(".test") && /(route|controller)/i.test(name);
}

test("route-facing modules cannot import lower-level organization intelligence services", () => {
  const routeFacingFiles = sourceFiles(sourceRoot).filter(isRouteFacing);
  assert.ok(routeFacingFiles.some((path) => basename(path) === "index.ts"));
  for (const path of routeFacingFiles) {
    const source = readFileSync(path, "utf8");
    for (const forbidden of forbiddenLowerLevelModules) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${relative(sourceRoot, path)} must use authorizedOrganizationPerformance instead of ${forbidden}`,
      );
    }
  }
});

test("lower-level organization intelligence exports carry explicit route-safety warnings", () => {
  const candidatesSource = readFileSync(join(servicesRoot, "authorizedOrganizationEvidenceCandidates.ts"), "utf8");
  const aggregationSource = readFileSync(join(servicesRoot, "organizationPerformanceAggregation.ts"), "utf8");
  assert.match(candidatesSource, /INTERNAL - NOT ROUTE-SAFE[\s\S]+queryAuthorizedOrganizationPerformance/);
  assert.equal((aggregationSource.match(/INTERNAL - NOT ROUTE-SAFE/g) ?? []).length, 2);
  assert.equal((aggregationSource.match(/queryAuthorizedOrganizationPerformance/g) ?? []).length >= 2, true);
});
