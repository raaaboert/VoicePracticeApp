import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig, EnterpriseOrg, OrgCustomScenario } from "@voicepractice/shared";

import type {
  ReplaceTrainingContentScenarioLinksInput,
  TrainingContentScenarioLink,
} from "../storage/trainingContentStore.js";
import {
  createTrainingContentScenarioLinkService,
  listValidTrainingContentScenarioLinkTargets,
  TrainingContentScenarioLinkServiceError,
} from "./trainingContentScenarioLinks.js";

const config: Pick<AppConfig, "segments" | "industries" | "roleIndustries"> = {
  industries: [
    { id: "solar", label: "Solar", enabled: true },
    { id: "medical", label: "Medical", enabled: true },
  ],
  roleIndustries: [
    { roleId: "sales", industryId: "solar", active: true },
    { roleId: "disabled_segment", industryId: "solar", active: true },
    { roleId: "medical", industryId: "medical", active: true },
  ],
  segments: [
    {
      id: "sales",
      label: "Sales",
      summary: "Sales",
      enabled: true,
      scenarios: [
        { id: "standard_visible", segmentId: "sales", title: "Visible", description: "Visible", aiRole: "Buyer" },
        { id: "standard_disabled", segmentId: "sales", title: "Disabled", description: "Disabled", aiRole: "Buyer", enabled: false },
      ],
    },
    {
      id: "disabled_segment",
      label: "Disabled segment",
      summary: "Disabled segment",
      enabled: false,
      scenarios: [
        {
          id: "standard_disabled_segment",
          segmentId: "disabled_segment",
          title: "Disabled segment scenario",
          description: "Disabled segment scenario",
          aiRole: "Buyer",
          enabled: true,
        },
      ],
    },
    {
      id: "medical",
      label: "Medical",
      summary: "Medical",
      enabled: true,
      scenarios: [
        { id: "standard_hidden", segmentId: "medical", title: "Hidden", description: "Hidden", aiRole: "Patient" },
      ],
    },
  ],
};

function customScenario(overrides: Partial<OrgCustomScenario> = {}): OrgCustomScenario {
  return {
    id: "custom_visible",
    orgId: "org_1",
    segmentId: "sales",
    title: "Custom visible",
    description: "Custom visible",
    aiRole: "Buyer",
    scoringGuidance: "Score it",
    applicableIndustryIds: ["solar"],
    enabled: true,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin_1",
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:00.000Z",
    ...overrides,
  };
}

function org(customScenarios: OrgCustomScenario[] = []): Pick<
  EnterpriseOrg,
  "id" | "activeIndustries" | "customScenarios"
> {
  return { id: "org_1", activeIndustries: ["solar"], customScenarios };
}

function link(overrides: Partial<TrainingContentScenarioLink> = {}): TrainingContentScenarioLink {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    orgId: "org_1",
    contentId: "20000000-0000-4000-8000-000000000001",
    focusTopicId: null,
    scenarioId: "standard_visible",
    createdByActorId: "admin_1",
    createdAt: "2026-08-24T12:00:00.000Z",
    removedByActorId: null,
    removedAt: null,
    ...overrides,
  };
}

class FakeScenarioLinkStore {
  byContent: TrainingContentScenarioLink[] = [];
  byScenario: TrainingContentScenarioLink[] = [];
  replacements: ReplaceTrainingContentScenarioLinksInput[] = [];
  contentReads: Array<[string, string]> = [];
  scenarioReads: Array<[string, string]> = [];

  async listActiveScenarioLinksForContent(orgId: string, contentId: string) {
    this.contentReads.push([orgId, contentId]);
    return this.byContent;
  }

  async listActiveScenarioLinksForScenario(orgId: string, scenarioId: string) {
    this.scenarioReads.push([orgId, scenarioId]);
    return this.byScenario;
  }

  async replaceActiveScenarioLinksForContent(input: ReplaceTrainingContentScenarioLinksInput) {
    this.replacements.push(input);
    return input.scenarioIds.map((scenarioId, index) => link({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      contentId: input.contentId,
      scenarioId,
    }));
  }
}

test("scenario-link targets include visible standard and same-org enabled custom scenarios", () => {
  const targets = listValidTrainingContentScenarioLinkTargets({
    config,
    org: org([customScenario()]),
  });

  assert.deepEqual(
    targets.map((target) => [target.scenarioId, target.source]),
    [["custom_visible", "custom"], ["standard_visible", "standard"]]
  );
});

test("scenario-link targets reject standard scenarios outside the organization's industries", () => {
  const ids = listValidTrainingContentScenarioLinkTargets({ config, org: org() })
    .map((target) => target.scenarioId);
  assert.equal(ids.includes("standard_hidden"), false);
});

test("scenario-link targets reject disabled standard and custom scenarios", () => {
  const ids = listValidTrainingContentScenarioLinkTargets({
    config,
    org: org([customScenario({ id: "custom_disabled", enabled: false })]),
  }).map((target) => target.scenarioId);
  assert.equal(ids.includes("standard_disabled"), false);
  assert.equal(ids.includes("custom_disabled"), false);
});

