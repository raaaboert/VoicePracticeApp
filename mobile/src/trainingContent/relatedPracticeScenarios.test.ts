import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { MobileRelatedPracticeScenarioSummary } from "@voicepractice/shared";

import {
  buildScenarioSetupSelection,
  isExactScenarioSetupSelection,
  setupBackDestination,
  setupOriginContentId,
  setupOriginTopicId,
} from "./scenarioSetupNavigation";
import {
  normalizeRelatedPracticeScenarios,
  relatedPracticeScenariosPath,
} from "./relatedPracticeScenarios";

const directory = dirname(fileURLToPath(import.meta.url));
const detailSource = readFileSync(join(directory, "TrainingContentDetailScreen.tsx"), "utf8");
const screenSource = readFileSync(join(directory, "TrainingContentScreen.tsx"), "utf8");
const modelSource = readFileSync(join(directory, "relatedPracticeScenarios.ts"), "utf8");
const appSource = readFileSync(join(directory, "..", "..", "App.tsx"), "utf8");

function scenario(
  id: string,
  source: "standard" | "custom" = "standard"
): MobileRelatedPracticeScenarioSummary {
  return {
    id,
    title: `${id} title`,
    source,
    segmentId: "sales",
    industryId: "software",
    trainingId: source === "custom" ? "focus_topic_a" : null,
  };
}

