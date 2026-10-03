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

function topic(id: string, name: string, description = ""): MobileFocusTopicCatalogItem {
  return { id, name, description, scenarioCount: 1, resourceCount: 0 };
}

test("Company Order preserves the server sequence through sort changes without mutation", () => {
  const serverTopics = [topic("c", "C"), topic("a", "A"), topic("b", "B")];
  const original = [...serverTopics];
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "company").map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "alphabetical").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(sortFocusTopicsForLearner(serverTopics, "company").map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(serverTopics, original);
});

test("A-Z is case-insensitive and uses ID as the deterministic name tie-break", () => {
  const topics = [topic("z", "sales"), topic("a", "Sales"), topic("m", "Accounting")];
  assert.deepEqual(sortFocusTopicsForLearner(topics, "alphabetical").map((entry) => entry.id), ["m", "a", "z"]);
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
  assert.deepEqual(applyFocusTopicDiscovery(topics, "alphabetical", "sales").map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "alphabetical", "").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(topics, "company", "no match"), []);
});

test("catalog refresh reapplies active controls to the replacement server array", () => {
  const initial = [topic("c", "Coaching", "Sales"), topic("a", "Account Planning", "Sales")];
  const refreshed = [topic("d", "Discovery", "Sales"), topic("b", "Budgeting", "Finance")];
  assert.deepEqual(applyFocusTopicDiscovery(initial, "alphabetical", "sales").map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(applyFocusTopicDiscovery(refreshed, "alphabetical", "sales").map((entry) => entry.id), ["d"]);
  assert.deepEqual(applyFocusTopicDiscovery(refreshed, "company", "").map((entry) => entry.id), ["d", "b"]);
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
