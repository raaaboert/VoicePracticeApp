import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationSessionRecord } from "@voicepractice/shared";

import {
  doesRecognizedSimulationSessionMatchContext,
  resolvePreferredSimulationDivisionId,
} from "./simulationDivisionAnchoring.js";

function createSession(overrides?: Partial<SimulationSessionRecord>): SimulationSessionRecord {
  return {
    simulationSessionId: overrides?.simulationSessionId ?? "sim_1",
    userId: overrides?.userId ?? "user_1",
    orgId: overrides?.orgId ?? "org_1",
    divisionId: overrides?.divisionId ?? "division_a",
    segmentId: overrides?.segmentId ?? "segment_1",
    scenarioId: overrides?.scenarioId ?? "scenario_1",
    trainingId: overrides?.trainingId ?? "training_1",
    trainingPackId: overrides?.trainingPackId ?? null,
    status: overrides?.status ?? "started",
    clientStartedAt: overrides?.clientStartedAt ?? "2026-04-15T10:00:00.000Z",
    serverStartedAt: overrides?.serverStartedAt ?? "2026-04-15T10:00:01.000Z",
    lastSeenAt: overrides?.lastSeenAt ?? "2026-04-15T10:00:01.000Z",
    usageRecordedAt: overrides?.usageRecordedAt ?? null,
  };
}

test("doesRecognizedSimulationSessionMatchContext requires matching user, org, scenario, and training", () => {
  const session = createSession();

  assert.equal(
    doesRecognizedSimulationSessionMatchContext(session, {
      userId: "user_1",
      orgId: "org_1",
      scenarioId: "scenario_1",
      trainingId: "training_1",
    }),
    true
  );

  assert.equal(
    doesRecognizedSimulationSessionMatchContext(session, {
      userId: "user_1",
      orgId: "org_1",
      scenarioId: "scenario_1",
      trainingId: null,
    }),
    false
  );
});

test("resolvePreferredSimulationDivisionId prefers the recognized session anchor over runtime fallback", () => {
  const divisionId = resolvePreferredSimulationDivisionId({
    recognizedSession: createSession({ divisionId: "division_a" }),
    userId: "user_1",
    orgId: "org_1",
    scenarioId: "scenario_1",
    trainingId: "training_1",
    fallbackDivisionId: "division_b",
  });

  assert.equal(divisionId, "division_a");
});

test("resolvePreferredSimulationDivisionId falls back when the recognized session does not match context", () => {
  const divisionId = resolvePreferredSimulationDivisionId({
    recognizedSession: createSession({ scenarioId: "scenario_other", divisionId: "division_a" }),
    userId: "user_1",
    orgId: "org_1",
    scenarioId: "scenario_1",
    trainingId: "training_1",
    fallbackDivisionId: "division_b",
  });

  assert.equal(divisionId, "division_b");
});
