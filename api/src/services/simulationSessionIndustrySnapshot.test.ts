import assert from "node:assert/strict";
import test from "node:test";

import type { IndustryDefinition } from "@voicepractice/shared";

import {
  buildSimulationSessionIndustrySnapshot,
  parseSimulationSessionIndustrySnapshot,
  resolveServerIndustryPromptBaseline,
  resolveSnapshotIndustry,
} from "./simulationSessionIndustrySnapshot.js";

const industries: IndustryDefinition[] = [
  {
    id: "industry_one",
    label: "Industry One",
    enabled: true,
    aiBaseline: "A".repeat(30_100),
    standardScoringGuidance: "Score against Industry One standards.",
  },
  {
    id: "industry_two",
    label: "Industry Two",
    enabled: true,
    aiBaseline: "Raw baseline two.",
    standardScoringGuidance: "Score against Industry Two standards.",
  },
];

test("builds a versioned server snapshot with prompt-safe and raw scoring baselines", () => {
  const snapshot = buildSimulationSessionIndustrySnapshot({
    eligibleIndustryIds: ["industry_one", "industry_two", "industry_one"],
    industries,
    capturedAt: new Date("2026-10-13T12:00:00.000Z"),
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.capturedAt, "2026-10-13T12:00:00.000Z");
  assert.deepEqual(snapshot.selection, { industryId: null, lockedAt: null });
  assert.deepEqual(snapshot.eligibleIndustries.map((industry) => industry.id), ["industry_one", "industry_two"]);
  assert.equal(snapshot.eligibleIndustries[0]?.promptBaseline.length, 30_000);
  assert.equal(snapshot.eligibleIndustries[0]?.rawScoringAiBaseline.length, 30_100);
  assert.equal(snapshot.eligibleIndustries[1]?.standardScoringGuidance, "Score against Industry Two standards.");
});

test("strictly parses only current structurally valid snapshots", () => {
  const snapshot = buildSimulationSessionIndustrySnapshot({
    eligibleIndustryIds: ["industry_one"], industries, capturedAt: new Date("2026-10-13T12:00:00.000Z"),
  });
  assert.deepEqual(parseSimulationSessionIndustrySnapshot(snapshot), snapshot);
  assert.equal(parseSimulationSessionIndustrySnapshot({ ...snapshot, version: 2 }), null);
  assert.equal(parseSimulationSessionIndustrySnapshot({
    ...snapshot,
    selection: { industryId: "industry_one", lockedAt: null },
  }), null);
  assert.equal(parseSimulationSessionIndustrySnapshot({
    ...snapshot,
    eligibleIndustries: [{ ...snapshot.eligibleIndustries[0], promptBaseline: "x".repeat(30_001) }],
  }), null);
  assert.equal(resolveSnapshotIndustry(snapshot, "missing"), null);
});

test("uses the established configured, canonical, then default prompt-baseline fallback", () => {
  const canonical: IndustryDefinition[] = [{
    id: "industry_one",
    label: "Canonical Industry One",
    enabled: true,
    aiBaseline: "Canonical baseline.",
  }];
  assert.equal(resolveServerIndustryPromptBaseline({
    industry: { ...industries[0]!, aiBaseline: "" },
    canonicalIndustries: canonical,
  }), "Canonical baseline.");
  assert.equal(resolveServerIndustryPromptBaseline({
    industry: { ...industries[0]!, aiBaseline: "Configured baseline." },
    canonicalIndustries: canonical,
  }), "Configured baseline.");
});
