import assert from "node:assert/strict";
import test from "node:test";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";

import {
  applyFocusTopicDiscovery,
  compactFocusTopicQuery,
  getFocusTopicDiscoveryVisibility,
  matchesFocusTopicQuery,
  normalizeFocusTopicQuery,
  sortFocusTopicsForLearner,
} from "./discovery";

function topic(
  id: string,
  name: string,
  description = "",
  createdAt = "2026-01-01T00:00:00.000Z",
): MobileFocusTopicCatalogItem {
  return { id, name, description, createdAt, scenarioCount: 1, resourceCount: 0 };
}

test("Default preserves the server sequence through sort changes without mutation", () => {
  const serverTopics = [topic("c", "C"), topic("a", "A"), topic("b", "B")];
  const original = [...serverTopics];
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "company").map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "az").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "company").map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(serverTopics, original);
});

test("A-Z and Z-A are case-insensitive and use ID as the deterministic name tie-break", () => {
  const topics = [topic("z", "sales"), topic("a", "Sales"), topic("m", "Accounting")];
  assert.deepEqual(sortFocusTopicsForLearner(topics, "az").map((entry) => entry.id), ["m", "a", "z"]);
  assert.deepEqual(sortFocusTopicsForLearner(topics, "za").map((entry) => entry.id), ["a", "z", "m"]);
});

test("date sorts use createdAt and deterministically tie by normalized name then ID", () => {
  const topics = [
    topic("z", "Beta", "", "2026-02-01T00:00:00.000Z"),
    topic("b", "alpha", "", "2026-01-01T00:00:00.000Z"),
    topic("a", "Alpha", "", "2026-01-01T00:00:00.000Z"),
    topic("m", "Middle", "", "2026-03-01T00:00:00.000Z"),
  ];
  const original = structuredClone(topics);
  assert.deepEqual(sortFocusTopicsForLearner(topics, "oldest").map((entry) => entry.id), ["a", "b", "z", "m"]);
  assert.deepEqual(sortFocusTopicsForLearner(topics, "newest").map((entry) => entry.id), ["m", "z", "a", "b"]);
  assert.deepEqual(topics, original);
});

test("search normalizes case and whitespace and matches only name plus description with all tokens", () => {
  const sales = topic("sales", "Sales Coaching", "Navigate a difficult conversation constructively");
  assert.equal(compactFocusTopicQuery("  SALES   coaching  "), "SALES coaching");
  assert.equal(normalizeFocusTopicQuery("  SALES   coaching  "), "sales coaching");
  assert.equal(matchesFocusTopicQuery(sales, "sales"), true);
  assert.equal(matchesFocusTopicQuery(sales, "difficult conversation"), true);
  assert.equal(matchesFocusTopicQuery(sales, "SALES"), true);
  assert.equal(matchesFocusTopicQuery(sales, "  sales   coaching  "), true);
  assert.equal(matchesFocusTopicQuery(sales, "conversation sales"), true);
  assert.equal(matchesFocusTopicQuery(sales, "sales missing"), false);
  assert.equal(matchesFocusTopicQuery(sales, "scenario title"), false);
});

test("search applies after the selected sort and clearing restores that sort", () => {
  const topics = [
    topic("c", "Coaching", "Sales practice"),
    topic("a", "Account Planning", "Sales coaching"),
    topic("b", "Building Trust", "Leadership"),
  ];
  assert.deepEqual(applyFocusTopicDiscovery(topics, "company", "sales").map((entry) => entry.id), ["c", "a"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "az", "sales").map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "za", "sales").map((entry) => entry.id), ["c", "a"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "az", "").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "company", "no match"), []);
});

test("catalog refresh reapplies active date sort and query to the replacement server array", () => {
  const initial = [
    topic("c", "Coaching", "Sales", "2026-01-01T00:00:00.000Z"),
    topic("a", "Account Planning", "Sales", "2026-02-01T00:00:00.000Z"),
  ];
  const refreshed = [
    topic("d", "Discovery", "Sales", "2026-04-01T00:00:00.000Z"),
    topic("e", "Enterprise Sales", "Sales", "2026-03-01T00:00:00.000Z"),
    topic("b", "Budgeting", "Finance", "2026-05-01T00:00:00.000Z"),
  ];
  assert.deepEqual(applyFocusTopicDiscovery(initial, "newest", "sales").map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(refreshed, "newest", "sales").map((entry) => entry.id), ["d", "e"]);
  assert.deepEqual(applyFocusTopicDiscovery(refreshed, "newest", "").map((entry) => entry.id), ["b", "d", "e"]);
  assert.deepEqual(applyFocusTopicDiscovery(refreshed, "company", "").map((entry) => entry.id), ["d", "e", "b"]);
});

test("discovery controls follow the locked catalog-size thresholds", () => {
  assert.deepEqual(getFocusTopicDiscoveryVisibility(0, ""), { showSearch: false, showSort: false });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(1, ""), { showSearch: false, showSort: false });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(2, ""), { showSearch: false, showSort: true });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(4, ""), { showSearch: false, showSort: true });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(5, ""), { showSearch: true, showSort: true });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(1, " active  query "), { showSearch: true, showSort: false });
  assert.deepEqual(getFocusTopicDiscoveryVisibility(1, "   "), { showSearch: false, showSort: false });
});