test("scenario-link targets reject standard scenarios under disabled segments", () => {
  const ids = listValidTrainingContentScenarioLinkTargets({ config, org: org() })
    .map((target) => target.scenarioId);
  assert.equal(ids.includes("standard_disabled_segment"), false);
});

test("scenario-link targets reject custom scenarios owned by another organization", () => {
  const ids = listValidTrainingContentScenarioLinkTargets({
    config,
    org: org([customScenario({ id: "cross_org", orgId: "org_2" })]),
  }).map((target) => target.scenarioId);
  assert.equal(ids.includes("cross_org"), false);
});

test("service returns raw scenario-link candidates with explicit tenant scoping", async () => {
  const store = new FakeScenarioLinkStore();
  store.byContent = [link()];
  const service = createTrainingContentScenarioLinkService(store);

  assert.deepEqual(
    await service.listRawScenarioLinkCandidatesForContent(" org_1 ", " content_1 "),
    store.byContent
  );
  assert.deepEqual(store.contentReads, [["org_1", "content_1"]]);
});

test("service returns deduplicated raw content candidate IDs for a scenario", async () => {
  const store = new FakeScenarioLinkStore();
  store.byScenario = [link(), link({ id: "10000000-0000-4000-8000-000000000002" })];
  const service = createTrainingContentScenarioLinkService(store);

  assert.deepEqual(
    await service.listRawContentLinkCandidateIdsForScenario("org_1", "standard_visible"),
    ["20000000-0000-4000-8000-000000000001"]
  );
  assert.deepEqual(store.scenarioReads, [["org_1", "standard_visible"]]);
});

test("service accepts a visible standard scenario", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: ["standard_visible"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.deepEqual(store.replacements[0]?.scenarioIds, ["standard_visible"]);
});

test("service accepts an enabled custom scenario owned by the organization", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await service.replaceScenarioLinksForContent({
    config,
    org: org([customScenario()]),
    contentId: "content_1",
    scenarioIds: ["custom_visible"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.deepEqual(store.replacements[0]?.scenarioIds, ["custom_visible"]);
});

test("replacement preserves an unavailable scenario only when it is already linked", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: ["standard_disabled", "standard_visible"],
    preservedExistingScenarioIds: ["standard_disabled"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.deepEqual(
    store.replacements[0]?.scenarioIds,
    ["standard_disabled", "standard_visible"]
  );
});

test("preserving one unavailable scenario does not permit a different unavailable scenario", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);

  await assert.rejects(
    service.replaceScenarioLinksForContent({
      config,
      org: org(),
      contentId: "content_1",
      scenarioIds: ["standard_disabled", "some_other_disabled"],
      preservedExistingScenarioIds: ["standard_disabled"],
      actor: { actorType: "platform_admin", actorId: "admin_1" },
    }),
    (error: unknown) => error instanceof TrainingContentScenarioLinkServiceError
      && error.code === "invalid_scenario_link_target"
  );
  assert.equal(store.replacements.length, 0);
});

test("service rejects nonexistent, invisible, cross-org, and disabled scenarios before mutation", async () => {
  for (const scenarioId of [
    "missing",
    "standard_hidden",
    "standard_disabled",
    "standard_disabled_segment",
    "cross_org",
    "custom_disabled",
  ]) {
    const store = new FakeScenarioLinkStore();
    const service = createTrainingContentScenarioLinkService(store);
    await assert.rejects(
      service.replaceScenarioLinksForContent({
        config,
        org: org([
          customScenario({ id: "cross_org", orgId: "org_2" }),
          customScenario({ id: "custom_disabled", enabled: false }),
        ]),
        contentId: "content_1",
        scenarioIds: [scenarioId],
        actor: { actorType: "platform_admin", actorId: "admin_1" },
      }),
      (error: unknown) => error instanceof TrainingContentScenarioLinkServiceError
        && error.code === "invalid_scenario_link_target"
    );
    assert.equal(store.replacements.length, 0);
  }
});

test("mixed valid and invalid replacement is rejected atomically", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await assert.rejects(service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: ["standard_visible", "missing"],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  }));
  assert.equal(store.replacements.length, 0);
});

test("replacement trims and deduplicates scenario IDs before mutation", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: ["standard_visible", " standard_visible "],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.deepEqual(store.replacements[0]?.scenarioIds, ["standard_visible"]);
});

test("replacement rejects blank scenario IDs before mutation", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await assert.rejects(service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: [" "],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  }));
  assert.equal(store.replacements.length, 0);
});

test("replacement allows an empty optional relationship set", async () => {
  const store = new FakeScenarioLinkStore();
  const service = createTrainingContentScenarioLinkService(store);
  await service.replaceScenarioLinksForContent({
    config,
    org: org(),
    contentId: "content_1",
    scenarioIds: [],
    actor: { actorType: "platform_admin", actorId: "admin_1" },
  });
  assert.deepEqual(store.replacements[0]?.scenarioIds, []);
});
