import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig, EnterpriseOrg } from "@voicepractice/shared";
import { listTopicScenarioManagement, topicScenarioOptions } from "./focusTopicScenarioManagement.js";

function fixture() {
  const config = { industries: [{ id: "sales", label: "Sales", enabled: true }],
    roleIndustries: [{ roleId: "seller", industryId: "sales", active: true }],
    segments: [{ id: "seller", label: "Seller", enabled: true,
      scenarios: [{ id: "standard", title: "Standard discovery", enabled: true }] }] } as unknown as AppConfig;
  const org = { id: "a", activeIndustries: ["sales"], customScenarios: [
    { id: "custom", orgId: "a", title: "Local negotiation", segmentId: "seller", applicableIndustryIds: ["sales"], enabled: true },
    { id: "disabled", orgId: "a", title: "Disabled local", segmentId: "seller", applicableIndustryIds: ["sales"], enabled: false },
    { id: "disabled", orgId: "b", title: "Foreign enabled", segmentId: "seller", applicableIndustryIds: ["sales"], enabled: true },
  ] } as unknown as EnterpriseOrg;
  const relationship = (id: string, scenarioId: string, topicId = "one", orgId = "a") => ({
    id, orgId, topicId, scenarioKind: "org" as const, scenarioId,
    attachedBy: "admin", attachedAt: "2026-10-01T00:00:00Z", detachedAt: null, detachedBy: null,
  });
  return { config, org, topicId: "one", topicActive: true, search: "", page: 1, canManage: true,
    authority: { assignments: [], contentAttachments: [], scenarioAttachments: [
      relationship("local", "custom"), relationship("disabled", "disabled"),
      relationship("other-topic", "custom", "two"), relationship("foreign", "custom", "one", "b"),
    ] } };
}

test("direct scenarios have scoped titles, separate source labels and honest disabled availability; no resources or foreign definitions", () => {
  const result = listTopicScenarioManagement(fixture());
  assert.equal(result.attached.length, 2);
  assert.deepEqual(result.attached.map(row => row.scenario.title), ["Local negotiation", "Disabled local"]);
  assert.equal(result.attached[1].scenario.available, false);
  assert.deepEqual(result.items.map(row => [row.title, row.kind]), [["Local negotiation", "org"], ["Standard discovery", "standard"]]);
  assert.equal(result.items[0].attached, true);
  assert.equal(JSON.stringify(result).includes("Foreign enabled"), false);
  assert.equal(JSON.stringify(result).includes("scoringGuidance"), false);
});

test("search filters the entire authorized catalog before stable ten-row pagination", () => {
  const input = fixture();
  input.org.customScenarios = Array.from({ length: 27 }, (_, i) => ({ ...input.org.customScenarios![0], id: `s${i}`, title: `Negotiation ${String(i).padStart(2, "0")}` }));
  const first = listTopicScenarioManagement({ ...input, search: "NEGOTIATION" });
  const second = listTopicScenarioManagement({ ...input, search: "negotiation", page: 2 });
  assert.equal(first.total, 27); assert.equal(first.items.length, 10); assert.equal(second.items.length, 10);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 20);
  assert.equal(listTopicScenarioManagement({ ...input, search: "26" }).items[0].id, "s26");
  assert.equal(listTopicScenarioManagement({ ...input, search: "missing" }).total, 0);
});

test("management catalog excludes inactive Role/industry and scoped managers cannot browse or mutate the org catalog", () => {
  const input = fixture();
  assert.equal(listTopicScenarioManagement({ ...input, canManage: false }).items.length, 0);
  assert.equal(listTopicScenarioManagement({ ...input, canManage: false }).attached.length, 2);
  input.org.activeIndustries = [];
  assert.equal(topicScenarioOptions(input.config, input.org).some(row => row.available), false);
  input.org.activeIndustries = ["sales"];
  input.config.segments[0].enabled = false;
  assert.equal(topicScenarioOptions(input.config, input.org).some(row => row.available), false);
});

