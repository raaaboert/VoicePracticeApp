import assert from "node:assert/strict";
import test from "node:test";

import type { MobileTrainingContentLibraryResponse } from "@voicepractice/shared";

import {
  TRAINING_CONTENT_EMPTY_MESSAGE,
  canRequestTrainingContentModule,
  isTrainingContentItemRemoval,
  isTrainingContentModuleRemoval,
  listCategoryItems,
  searchTrainingContent,
  trainingContentErrorMessage,
} from "./model";

const library: MobileTrainingContentLibraryResponse = {
  categories: [
    { id: "first", name: "Onboarding", description: "", itemCount: 1, displayOrder: 0 },
    { id: "second", name: "Product", description: "", itemCount: 1, displayOrder: 1 },
  ],
  items: [
    {
      id: "welcome",
      contentType: "native",
      title: "Welcome guide",
      description: "Start here",
      category: { id: "first", name: "Onboarding" },
      relatedFocusTopic: "First week",
    },
    {
      id: "catalog",
      contentType: "pdf",
      title: "Catalog",
      description: "Current products",
      category: { id: "second", name: "Product" },
      relatedFocusTopic: "Customer Care",
    },
  ],
  truncated: false,
};

test("Training Content search stays within the authorized library fields", () => {
  assert.deepEqual(searchTrainingContent(library.items, "welcome").map((item) => item.id), ["welcome"]);
  assert.deepEqual(searchTrainingContent(library.items, "product").map((item) => item.id), ["catalog"]);
  assert.deepEqual(searchTrainingContent(library.items, "customer care").map((item) => item.id), ["catalog"]);
  assert.deepEqual(searchTrainingContent(library.items, "  ").map((item) => item.id), ["welcome", "catalog"]);
});

test("Learning Resources empty state uses the locked customer-facing terminology", () => {
  assert.equal(TRAINING_CONTENT_EMPTY_MESSAGE, "No Learning Resources are available to you yet.");
});

test("category selection preserves server category and item order", () => {
  assert.deepEqual(listCategoryItems(library, null).map((item) => item.id), ["welcome", "catalog"]);
  assert.deepEqual(listCategoryItems(library, "second").map((item) => item.id), ["catalog"]);
  assert.deepEqual(listCategoryItems(library, "stale"), []);
});

test("module and item access changes remain module-local", () => {
  assert.equal(isTrainingContentModuleRemoval({ code: "module_disabled" }), true);
  assert.equal(isTrainingContentModuleRemoval({ code: "training_content_access_denied" }), true);
  assert.equal(isTrainingContentModuleRemoval({ code: "training_content_not_found" }), false);
  assert.equal(isTrainingContentItemRemoval({ code: "training_content_not_found" }), true);
  assert.equal(
    trainingContentErrorMessage(
      { code: "training_content_storage_unavailable" },
      "fallback"
    ),
    "This resource is temporarily unavailable. Please try again."
  );
});

test("home module bootstrap is limited to complete active organization members", () => {
  const member = {
    id: "member",
    email: "member@example.com",
    firstName: "Active",
    lastName: "Member",
    employeeId: null,
    emailVerifiedAt: "2026-07-28T00:00:00.000Z",
    accountType: "enterprise" as const,
    tier: "enterprise" as const,
    status: "active" as const,
    orgId: "org_a",
    orgRole: "user" as const,
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-07-28T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
  assert.equal(canRequestTrainingContentModule(member), true);
  assert.equal(canRequestTrainingContentModule({ ...member, status: "disabled" }), false);
  assert.equal(canRequestTrainingContentModule({ ...member, orgId: null }), false);
  assert.equal(
    canRequestTrainingContentModule({
      ...member,
      accountType: "individual",
      tier: "free",
      orgId: null,
    }),
    false
  );
  assert.equal(
    canRequestTrainingContentModule({
      ...member,
      mobileProfileReonboardingRequired: true,
    }),
    false
  );
});
