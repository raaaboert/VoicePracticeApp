import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfile } from "@voicepractice/shared";

import {
  buildFocusTopicNavigationSummary,
  canRequestFocusTopicCatalog,
  createFocusTopicRequestGate,
  FOCUS_TOPICS_EMPTY_MESSAGE,
  formatFocusTopicDetailCounts,
  formatFocusTopicCounts,
  isFocusTopicDetailEmpty,
  isFocusTopicUnavailableError,
  parseFocusTopicCatalogResponse,
  parseFocusTopicDetailResponse,
} from "./model";
import { createMobileApiError } from "../lib/apiError";

const enterpriseMember = {
  id: "learner",
  accountType: "enterprise",
  orgId: "org_a",
  status: "active",
  emailVerifiedAt: "2026-10-01T00:00:00.000Z",
  firstName: "Learner",
  lastName: "Example",
  mobileProfileReonboardingRequired: false,
  isSuperUser: false,
} as UserProfile;

test("catalog eligibility is limited to ready enterprise or acting-org super-user sessions", () => {
  assert.equal(canRequestFocusTopicCatalog(enterpriseMember), true);
  assert.equal(canRequestFocusTopicCatalog({ ...enterpriseMember, status: "disabled" }), false);
  assert.equal(canRequestFocusTopicCatalog({ ...enterpriseMember, orgId: null }), false);
  assert.equal(
    canRequestFocusTopicCatalog(
      { ...enterpriseMember, accountType: "individual", orgId: null, isSuperUser: true },
      true
    ),
    true
  );
  assert.equal(
    canRequestFocusTopicCatalog(
      { ...enterpriseMember, accountType: "individual", orgId: null, isSuperUser: true },
      false
    ),
    false
  );
});

test("catalog parser accepts valid and empty responses while preserving server order", () => {
  const response = parseFocusTopicCatalogResponse({
    topics: [
      { id: "topic_b", name: "Second", description: "B", scenarioCount: 1, resourceCount: 0 },
      { id: "topic_a", name: "First", description: "A", scenarioCount: 0, resourceCount: 2 },
    ],
  });
  assert.deepEqual(response.topics.map((topic) => topic.id), ["topic_b", "topic_a"]);
  assert.deepEqual(parseFocusTopicCatalogResponse({ topics: [] }), { topics: [] });
});

test("catalog parser rejects malformed summaries safely", () => {
  for (const value of [
    null,
    {},
    { topics: "invalid" },
    { topics: [{ id: "", name: "Name", description: "", scenarioCount: 1, resourceCount: 0 }] },
    { topics: [{ id: "a", name: "Name", description: "", scenarioCount: -1, resourceCount: 0 }] },
    { topics: [{ id: "a", name: "Name", description: "", scenarioCount: 1, resourceCount: 0.5 }] },
  ]) {
    assert.throws(() => parseFocusTopicCatalogResponse(value), /catalog response was invalid/);
  }
});

test("count copy handles scenario-only, resource-only, mixed, and singular/plural summaries", () => {
  assert.equal(formatFocusTopicCounts({ scenarioCount: 1, resourceCount: 0 }), "1 scenario");
  assert.equal(formatFocusTopicCounts({ scenarioCount: 0, resourceCount: 1 }), "1 resource");
  assert.equal(formatFocusTopicCounts({ scenarioCount: 2, resourceCount: 3 }), "2 scenarios · 3 resources");
  assert.equal(formatFocusTopicCounts({ scenarioCount: 0, resourceCount: 0 }), "");
  assert.equal(FOCUS_TOPICS_EMPTY_MESSAGE, "No Focus Topics are available right now.");
});

test("navigation summary carries only the authoritative id and safe catalog summary", () => {
  const selection = buildFocusTopicNavigationSummary({
    id: "topic_a",
    name: "Difficult Conversations",
    description: "Practice direct and respectful conversations.",
    scenarioCount: 4,
    resourceCount: 2,
  });
  assert.deepEqual(selection, {
    id: "topic_a",
    name: "Difficult Conversations",
    description: "Practice direct and respectful conversations.",
    scenarioCount: 4,
    resourceCount: 2,
  });
  assert.equal("trainingId" in selection, false);
  assert.equal("scenarios" in selection, false);
  assert.equal("resources" in selection, false);
});

test("request gate aborts superseded work and rejects stale commits", () => {
  const gate = createFocusTopicRequestGate();
  const first = gate.start();
  const second = gate.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);

  gate.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(gate.isCurrent(second), false);
});

function validDetail(): any {
  return {
    topic: { id: "topic", name: "Discovery", description: "Practice discovery." },
    scenarios: [{
      id: "scenario", title: "Discovery call", description: "Ask useful questions.",
      source: "standard", segmentId: "role", segmentLabel: "Account Executive",
      industryId: "industry", industryLabel: "Technology", trainingId: null,
    }],
    resources: [{
      id: "resource", contentType: "pdf", title: "Discovery guide", description: "A guide.",
      category: { id: "category", name: "Guides" }, relatedFocusTopic: "Discovery",
    }],
  };
}

test("detail parser projects safe fields and preserves scenario and resource ordering", () => {
  const value = validDetail();
  value.scenarios.push({
    ...value.scenarios[0],
    id: "custom",
    title: "Custom conversation",
    source: "custom",
    trainingId: "topic",
  });
  value.resources.push({ ...value.resources[0], id: "resource_2", title: "Second guide" });
  const detail = parseFocusTopicDetailResponse(value);

  assert.deepEqual(detail.scenarios.map((scenario) => scenario.id), ["scenario", "custom"]);
  assert.deepEqual(detail.resources.map((resource) => resource.id), ["resource", "resource_2"]);
  assert.equal(formatFocusTopicDetailCounts(detail), "2 scenarios · 2 resources");
  assert.equal(isFocusTopicDetailEmpty(detail), false);
});

test("detail parser rejects malformed topics, scenarios, resources, and attribution shapes", () => {
  const malformedValues: unknown[] = [
    null,
    {},
    { ...validDetail(), topic: { id: "", name: "Topic", description: "" } },
    { ...validDetail(), scenarios: "invalid" },
    { ...validDetail(), scenarios: [{ ...validDetail().scenarios[0], id: "" }] },
    { ...validDetail(), scenarios: [{ ...validDetail().scenarios[0], source: "other" }] },
    { ...validDetail(), scenarios: [{ ...validDetail().scenarios[0], trainingId: "topic" }] },
    {
      ...validDetail(),
      scenarios: [{ ...validDetail().scenarios[0], source: "custom", trainingId: null }],
    },
    { ...validDetail(), resources: [{ ...validDetail().resources[0], contentType: "unknown" }] },
    { ...validDetail(), resources: [{ ...validDetail().resources[0], category: { id: "", name: "" } }] },
  ];
  for (const value of malformedValues) {
    assert.throws(() => parseFocusTopicDetailResponse(value), /detail response was invalid/);
  }
});

test("detail empty and unavailable states fail closed without conflating transient errors", () => {
  const empty = parseFocusTopicDetailResponse({
    topic: { id: "topic", name: "Topic", description: "" },
    scenarios: [],
    resources: [],
  });
  assert.equal(isFocusTopicDetailEmpty(empty), true);
  assert.equal(formatFocusTopicDetailCounts(empty), "");
  assert.equal(
    isFocusTopicUnavailableError(createMobileApiError(404, { code: "focus_topic_not_available" })),
    true
  );
  assert.equal(
    isFocusTopicUnavailableError(createMobileApiError(503, { code: "focus_topic_detail_unavailable" })),
    false
  );
});
