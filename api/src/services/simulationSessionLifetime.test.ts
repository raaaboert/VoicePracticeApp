import assert from "node:assert/strict";
import test from "node:test";
import { assertSimulationSessionLifetime, buildSimulationSessionStartRecord, SimulationSessionValidationError } from "./simulationSessionLifecycle.js";

const start = new Date("2026-10-16T12:00:00Z");
const session = () => buildSimulationSessionStartRecord({ simulationSessionId: "lifetime_test", userId: "learner",
  orgId: "organization", segmentId: "role", scenarioId: "scenario", trainingId: null, trainingPackId: null,
  clientStartedAt: null, now: start });
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const expired = (run: () => void, code = "session_expired") => assert.throws(run,
  (error: unknown) => error instanceof SimulationSessionValidationError && error.statusCode === 409 && error.code === code);

for (const maximum of [5, 20, 60, 240]) {
  test(`configured ${maximum}-minute session has independent conversation and completion deadlines`, () => {
    const record = { ...session(), lastSeenAt: at(1_000).toISOString(), clientStartedAt: at(1_000).toISOString() };
    assertSimulationSessionLifetime(record, maximum, new Date(at(maximum).getTime() - 1), "conversation");
    expired(() => assertSimulationSessionLifetime(record, maximum, at(maximum), "conversation"));
    assertSimulationSessionLifetime(record, maximum, new Date(at(maximum + 20).getTime() - 1), "completion");
    expired(() => assertSimulationSessionLifetime(record, maximum, at(maximum + 20), "completion"));
  });
}

test("usage completion closes conversation and bounds first scoring to the earlier grace deadline", () => {
  const record = { ...session(), status: "usage_recorded" as const, usageRecordedAt: at(3).toISOString() };
  expired(() => assertSimulationSessionLifetime(record, 20, at(4), "conversation"), "session_completed");
  assertSimulationSessionLifetime(record, 20, at(22), "completion");
  expired(() => assertSimulationSessionLifetime(record, 20, at(23), "completion"));
});

test("unknown configured maximum remains bounded by the established fallback completion window", () => {
  assertSimulationSessionLifetime(session(), null, at(479), "completion");
  expired(() => assertSimulationSessionLifetime(session(), null, at(480), "completion"));
  expired(() => assertSimulationSessionLifetime({ ...session(), serverStartedAt: "invalid" }, 20, start, "conversation"));
});