test("zero, one, and many supplied scenarios render without an empty state", () => {
  assert.deepEqual(normalizeRelatedPracticeScenarios([]), []);
  assert.deepEqual(normalizeRelatedPracticeScenarios([scenario("one")]), [scenario("one")]);
  assert.deepEqual(
    normalizeRelatedPracticeScenarios([scenario("one"), scenario("two")]).map((item) => item.id),
    ["one", "two"]
  );
  assert.match(detailSource, /relatedScenarios\.length > 0 \? \(/);
  assert.doesNotMatch(detailSource, /No scenarios assigned|No related scenarios|empty state/i);
  assert.match(detailSource, /<Text style=\{styles\.practiceButtonText\}>Practice<\/Text>/);
});

test("duplicate and blank summaries are normalized once and omitted server rows make no UI", () => {
  assert.deepEqual(
    normalizeRelatedPracticeScenarios([
      scenario("scenario_a"),
      { ...scenario("scenario_a"), id: " scenario_a ", title: "Duplicate" },
      scenario(" "),
    ]).map((item) => item.id),
    ["scenario_a"]
  );
  assert.deepEqual(normalizeRelatedPracticeScenarios([]), []);
});

test("related section is after metadata/file information and before the viewer", () => {
  const metadata = detailSource.indexOf("{item.asset ? (");
  const related = detailSource.indexOf("Related Practice Scenarios");
  const viewer = detailSource.indexOf("<View style={styles.viewer}>");
  assert.ok(metadata >= 0 && metadata < related);
  assert.ok(related < viewer);
});

test("standard and custom Practice share the exact existing setup selection", () => {
  const standard = buildScenarioSetupSelection(scenario("standard_a"));
  const custom = buildScenarioSetupSelection(scenario("custom_a", "custom"));
  assert.deepEqual(standard, {
    scenarioCatalogTab: "standard",
    selectedTrainingId: "",
    selectedIndustryId: "software",
    selectedRoleId: "sales",
    selectedScenarioId: "standard_a",
  });
  assert.deepEqual(custom, {
    scenarioCatalogTab: "custom",
    selectedTrainingId: "focus_topic_a",
    selectedIndustryId: "software",
    selectedRoleId: "sales",
    selectedScenarioId: "custom_a",
  });
  assert.equal(isExactScenarioSetupSelection(standard, {
    scenarioCatalogTab: "standard",
    trainingId: null,
    industryId: "software",
    roleId: "sales",
    scenarioId: "standard_a",
  }), true);
  assert.equal(isExactScenarioSetupSelection(custom, {
    scenarioCatalogTab: "custom",
    trainingId: "focus_topic_a",
    industryId: "software",
    roleId: "sales",
    scenarioId: "custom_a",
  }), true);
  assert.equal(isExactScenarioSetupSelection(standard, {
    scenarioCatalogTab: "standard",
    trainingId: null,
    industryId: "software",
    roleId: "sales",
    scenarioId: "different",
  }), false);
  const handlerStart = appSource.indexOf("const applyScenarioSetupSelection");
  const handlerEnd = appSource.indexOf("const handleTrainingContentAvailability", handlerStart);
  const handler = appSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /buildScenarioSetupSelection\(scenario\)/);
  assert.match(handler, /setScreen\("setup"\)/);
  assert.doesNotMatch(handler, /startSimulation|setSimulationConfig|fetch\(/);
});

test("typed Setup origins restore the same source without crossing destinations", () => {
  const resourceOrigin = { type: "learning_resource" as const, contentId: "resource_a" };
  const topicOrigin = { type: "focus_topic" as const, topicId: "topic_a" };
  assert.equal(setupBackDestination(resourceOrigin), "training_content");
  assert.equal(setupBackDestination(topicOrigin), "focus_topics");
  assert.equal(setupBackDestination(null), "home");
  assert.equal(setupOriginContentId(resourceOrigin), "resource_a");
  assert.equal(setupOriginTopicId(topicOrigin), "topic_a");
  assert.equal(setupOriginContentId(topicOrigin), null);
  assert.equal(setupOriginTopicId(resourceOrigin), null);
  assert.match(
    appSource,
    /applyScenarioSetupSelection\([\s\S]*?\{ type: "learning_resource", contentId \}/
  );
  assert.match(appSource, /initialContentId=\{setupOriginContentId\(setupOrigin\)\}/);
  assert.match(screenSource, /props\.initialContentId\?\.trim\(\)/);
  assert.match(screenSource, /\{ type: "detail", contentId, returnRoute: \{ type: "library" \} \}/);
});

test("normal setup entry from Home clears an old Learning Resource origin", () => {
  const label = appSource.indexOf("Continue to setup");
  const handlerStart = appSource.lastIndexOf("<Pressable", label);
  const handler = appSource.slice(handlerStart, label);
  const clearOrigin = handler.indexOf("setSetupOrigin(null)");
  const enterSetup = handler.indexOf('setScreen("setup")');
  assert.ok(clearOrigin >= 0);
  assert.ok(clearOrigin < enterSetup);
});

test("switching resources clears stale related state before an independent fetch", () => {
  assert.match(detailSource, /setRelatedScenarios\(\[\]\);[\s\S]*?fetchRelatedPracticeScenarios\(/);
  assert.match(
    detailSource,
    /\[props\.authToken, props\.contentId, props\.showRelatedPracticeScenarios, props\.userId\]/
  );
  assert.match(detailSource, /relatedGeneration\.current === currentGeneration/);
});

test("optional loading and failure never block or replace the resource viewer", () => {
  assert.match(detailSource, /fetchRelatedPracticeScenarios\([\s\S]*?\.catch\(\(\) => \{/);
  assert.match(detailSource, /\.catch\(\(\) => \{[\s\S]*?setRelatedScenarios\(\[\]\)/);
  assert.doesNotMatch(detailSource, /setLoading\([^)]*related|relatedLoading|relatedError/);
  assert.match(detailSource, /<TrainingContentViewer/);
});

test("mobile renders server summaries without client authorization inference", () => {
  assert.doesNotMatch(modelSource, /entitlement|assignment|orgId|enabled|visible|available/i);
  assert.match(detailSource, /relatedScenarios\.map\(\(scenario\) =>/);
  assert.doesNotMatch(detailSource, /scenario\.enabled|scenario\.orgId|scenario\.assignment/);
});

test("relationship copy and encoded endpoint use learner-facing terminology", () => {
  assert.equal(
    relatedPracticeScenariosPath("learner/a", "resource b"),
    "/mobile/users/learner%2Fa/training-content/resource%20b/related-scenarios"
  );
  const relatedStart = detailSource.indexOf("Related Practice Scenarios");
  const relatedEnd = detailSource.indexOf("{viewerError ? (", relatedStart);
  const relatedMarkup = detailSource.slice(relatedStart, relatedEnd);
  assert.match(relatedMarkup, /Related Practice Scenarios/);
  assert.doesNotMatch(relatedMarkup, /Training Content|>Training</);
});
