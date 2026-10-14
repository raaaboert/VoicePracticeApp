import assert from "node:assert/strict";
import test from "node:test";
import { editableScenarioIndustries, scenarioRolesForIndustries } from "./practiceScenarioIndustryOptions";

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
