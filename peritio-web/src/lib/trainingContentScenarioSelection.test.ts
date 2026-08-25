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
  listTrainingContentScenarioFocusTopicFilters,
  listTrainingContentScenarioRoleFilters,
  removeTrainingContentScenarioSelection,
  trainingContentScenarioSelectionIds,
} from "./trainingContentScenarioSelection";

const options: DashboardTrainingContentScenarioOption[] = [
  {
    id: "standard_a",
    title: "Discovery call",
    source: "standard",
    role: { id: "sales", label: "Sales" },
    focusTopics: [],
  },
  {
    id: "custom_a",
    title: "Acme objection handling",
    source: "custom",
    role: { id: "sales", label: "Sales" },
    focusTopics: [
      { id: "prospecting", label: "Prospecting" },
      { id: "objections", label: "Objection Handling" },
    ],
  },
  {
    id: "standard_b",
    title: "Coaching conversation",
    source: "standard",
    role: { id: "manager", label: "Manager" },
    focusTopics: [],
  },
  {
    id: "custom_b",
    title: "Renewal objection",
    source: "custom",
    role: { id: "customer_success", label: "Customer Success" },
    focusTopics: [{ id: "retention", label: "Retention" }],
  },
  {
    id: "custom_unmapped",
    title: "General conversation",
    source: "custom",
    role: null,
    focusTopics: [],
  },
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
  assert.match(html, /All Roles/);
  assert.match(html, /Source/);
  assert.match(html, /Available scenarios \(5\)/);
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
    ["custom_a", "custom_b", "custom_unmapped"]
  );
  assert.equal(
    filterTrainingContentScenarioOptions(options, selected, "discovery").length,
    0
  );
});

test("source filters show all, standard-only, and custom-only available scenarios", () => {
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", { source: "all" }).map((option) => option.id),
    ["standard_a", "custom_a", "standard_b", "custom_b", "custom_unmapped"]
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", { source: "standard" }).map((option) => option.id),
    ["standard_a", "standard_b"]
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", { source: "custom" }).map((option) => option.id),
    ["custom_a", "custom_b", "custom_unmapped"]
  );
});

test("role filters use existing role metadata and conservatively exclude unmapped scenarios", () => {
  assert.deepEqual(listTrainingContentScenarioRoleFilters(options), [
    { id: "customer_success", label: "Customer Success" },
    { id: "manager", label: "Manager" },
    { id: "sales", label: "Sales" },
  ]);
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", { roleId: "sales" }).map((option) => option.id),
    ["standard_a", "custom_a"]
  );
});

test("custom Focus Topic filters support multiple relationships and deterministic options", () => {
  assert.deepEqual(listTrainingContentScenarioFocusTopicFilters(options), [
    { id: "objections", label: "Objection Handling" },
    { id: "prospecting", label: "Prospecting" },
    { id: "retention", label: "Retention" },
  ]);
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", {
      source: "custom",
      focusTopicId: "prospecting",
    }).map((option) => option.id),
    ["custom_a"]
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", {
      source: "custom",
      focusTopicId: "objections",
    }).map((option) => option.id),
    ["custom_a"]
  );
});

test("search, role, source, and Focus Topic filters combine", () => {
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "objection", {
      roleId: "sales",
      source: "custom",
      focusTopicId: "prospecting",
    }).map((option) => option.id),
    ["custom_a"]
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "renewal", {
      roleId: "sales",
      source: "custom",
      focusTopicId: "prospecting",
    }),
    []
  );
});

test("switching away from Custom removes the effective Focus Topic restriction", () => {
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, [], "", {
      source: "standard",
      focusTopicId: "prospecting",
    }).map((option) => option.id),
    ["standard_a", "standard_b"]
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

test("filtering available results does not hide, deselect, or change submitted selections", () => {
  const initial = createTrainingContentScenarioSelection(
    [
      { id: "standard_a", title: "Discovery call", available: true },
      { id: "custom_a", title: "Acme objection handling", available: true },
    ],
    options
  );
  assert.deepEqual(
    filterTrainingContentScenarioOptions(options, initial, "renewal", {
      roleId: "customer_success",
      source: "custom",
      focusTopicId: "retention",
    }).map((option) => option.id),
    ["custom_b"]
  );
  assert.deepEqual(trainingContentScenarioSelectionIds(initial), ["standard_a", "custom_a"]);
  assert.deepEqual(buildUpdateRelatedScenarioIdsField(initial, initial), {});

  const html = renderToStaticMarkup(createElement(TrainingContentScenarioSelector, {
    options,
    selected: initial,
    onChange: () => {},
  }));
  assert.match(html, /Discovery call/);
  assert.match(html, /Acme objection handling/);
  assert.match(html, /Selected scenarios \(2\)/);
});

test("duplicate and blank server options are never displayed or selectable", () => {
  const malformed = [
    ...options,
    {
      id: " standard_a ",
      title: "Duplicate",
      source: "standard" as const,
      role: { id: "sales", label: "Sales" },
      focusTopics: [],
    },
    {
      id: " ",
      title: "Blank",
      source: "custom" as const,
      role: null,
      focusTopics: [],
    },
  ];
  assert.deepEqual(
    filterTrainingContentScenarioOptions(malformed, [], "").map((option) => option.id),
    ["standard_a", "custom_a", "standard_b", "custom_b", "custom_unmapped"]
  );
});
