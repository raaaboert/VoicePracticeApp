import { AppConfig, EnterpriseOrg } from "@voicepractice/shared";

import { shouldBootstrapTrainingWorkspaceForSimulationRoute } from "./simulationHotPath.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-hot-path.test] PASS ${name}`);
}

function createConfigWithScenario(scenarioId: string): Pick<AppConfig, "segments"> {
  return {
    segments: [
      {
        id: "sales",
        label: "Sales",
        enabled: true,
        scenarios: [
          {
            id: scenarioId,
            segmentId: "sales",
            title: "Handle the objection",
            summary: "summary",
            description: "description",
            aiRole: "buyer",
            enabled: true,
          },
        ],
      },
    ],
  } as Pick<AppConfig, "segments">;
}

function createOrgWithCustomScenario(scenarioId: string): Pick<EnterpriseOrg, "customScenarios"> {
  return {
    customScenarios: [
      {
        id: scenarioId,
        orgId: "org_1",
        segmentId: "sales",
        title: "Custom scenario",
        summary: "summary",
        description: "description",
        aiRole: "buyer",
        scoringGuidance: "",
        applicableIndustryIds: ["technology"],
        enabled: true,
        provenance: {
          sourceMode: "scratch",
          creationMethod: "manual",
          baseScenarioId: null,
          baseScenarioTitle: null,
          baseScenarioSegmentId: null,
          baseScenarioVersion: null,
          customizationParams: null,
          generatedPrompt: null,
          modelUsed: null,
          generatedAt: null,
        },
        createdBy: "tester",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
  } as Pick<EnterpriseOrg, "customScenarios">;
}

runTest("does not bootstrap for standard scenarios", () => {
  assert(
    shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser: createConfigWithScenario("scenario_standard"),
      org: createOrgWithCustomScenario("scenario_custom"),
      scenarioId: "scenario_standard",
      existingOrgTrainingCount: 0,
    }) === false,
    "standard scenarios should stay on the read-only path",
  );
});

runTest("bootstraps for legacy custom scenarios when the org training workspace is empty", () => {
  assert(
    shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser: createConfigWithScenario("scenario_standard"),
      org: createOrgWithCustomScenario("scenario_custom"),
      scenarioId: "scenario_custom",
      existingOrgTrainingCount: 0,
    }) === true,
    "custom scenarios should trigger workspace bootstrap when the org training workspace is empty",
  );
});

runTest("does not bootstrap when the org training workspace is already populated", () => {
  assert(
    shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser: createConfigWithScenario("scenario_standard"),
      org: createOrgWithCustomScenario("scenario_custom"),
      scenarioId: "scenario_custom",
      existingOrgTrainingCount: 2,
    }) === false,
    "existing training records should keep the route on the read path",
  );
});

runTest("does not bootstrap for unknown scenarios", () => {
  assert(
    shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser: createConfigWithScenario("scenario_standard"),
      org: createOrgWithCustomScenario("scenario_custom"),
      scenarioId: "scenario_missing",
      existingOrgTrainingCount: 0,
    }) === false,
    "unknown scenarios should fail normally instead of silently bootstrapping",
  );
});

runTest("does not bootstrap when there is no acting org", () => {
  assert(
    shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser: createConfigWithScenario("scenario_standard"),
      org: null,
      scenarioId: "scenario_custom",
      existingOrgTrainingCount: 0,
    }) === false,
    "org bootstrap is only meaningful when an acting org exists",
  );
});
