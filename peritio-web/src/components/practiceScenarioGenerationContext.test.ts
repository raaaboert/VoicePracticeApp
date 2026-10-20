import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioGenerationRequest, generatedScenarioContextMatches } from "./practiceScenarioGenerationContext";

const options = {
  roleOptions: [
    { id: "sales_rep", label: "Sales Representative", industryIds: ["technology"] },
    { id: "sales_engineer", label: "Sales Engineer", industryIds: ["technology"] },
    { id: "nurse", label: "Nurse", industryIds: ["healthcare"] },
    { id: "doctor", label: "Doctor", industryIds: ["healthcare"] },
  ],
  industryOptions: [{ id: "technology", label: "Technology" }, { id: "healthcare", label: "Healthcare" }],
};

test("generation request carries the selected Role, industries, Topic sources and guidance, not labels", () => {
  for (const [role, industry] of [["sales_rep", "technology"], ["sales_engineer", "technology"],
    ["nurse", "healthcare"], ["doctor", "healthcare"]]) {
    assert.deepEqual(buildScenarioGenerationRequest(options, role!, [industry!], ["source"], "Practice discovery"), {
      segmentId: role, applicableIndustryIds: [industry], sourceContentIds: ["source"], practiceGuidance: "Practice discovery",
    });
  }
});

test("missing, unavailable or incompatible selections cannot construct a generation request", () => {
  for (const [role, industries, message] of [
    ["sales_rep", [], /industry/], ["", ["technology"], /learner Role/],
    ["nurse", ["technology"], /available/], ["foreign_role", ["technology"], /available/],
    ["sales_rep", ["foreign_industry"], /organization/],
  ] as const) {
    assert.throws(() => buildScenarioGenerationRequest(options, role, [...industries], ["source"], ""), message);
  }
  assert.throws(() => buildScenarioGenerationRequest(options, "nurse", ["healthcare"], [], ""), /source/);
});

test("generated draft can save only with its original Role and canonical industry set", () => {
  const generated = { segmentId: "sales_rep", applicableIndustryIds: ["technology", "healthcare"] };
  assert.equal(generatedScenarioContextMatches(generated, "sales_rep", ["healthcare", "technology"]), true);
  assert.equal(generatedScenarioContextMatches(generated, "sales_engineer", ["technology", "healthcare"]), false);
  assert.equal(generatedScenarioContextMatches(generated, "sales_rep", ["technology"]), false);
  assert.equal(generatedScenarioContextMatches(generated, "sales_rep", ["technology", "foreign_industry"]), false);
  assert.equal(generatedScenarioContextMatches({} as typeof generated, "sales_rep", ["technology"]), false,
    "an older generator response must not replace valid editor selections with undefined");
});
