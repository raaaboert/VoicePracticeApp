import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingContentAssignment, TrainingContentItem } from "@voicepractice/shared";

import {
  canScopedActorAttachContent,
  canScopedActorMutateContent,
  isContentVisibleToWholeOrganization,
} from "./focusTopicContentManagementPolicy.js";

const content = {
  id: "content", orgId: "org", publicationState: "published", archivedAt: null,
  createdByActorId: "author",
} as TrainingContentItem;
const organizationAssignment = {
  id: "assignment", orgId: "org", contentId: "content", assignmentType: "organization",
  subjectUserId: null, createdByActorId: "admin", createdAt: "2026-10-08T00:00:00.000Z",
  revokedByActorId: null, revokedAt: null,
} as TrainingContentAssignment;
const topicAttachment = { topicId: "topic", detachedAt: null };
const record = {
  content, categoryArchivedAt: null, assignments: [organizationAssignment],
  topicAttachments: [topicAttachment],
};

test("whole-organization visibility requires a current published item and active organization assignment", () => {
  assert.equal(isContentVisibleToWholeOrganization(record), true);
  assert.equal(isContentVisibleToWholeOrganization({
    ...record, content: { ...content, publicationState: "draft" },
  }), false);
  assert.equal(isContentVisibleToWholeOrganization({
    ...record, assignments: [{ ...organizationAssignment, revokedAt: "2026-10-08T01:00:00.000Z" }],
  }), false);
  assert.equal(isContentVisibleToWholeOrganization({
    ...record, assignments: [{ ...organizationAssignment, assignmentType: "user", subjectUserId: "actor" }],
  }), false);
});

test("scoped actors can attach their current authored item or organization-visible published content", () => {
  assert.equal(canScopedActorAttachContent({ actorId: "author", record: {
    ...record, content: { ...content, publicationState: "draft" }, assignments: [],
  } }), true);
  assert.equal(canScopedActorAttachContent({ actorId: "other", record }), true);
  assert.equal(canScopedActorAttachContent({ actorId: "other", record: {
    ...record, assignments: [],
  } }), false);
  assert.equal(canScopedActorAttachContent({ actorId: "author", record: {
    ...record, categoryArchivedAt: "2026-10-08T02:00:00.000Z",
  } }), false);
});

test("scoped mutation requires current scope over every active Topic and no standalone assignment", () => {
  const base = {
    actorId: "actor",
    actorOrgId: "org",
    actorCurrent: true,
    organizationCurrent: true,
    learningResourcesEnabled: true,
    record: { ...record, assignments: [] },
    manageableTopicIds: new Set(["topic"]),
  };
  assert.equal(canScopedActorMutateContent(base), true);
  assert.equal(canScopedActorMutateContent({
    ...base,
    record: { ...base.record, topicAttachments: [topicAttachment, { topicId: "other", detachedAt: null }] },
  }), false);
  assert.equal(canScopedActorMutateContent({
    ...base,
    manageableTopicIds: new Set(["topic", "other"]),
    record: { ...base.record, topicAttachments: [topicAttachment, { topicId: "other", detachedAt: null }] },
  }), true);
  assert.equal(canScopedActorMutateContent({ ...base, record }), false);
  assert.equal(canScopedActorMutateContent({
    ...base,
    record: { ...base.record, topicAttachments: [] },
  }), false);
  assert.equal(canScopedActorMutateContent({ ...base, actorCurrent: false }), false);
  assert.equal(canScopedActorMutateContent({ ...base, learningResourcesEnabled: false }), false);
});
