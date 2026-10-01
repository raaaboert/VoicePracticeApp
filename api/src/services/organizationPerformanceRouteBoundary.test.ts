import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const servicesRoot = join(sourceRoot, "services");
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const webAppSourceRoots = [
  join(workspaceRoot, "admin-web", "src"),
  join(workspaceRoot, "admin-web", "app"),
  join(workspaceRoot, "peritio-web", "src"),
  join(workspaceRoot, "peritio-web", "app"),
] as const;
const lowerLevelModules = [
  "authorizedOrganizationEvidenceCandidates",
  "authorizedTeamPerformanceInternal",
  "organizationPerformanceAggregation",
  "teamPerformanceIntelligenceFacts",
  "teamPerformanceIntelligenceSignals",
] as const;

const approvedImporters: Readonly<Record<(typeof lowerLevelModules)[number], ReadonlySet<string>>> = {
  authorizedOrganizationEvidenceCandidates: new Set([
    "services/authorizedOrganizationPerformance.ts",
    "services/authorizedTeamPerformanceInternal.ts",
    "services/organizationPerformanceAggregation.ts",
  ]),
  authorizedTeamPerformanceInternal: new Set([
    "services/authorizedTeamPerformance.ts",
    "services/teamPerformanceIntelligenceFacts.ts",
  ]),
  organizationPerformanceAggregation: new Set([
    "services/authorizedOrganizationPerformance.ts",
    "services/authorizedTeamPerformance.ts",
    // Internal identity-free two-period facts; authorization and Team population
    // still enter through resolveAuthorizedTeamPerformanceScope.
    "services/teamPerformanceIntelligenceFacts.ts",
  ]),
  teamPerformanceIntelligenceFacts: new Set([
    "services/authorizedTeamPerformanceIntelligence.ts",
    "services/teamPerformanceIntelligenceSignals.ts",
  ]),
  teamPerformanceIntelligenceSignals: new Set([
    "services/authorizedTeamPerformanceIntelligence.ts",
  ]),
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function referencedLowerLevelModules(source: string): (typeof lowerLevelModules)[number][] {
  return lowerLevelModules.filter((moduleName) => {
    const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`[\"'\\x60][^\"'\\x60]*${escapedModuleName}(?:\\.(?:js|ts))?[\"'\\x60]`).test(source);
  });
}

test("only explicitly approved source modules may reference lower-level performance intelligence services", () => {
  const productionFiles = sourceFiles(sourceRoot).filter((path) => !/\.test\.tsx?$/.test(path));
  assert.ok(productionFiles.some((path) => relative(sourceRoot, path).replaceAll("\\", "/") === "index.ts"));
  for (const path of productionFiles) {
    const importer = relative(sourceRoot, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    for (const referencedModule of referencedLowerLevelModules(source)) {
      assert.equal(
        approvedImporters[referencedModule].has(importer),
        true,
        `${importer} is not approved to import ${referencedModule}`,
      );
    }
  }
});

test("web application sources cannot import lower-level performance intelligence modules", () => {
  for (const root of webAppSourceRoots) {
    for (const path of sourceFiles(root)) {
      assert.deepEqual(
        referencedLowerLevelModules(readFileSync(path, "utf8")),
        [],
        `${relative(workspaceRoot, path).replaceAll("\\", "/")} imports a server-internal module`,
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
    ["services/dashboardTeamIntelligenceRoute.ts", 'import { resolveAuthorizedTeamPerformanceScope } from "./authorizedTeamPerformanceInternal.js";'],
    ["services/intelligenceEscape.ts", 'export * from "./teamPerformanceIntelligenceFacts.js";'],
  ];
  for (const [importer, source] of mutations) {
    const references = referencedLowerLevelModules(source!);
    assert.equal(references.length, 1, source);
    assert.equal(approvedImporters[references[0]!].has(importer!), false, importer);
  }
});

test("Team intelligence route imports only its route-safe intelligence facade", () => {
  const routeSource = readFileSync(
    join(servicesRoot, "dashboardTeamPerformanceIntelligenceRoute.ts"),
    "utf8",
  );
  assert.match(routeSource, /from "\.\/authorizedTeamPerformanceIntelligence\.js"/);
  assert.doesNotMatch(
    routeSource,
    /authorizedTeamPerformanceInternal|teamPerformanceIntelligenceFacts|teamPerformanceIntelligenceSignals|organizationPerformanceAggregation|authorizedOrganizationEvidenceCandidates/,
  );
  const facadeSource = readFileSync(
    join(servicesRoot, "authorizedTeamPerformanceIntelligence.ts"),
    "utf8",
  );
  assert.doesNotMatch(facadeSource, /export\s+\*/);
});

test("route-safe Team facade does not export the raw resolver", async () => {
  const facade = await import("./authorizedTeamPerformance.js");
  const facadeSource = readFileSync(join(servicesRoot, "authorizedTeamPerformance.ts"), "utf8");
  assert.equal("resolveAuthorizedTeamPerformanceScope" in facade, false);
  assert.doesNotMatch(
    facadeSource,
    /export\s+(?:interface|type)\s+AuthorizedTeamPerformanceScope/,
  );
});

test("lower-level performance intelligence exports carry explicit route-safety warnings", () => {
  const candidatesSource = readFileSync(join(servicesRoot, "authorizedOrganizationEvidenceCandidates.ts"), "utf8");
  const aggregationSource = readFileSync(join(servicesRoot, "organizationPerformanceAggregation.ts"), "utf8");
  const teamInternalSource = readFileSync(join(servicesRoot, "authorizedTeamPerformanceInternal.ts"), "utf8");
  assert.match(candidatesSource, /INTERNAL - NOT ROUTE-SAFE[\s\S]+queryAuthorizedOrganizationPerformance/);
  assert.equal((aggregationSource.match(/INTERNAL - NOT ROUTE-SAFE/g) ?? []).length, 3);
  assert.equal((aggregationSource.match(/queryAuthorizedOrganizationPerformance/g) ?? []).length >= 2, true);
  assert.match(aggregationSource, /aggregateCurrentPopulationPerformance[\s\S]*queryAuthorizedTeamPerformance|queryAuthorizedTeamPerformance[\s\S]*aggregateCurrentPopulationPerformance/);
  assert.match(teamInternalSource, /INTERNAL - NOT ROUTE-SAFE[\s\S]+subject keys/);
});
