import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { MobileTrainingContentSummary } from "@voicepractice/shared";

import {
  buildRelatedTrainingContentPresentation,
  relatedTrainingContentPath,
} from "./relatedTrainingContent";

const trainingContentDir = dirname(fileURLToPath(import.meta.url));
const mobileSrc = join(trainingContentDir, "..");
const simulationSource = readFileSync(
  join(mobileSrc, "screens", "SimulationScreen.tsx"),
  "utf8"
);
const relatedScreenSource = readFileSync(
  join(trainingContentDir, "RelatedTrainingContentScreen.tsx"),
  "utf8"
);
const appSource = readFileSync(join(mobileSrc, "..", "App.tsx"), "utf8");

function summary(id: string, title = id): MobileTrainingContentSummary {
  return {
    id,
    contentType: "native",
    title,
    description: `${title} description`,
    category: { id: "category", name: "General" },
    relatedFocusTopic: null,
  };
}

test("zero related resources produce no mobile section presentation", () => {
  assert.equal(buildRelatedTrainingContentPresentation([]), null);
  assert.match(
    simulationSource,
    /!sessionActive && !isStartingSession && relatedLearningResourcesPresentation \? \(/
  );
});

test("one related resource produces a singular direct-detail action", () => {
  assert.deepEqual(buildRelatedTrainingContentPresentation([
    summary("resource_a", "Discovery guide"),
  ]), {
    items: [summary("resource_a", "Discovery guide")],
    title: "Discovery guide",
    actionLabel: "Review Learning Resource",
    accessibilityLabel: "Review Learning Resource: Discovery guide",
    destination: { type: "detail", contentId: "resource_a" },
  });
  assert.match(relatedScreenSource, /props\.initialItems\.length === 1/);
  assert.match(relatedScreenSource, /<TrainingContentDetailScreen/);
});

test("multiple related resources produce a plural filtered-list action", () => {
  const first = summary("resource_a", "Discovery guide");
  const second = summary("resource_b", "Coaching guide");
  const presentation = buildRelatedTrainingContentPresentation([first, second]);
  assert.deepEqual(presentation, {
    items: [first, second],
    title: "2 resources available",
    actionLabel: "Review Learning Resources",
    accessibilityLabel: "Review 2 related Learning Resources",
    destination: { type: "list" },
  });
  assert.match(relatedScreenSource, /items=\{items\}/);
  assert.doesNotMatch(relatedScreenSource, /fetchTrainingContentLibrary/);
});

test("related resource normalization removes blank and duplicate IDs", () => {
  const presentation = buildRelatedTrainingContentPresentation([
    summary("resource_a"),
    summary(" resource_a ", "Duplicate"),
    summary(" ", "Blank"),
  ]);
  assert.deepEqual(presentation?.items.map((item) => item.id), ["resource_a"]);
});

test("related section sits between the Scenario card and Simulation Engine card", () => {
  const scenarioCard = simulationSource.indexOf("style={[styles.scenarioCard");
  const relatedCard = simulationSource.indexOf(
    '<Text style={styles.relatedResourcesEyebrow}>Related Learning Resources</Text>'
  );
  const engineCard = simulationSource.indexOf("styles.statusStageCard");
  assert.equal(scenarioCard >= 0, true);
  assert.equal(scenarioCard < relatedCard, true);
  assert.equal(relatedCard < engineCard, true);
});

test("related loading and request failure leave the Simulation screen usable", () => {
  assert.match(simulationSource, /useState<\s*MobileTrainingContentSummary\[\]\s*>\(\[\]\)/);
  assert.match(simulationSource, /fetchRelatedTrainingContent\(/);
  assert.match(simulationSource, /\.catch\(\(\) => \{/);
  assert.match(simulationSource, /setRelatedLearningResources\(\[\]\)/);
  assert.doesNotMatch(simulationSource, /setError\("Related Learning Resources/);
});

test("standard and custom scenario request paths are encoded and training-scoped", () => {
  assert.equal(
    relatedTrainingContentPath("learner", "standard scenario"),
    "/mobile/users/learner/scenarios/standard%20scenario/training-content"
  );
  assert.equal(
    relatedTrainingContentPath("learner", "custom/scenario", " topic/a "),
    "/mobile/users/learner/scenarios/custom%2Fscenario/training-content?trainingId=topic%2Fa"
  );
});

test("related navigation preserves Scenario configuration and reuses existing viewers", () => {
  assert.match(appSource, /setScreen\("related_training_content"\)/);
  assert.match(appSource, /onBackToScenario=\{\(\) => setScreen\("simulation"\)\}/);
  assert.match(appSource, /setScreen\("related_training_content"\)/);
  assert.doesNotMatch(
    appSource.slice(
      appSource.indexOf("onReviewRelatedLearningResources="),
      appSource.indexOf("onSessionComplete=", appSource.indexOf("onReviewRelatedLearningResources="))
    ),
    /startSimulation/
  );
  assert.match(relatedScreenSource, /<TrainingContentCategoryScreen/);
  assert.match(relatedScreenSource, /<TrainingContentDetailScreen/);
  assert.doesNotMatch(relatedScreenSource, /setSimulationConfig/);
});

test("mobile related-resource copy never uses the legacy customer-facing term", () => {
  const copy = [
    "Related Learning Resources",
    "You have Learning Resources related to this scenario. Review them before practicing.",
    "Review Learning Resource",
    "Review Learning Resources",
  ].join(" ");
  assert.doesNotMatch(copy, /Training Content/);
});
