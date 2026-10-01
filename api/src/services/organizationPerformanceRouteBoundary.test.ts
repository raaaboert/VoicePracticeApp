import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const servicesRoot = join(sourceRoot, "services");
const lowerLevelModules = [
  "authorizedOrganizationEvidenceCandidates",
  "organizationPerformanceAggregation",
] as const;

const approvedImporters: Readonly<Record<(typeof lowerLevelModules)[number], ReadonlySet<string>>> = {
  authorizedOrganizationEvidenceCandidates: new Set([
    "services/authorizedOrganizationPerformance.ts",
    "services/authorizedTeamPerformance.ts",
    "services/organizationPerformanceAggregation.ts",
  ]),
  organizationPerformanceAggregation: new Set([
    "services/authorizedOrganizationPerformance.ts",
    "services/authorizedTeamPerformance.ts",
    // Internal identity-free two-period facts; authorization and Team population
    // still enter through resolveAuthorizedTeamPerformanceScope.
    "services/teamPerformanceIntelligenceFacts.ts",
  ]),
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function referencedLowerLevelModules(source: string): (typeof lowerLevelModules)[number][] {
  return lowerLevelModules.filter((moduleName) => {
    const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`[\"'\\x60][^\"'\\x60]*${escapedModuleName}(?:\\.(?:js|ts))?[\"'\\x60]`).test(source);
  });
}

test("only explicitly approved source modules may reference lower-level organization intelligence services", () => {
  const productionFiles = sourceFiles(sourceRoot).filter((path) => !path.endsWith(".test.ts"));
  assert.ok(productionFiles.some((path) => relative(sourceRoot, path).replaceAll("\\", "/") === "index.ts"));
  for (const path of productionFiles) {
    const importer = relative(sourceRoot, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    for (const referencedModule of referencedLowerLevelModules(source)) {
      assert.equal(
        approvedImporters[referencedModule].has(importer),
        true,
        `${importer} must use authorizedOrganizationPerformance instead of ${referencedModule}`,
      );
    }
  }
});

test("lower-level reference detection covers unauthorized static, re-export, extension, and dynamic forms", () => {
  const mutations = [
    ["index.ts", 'import { aggregateOrganizationPerformance } from "./services/organizationPerformanceAggregation.js";'],
    ["services/someHelper.ts", 'import { queryAuthorizedOrganizationEvidenceCandidates } from "./authorizedOrganizationEvidenceCandidates";'],
    ["services/orgPerformanceHttp.ts", 'export * from "./organizationPerformanceAggregation.js";'],
    ["services/dashboardApi.ts", 'export { queryAuthorizedOrganizationEvidenceCandidates } from "./authorizedOrganizationEvidenceCandidates.ts";'],
    ["services/dynamicHelper.ts", 'const module = await import("./organizationPerformanceAggregation.js");'],
  ];
  for (const [importer, source] of mutations) {
    const references = referencedLowerLevelModules(source!);
    assert.equal(references.length, 1, source);
    assert.equal(approvedImporters[references[0]!].has(importer!), false, importer);
  }
});

test("lower-level organization intelligence exports carry explicit route-safety warnings", () => {
  const candidatesSource = readFileSync(join(servicesRoot, "authorizedOrganizationEvidenceCandidates.ts"), "utf8");
  const aggregationSource = readFileSync(join(servicesRoot, "organizationPerformanceAggregation.ts"), "utf8");
  assert.match(candidatesSource, /INTERNAL - NOT ROUTE-SAFE[\s\S]+queryAuthorizedOrganizationPerformance/);
  assert.equal((aggregationSource.match(/INTERNAL - NOT ROUTE-SAFE/g) ?? []).length, 3);
  assert.equal((aggregationSource.match(/queryAuthorizedOrganizationPerformance/g) ?? []).length >= 2, true);
  assert.match(aggregationSource, /aggregateCurrentPopulationPerformance[\s\S]*queryAuthorizedTeamPerformance|queryAuthorizedTeamPerformance[\s\S]*aggregateCurrentPopulationPerformance/);
});
