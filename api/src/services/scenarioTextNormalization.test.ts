import { createDefaultConfig } from "@voicepractice/shared";

import { normalizeDesiredOutcomeText } from "./scenarioTextNormalization.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[scenario-text-normalization.test] PASS ${name}`);
}

runTest("trims desired outcome text", () => {
  assert(
    normalizeDesiredOutcomeText("  Align on a concrete next step.  ") === "Align on a concrete next step.",
    "desiredOutcome should be trimmed before persistence",
  );
});

runTest("treats missing or blank desired outcome as undefined for backward compatibility", () => {
  assert(normalizeDesiredOutcomeText(undefined) === undefined, "undefined should stay undefined");
  assert(normalizeDesiredOutcomeText(null) === undefined, "null should normalize to undefined");
  assert(normalizeDesiredOutcomeText("   ") === undefined, "blank strings should normalize to undefined");
});

runTest("default standard scenarios now seed desired outcomes", () => {
  const config = createDefaultConfig("2026-04-09T00:00:00.000Z");
  const scenarios = config.segments.flatMap((segment) => segment.scenarios ?? []);

  assert(scenarios.length > 0, "default config should include standard scenarios");
  assert(
    scenarios.every((scenario) => typeof scenario.desiredOutcome === "string" && scenario.desiredOutcome.trim().length > 0),
    "default standard scenarios should include a non-empty desiredOutcome seed",
  );
});
