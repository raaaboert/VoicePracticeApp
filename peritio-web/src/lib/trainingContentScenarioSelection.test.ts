import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardTrainingContentScenarioOption } from "@voicepractice/shared";

import { TrainingContentScenarioSelector } from "@/src/components/TrainingContentScenarioSelector";
import {
  addTrainingContentScenarioSelection,
  buildCreateRelatedScenarioIdsField,
  buildUpdateRelatedScenarioIdsField,
  createTrainingContentScenarioSelection,
  filterTrainingContentScenarioOptions,
  hasTrainingContentScenarioSelectionChanges,
  removeTrainingContentScenarioSelection,
  trainingContentScenarioSelectionIds,
} from "./trainingContentScenarioSelection";

const options: DashboardTrainingContentScenarioOption[] = [
  { id: "standard_a", title: "Discovery call", source: "standard" },
  { id: "custom_a", title: "Acme objection handling", source: "custom" },
  { id: "standard_b", title: "Coaching conversation", source: "standard" },
];

test("Related Scenarios selector renders its label, options, source, and empty selection", () => {
  const html = renderToStaticMarkup(createElement(TrainingContentScenarioSelector, {
    options,
    selected: [],
    onChange: () => {},
  }));
  assert.match(html, /Related Scenarios/);
  assert.match(html, /No related scenarios selected/);
  assert.match(html, /Discovery call/);
  assert.match(html, /Standard/);
  assert.match(html, /Acme objection handling/);
  assert.match(html, /Custom/);
  assert.match(html, /aria-label="Available scenarios"/);
  assert.match(html, /Search scenarios/);
});

test("create permits zero selections and preserves omission until selection changes", () => {
  assert.deepEqual(buildCreateRelatedScenarioIdsField([], false), {});
  assert.deepEqual(buildCreateRelatedScenarioIdsField([], true), { relatedScenarioIds: [] });
});

test("scenario search filters by title and source and excludes selected options", () => {
  const selected = createTrainingContentScenarioSelection(
    [{ id: "standard_a", title: "Discovery call", available: true }],
    options
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, selected, "coaching").map((option) => option.id),
    ["standard_b"]
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, selected, "custom").map((option) => option.id),
    ["custom_a"]
  );
  assert.equal(
    filterTrainingContentScenarioOptions(options, selected, "discovery").length,
    0
  );
});

test("one and many selections can be added and removed", () => {
  const one = addTrainingContentScenarioSelection([], options[0]!);
  const many = addTrainingContentScenarioSelection(one, options[1]!);
  assert.deepEqual(trainingContentScenarioSelectionIds(one), ["standard_a"]);
  assert.deepEqual(trainingContentScenarioSelectionIds(many), ["standard_a", "custom_a"]);
  assert.deepEqual(
    trainingContentScenarioSelectionIds(
      removeTrainingContentScenarioSelection(many, "standard_a")
    ),
    ["custom_a"]
  );
});

test("selection IDs contain no blanks or duplicates", () => {
  const selected = [
    ...addTrainingContentScenarioSelection([], options[0]!),
    { id: " standard_a ", title: "Duplicate", available: true, source: "standard" as const },
    { id: " ", title: "Blank", available: true, source: "custom" as const },
  ];
  assert.deepEqual(trainingContentScenarioSelectionIds(selected), ["standard_a"]);
  assert.deepEqual(buildCreateRelatedScenarioIdsField(selected, true), {
    relatedScenarioIds: ["standard_a"],
  });
});

test("one and many existing relationships initialize as selected", () => {
  const one = createTrainingContentScenarioSelection(
    [{ id: "standard_a", title: "Discovery call", available: true }],
    options
  );
  const many = createTrainingContentScenarioSelection(
    [
      { id: "standard_a", title: "Discovery call", available: true },
      { id: "custom_a", title: "Acme objection handling", available: true },
    ],
    options
  );
  assert.deepEqual(trainingContentScenarioSelectionIds(one), ["standard_a"]);
  assert.deepEqual(trainingContentScenarioSelectionIds(many), ["standard_a", "custom_a"]);
  assert.deepEqual(many.map((scenario) => scenario.source), ["standard", "custom"]);
});

test("unavailable existing relationships remain visible, labeled, and removable", () => {
  const selected = createTrainingContentScenarioSelection(
    [{ id: "old_scenario", title: "Retired scenario", available: false }],
    options
  );
  const html = renderToStaticMarkup(createElement(TrainingContentScenarioSelector, {
    options,
    selected,
    onChange: () => {},
  }));
  assert.match(html, /Retired scenario/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Remove Retired scenario \(unavailable\)/);
  assert.equal(filterTrainingContentScenarioOptions(options, selected, "retired").length, 0);
  assert.deepEqual(removeTrainingContentScenarioSelection(selected, "old_scenario"), []);
});

test("unchanged edit selection omits relatedScenarioIds regardless of order", () => {
  const initial = createTrainingContentScenarioSelection(
    [
      { id: "standard_a", title: "Discovery call", available: true },
      { id: "custom_a", title: "Acme objection handling", available: true },
    ],
    options
  );
  assert.equal(hasTrainingContentScenarioSelectionChanges(initial, [...initial].reverse()), false);
  assert.deepEqual(buildUpdateRelatedScenarioIdsField(initial, [...initial].reverse()), {});
});

test("changed edit selection submits the exact replacement and removing all submits empty", () => {
  const initial = createTrainingContentScenarioSelection(
    [{ id: "standard_a", title: "Discovery call", available: true }],
    options
  );
  const changed = addTrainingContentScenarioSelection(initial, options[1]!);
  assert.deepEqual(buildUpdateRelatedScenarioIdsField(initial, changed), {
    relatedScenarioIds: ["standard_a", "custom_a"],
  });
  assert.deepEqual(buildUpdateRelatedScenarioIdsField(initial, []), { relatedScenarioIds: [] });
});

test("adding a scenario retains existing available and stale IDs", () => {
  const initial = createTrainingContentScenarioSelection(
    [
      { id: "standard_a", title: "Discovery call", available: true },
      { id: "old_scenario", title: "Retired scenario", available: false },
    ],
    options
  );
  const changed = addTrainingContentScenarioSelection(initial, options[1]!);
  assert.deepEqual(buildUpdateRelatedScenarioIdsField(initial, changed), {
    relatedScenarioIds: ["standard_a", "old_scenario", "custom_a"],
  });
});

test("duplicate and blank server options are never displayed or selectable", () => {
  const malformed = [
    ...options,
    { id: " standard_a ", title: "Duplicate", source: "standard" as const },
    { id: " ", title: "Blank", source: "custom" as const },
  ];
  assert.deepEqual(
    filterTrainingContentScenarioOptions(malformed, [], "").map((option) => option.id),
    ["standard_a", "custom_a", "standard_b"]
  );
});