test("detached history is separate from active counts and missing definitions are not replaced with another organization's same-ID scenario", () => {
  const input = fixture();
  input.authority.scenarioAttachments[0] = { ...input.authority.scenarioAttachments[0], detachedAt: "2026-10-02T00:00:00Z" } as any;
  input.org.customScenarios = input.org.customScenarios!.filter(row => row.id !== "disabled" || row.orgId !== "a");
  const result = listTopicScenarioManagement(input);
  assert.equal(result.history.length, 1); assert.equal(result.attached.length, 1);
  assert.equal(result.attached[0].scenario.title, "Unavailable scenario");
  assert.equal(result.attached[0].scenario.available, false);
});

test("only the existing published-version marker identifies Create & Review origin; home-Topic metadata stays scoped", () => {
  const input = fixture();
  const ordinary = input.org.customScenarios![0];
  ordinary.homeFocusTopicId = "one";
  assert.equal(listTopicScenarioManagement(input).attached[0].scenario.lifecycleManaged, false);
  assert.equal(listTopicScenarioManagement(input).attached[0].scenario.isHomeTopic, false);
  ordinary.customerScenarioVersionId = "  ";
  assert.equal(listTopicScenarioManagement(input).attached[0].scenario.lifecycleManaged, false);
  ordinary.customerScenarioVersionId = "published-v1";
  const stored = structuredClone(input.org);
  const home = listTopicScenarioManagement(input).attached[0].scenario;
  assert.equal(home.lifecycleManaged, true); assert.equal(home.isHomeTopic, true);
  const elsewhere = listTopicScenarioManagement({ ...input, topicId: "two" }).attached[0].scenario;
  assert.equal(elsewhere.lifecycleManaged, true); assert.equal(elsewhere.isHomeTopic, false);
  const standard = topicScenarioOptions(input.config, input.org, "one").find(row => row.kind === "standard")!;
  assert.equal(standard.lifecycleManaged, false); assert.equal(standard.isHomeTopic, false);
  assert.deepEqual(input.org, stored, "Management projection must not alter stored publication/version data");
  assert.equal("customerScenarioVersionId" in home, false);
});

test("displayed industries reflect the existing organization/Role intersection without changing availability", () => {
  const input = fixture();
  input.config.industries.push(
    { ...input.config.industries[0], id: "medical", label: "Medical", enabled: true },
    { ...input.config.industries[0], id: "retired", label: "Retired", enabled: false },
  );
  input.config.roleIndustries.push(
    { ...input.config.roleIndustries[0], industryId: "medical" },
    { ...input.config.roleIndustries[0], industryId: "retired" },
  );
  input.org.activeIndustries = ["sales", "retired"];
  input.org.customScenarios![0].applicableIndustryIds = ["sales", "medical", "retired"];
  const current = topicScenarioOptions(input.config, input.org);
  for (const item of current.filter(row => row.id === "custom" || row.kind === "standard")) {
    assert.deepEqual(item.industries, ["Sales"]); assert.equal(item.available, true);
  }
  input.org.activeIndustries = ["sales", "medical", "retired"];
  for (const item of topicScenarioOptions(input.config, input.org).filter(row => row.id === "custom" || row.kind === "standard")) {
    assert.deepEqual(item.industries, ["Sales", "Medical"]); assert.equal(item.available, true);
  }
  input.org.activeIndustries = [];
  assert.ok(topicScenarioOptions(input.config, input.org).every(row => !row.available && row.industries.length === 0));
});

test("archived Topic status is exposed separately from the unchanged mutation permission", () => {
  const result = listTopicScenarioManagement({ ...fixture(), topicActive: false, topicStatus: "archived", canManage: false });
  assert.equal(result.topicStatus, "archived"); assert.equal(result.canManage, false);
  assert.equal(result.attached.length, 2); assert.equal(result.items.length, 0);
});
