import assert from "node:assert/strict";
import test from "node:test";
import { editableScenarioIndustries, scenarioRolesForIndustries, publishedScenarioIndustriesUnavailable, scenarioIndustryLabel } from "./practiceScenarioIndustryOptions";
import type { CustomerPracticeScenario } from "@voicepractice/shared";

test("revisions remove inactive industries only from the editable draft", () => {
  const saved = ["sales", "medical"];
  assert.deepEqual(editableScenarioIndustries(saved, [{ id: "sales", label: "Sales" }]), ["sales"]);
  assert.deepEqual(saved, ["sales", "medical"]);
  assert.deepEqual(editableScenarioIndustries(saved, []), []);
});

test("role options retain existing role-union semantics within the authorized selected industries", () => {
  const roles = [
    { id: "sales_role", label: "Sales", industryIds: ["sales"] },
    { id: "shared_role", label: "Shared", industryIds: ["sales", "medical"] },
  ];
  assert.deepEqual(scenarioRolesForIndustries(roles, ["sales", "medical"]).map((role) => role.id), ["sales_role", "shared_role"]);
  assert.deepEqual(scenarioRolesForIndustries(roles, ["medical"]).map((role) => role.id), ["shared_role"]);
  assert.deepEqual(scenarioRolesForIndustries(roles, ["unavailable"]), []);
  assert.deepEqual(scenarioRolesForIndustries([], []), []);
});

test("published eligibility uses the published version while historical details retain readable names", () => {
  const scenario = { publishedVersion: { applicableIndustryIds: ["medical"] },
    currentVersion: { applicableIndustryIds: ["sales"] } } as CustomerPracticeScenario;
  const options = [{ id: "sales", label: "Sales" }];
  assert.equal(publishedScenarioIndustriesUnavailable(scenario, options), true);
  assert.equal(publishedScenarioIndustriesUnavailable(scenario, [...options, { id: "medical", label: "Healthcare" }]), false);
  assert.equal(publishedScenarioIndustriesUnavailable({ ...scenario, publishedVersion: null }, []), false);
  assert.equal(scenarioIndustryLabel("medical", { industryOptions: options,
    historicalIndustryLabels: [{ id: "medical", label: "Healthcare" }] }), "Healthcare (currently unavailable)");
  assert.equal(scenarioIndustryLabel("sales", { industryOptions: options }), "Sales");
});
