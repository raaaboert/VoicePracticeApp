import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "@voicepractice/shared";

import { resolveCanonicalMobileScenarioSetupSelection } from "./mobileScenarioSetupSelection.js";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function config(roleIndustries: AppConfig["roleIndustries"]): Pick<
  AppConfig,
  "industries" | "roleIndustries" | "segments"
> {
  return {
    industries: [
      { id: "second_in_links", label: "First in Setup", enabled: true },
      { id: "first_in_links", label: "Second in Setup", enabled: true },
    ],
    roleIndustries,
    segments: [
      {
        id: "sales",
        label: "Sales",
        enabled: true,
        summary: "",
        scenarios: [{
          id: "scenario_a",
          segmentId: "sales",
          title: "Scenario A",
          description: "",
          desiredOutcome: "",
          aiRole: "",
          enabled: true,
        }],
      },
    ],
  };
}

test("canonical selection follows Setup industry order regardless of relationship order", () => {
  const links = [
    { industryId: "first_in_links", roleId: "sales", active: true },
    { industryId: "second_in_links", roleId: "sales", active: true },
  ];
  const candidate = {
    id: "scenario_a",
    title: "Scenario A",
    source: "standard" as const,
    segmentId: "sales",
    allowedIndustryIds: links.map((entry) => entry.industryId),
    trainingId: null,
  };

  const forward = resolveCanonicalMobileScenarioSetupSelection(config(links), candidate);
  const reversed = resolveCanonicalMobileScenarioSetupSelection(
    config([...links].reverse()),
    { ...candidate, allowedIndustryIds: [...candidate.allowedIndustryIds].reverse() }
  );

  assert.equal(forward?.industryId, "second_in_links");
  assert.deepEqual(reversed, forward);
  assert.equal(
    config(links).industries.some((industry) => industry.id === forward?.industryId),
    true
  );
  assert.equal(forward?.trainingId, null);
});

test("custom selection retains its authoritative training id and standard never does", () => {
  const setupConfig = config([]);
  const custom = resolveCanonicalMobileScenarioSetupSelection(setupConfig, {
    id: "custom_a",
    title: "Custom A",
    source: "custom",
    segmentId: "sales",
    allowedIndustryIds: ["first_in_links", "second_in_links"],
    trainingId: "topic_a",
  });
  const standard = resolveCanonicalMobileScenarioSetupSelection(setupConfig, {
    id: "scenario_a",
    title: "Scenario A",
    source: "standard",
    segmentId: "sales",
    allowedIndustryIds: [],
    trainingId: "must_not_survive",
  });

  assert.equal(custom?.industryId, "second_in_links");
  assert.equal(custom?.trainingId, "topic_a");
  assert.equal(standard?.industryId, "second_in_links");
  assert.equal(standard?.trainingId, null);
});

test("selection fails closed when no Setup-visible industry exists", () => {
  assert.equal(
    resolveCanonicalMobileScenarioSetupSelection(config([
      { industryId: "first_in_links", roleId: "sales", active: true },
    ]), {
      id: "custom_a",
      title: "Custom A",
      source: "custom",
      segmentId: "sales",
      allowedIndustryIds: ["disabled_or_missing"],
      trainingId: "topic_a",
    }),
    null
  );
});

test("Focus Topic and Related Practice projections use the same canonical resolver", () => {
  const indexSource = readFileSync(resolve(sourceDirectory, "../index.ts"), "utf8");
  const trainingContentSource = readFileSync(
    resolve(sourceDirectory, "trainingContentMobileService.ts"),
    "utf8"
  );

  assert.match(
    indexSource,
    /function resolveMobileFocusTopicScenarioSummary[\s\S]*?resolveCanonicalMobileScenarioSetupSelection/
  );
  assert.match(
    trainingContentSource,
    /function resolveMobileScenarioLaunchContext[\s\S]*?resolveCanonicalMobileScenarioSetupSelection/
  );
});
