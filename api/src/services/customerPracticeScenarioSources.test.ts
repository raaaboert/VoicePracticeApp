import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingContentAuthorityRecord } from "../storage/trainingContentStore.js";
import {
  CustomerPracticeScenarioSourceError,
  resolveCustomerPracticeScenarioSourceReferences,
} from "./customerPracticeScenarioSources.js";

function record(overrides: Partial<TrainingContentAuthorityRecord> = {}): TrainingContentAuthorityRecord {
  return {
    content: {
      id: "content-1", orgId: "org-1", categoryId: "category-1", title: "Coaching guide",
      description: "", contentType: "pdf", nativeBody: null, externalUrl: null,
      publicationState: "published", focusTopicId: null, focusTopicNameSnapshot: null,
      createdByActorType: "user", createdByActorId: "author", createdAt: "2026-10-01T00:00:00.000Z",
      updatedByActorType: "user", updatedByActorId: "author", updatedAt: "2026-10-01T00:00:00.000Z",
      publishedByActorType: "user", publishedByActorId: "author", publishedAt: "2026-10-01T00:00:00.000Z",
      archivedByActorType: null, archivedByActorId: null, archivedAt: null,
    },
    categoryArchivedAt: null, assignments: [],
    topicAttachments: [{ topicId: "topic-1", detachedAt: null }],
    ...overrides,
  } as TrainingContentAuthorityRecord;
}

test("resolves only current same-org Related Content to canonical immutable references", () => {
  assert.deepEqual(resolveCustomerPracticeScenarioSourceReferences({
    orgId: "org-1", topicId: "topic-1", requestedContentIds: ["content-1", "content-1"],
    contentAuthority: [record()],
  }), [{ kind: "training_content", referenceId: "content-1", label: "Coaching guide" }]);
  assert.deepEqual(resolveCustomerPracticeScenarioSourceReferences({
    orgId: "org-1", topicId: "topic-1", requestedContentIds: [], contentAuthority: [record()],
  }), []);
});

for (const [name, changed] of [
  ["cross-org", { content: { ...record().content, orgId: "org-2" } }],
  ["detached", { topicAttachments: [{ topicId: "topic-1", detachedAt: "2026-10-02T00:00:00.000Z" }] }],
  ["other Topic", { topicAttachments: [{ topicId: "topic-2", detachedAt: null }] }],
  ["archived content", { content: { ...record().content, archivedAt: "2026-10-02T00:00:00.000Z" } }],
  ["archived category", { categoryArchivedAt: "2026-10-02T00:00:00.000Z" }],
] as const) {
  test(`rejects ${name} source content`, () => {
    assert.throws(() => resolveCustomerPracticeScenarioSourceReferences({
      orgId: "org-1", topicId: "topic-1", requestedContentIds: ["content-1"],
      contentAuthority: [record(changed as Partial<TrainingContentAuthorityRecord>)],
    }), CustomerPracticeScenarioSourceError);
  });
}
