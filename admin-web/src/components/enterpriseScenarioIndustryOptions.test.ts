import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDefaultConfig, type OrgCustomScenario } from "@voicepractice/shared";
import { effectiveScenarioEditorConfig, editableMasterScenarioIndustries } from "./enterpriseScenarioIndustryOptions";

test("Master authoring, generation and editing offer only the selected organization's effective industries", () => {
  const config = createDefaultConfig("2026-10-14T00:00:00Z");
  const industry = config.industries.find((row) => row.enabled)!;
  const other = config.industries.find((row) => row.id !== industry.id)!;
  other.enabled = true;
  const scoped = effectiveScenarioEditorConfig(config, [industry.id])!;
  assert.deepEqual(scoped.industries.map((row) => row.id), [industry.id]);
  assert.ok(scoped.segments.every((role) => scoped.roleIndustries.some((link) => link.active && link.roleId === role.id)));
  const saved = { applicableIndustryIds: [industry.id, other.id] } as OrgCustomScenario;
  assert.deepEqual(editableMasterScenarioIndustries(saved, scoped), [industry.id]);
  assert.deepEqual(saved.applicableIndustryIds, [industry.id, other.id]);
  industry.enabled = false;
  assert.deepEqual(effectiveScenarioEditorConfig(config, [industry.id])!.industries, []);
  assert.deepEqual(effectiveScenarioEditorConfig(config, [])!.segments, []);
});

test("Master editor uses server-scoped options, explains replacements and disables unavailable actions", () => {
  const source = readFileSync(new URL("./EnterpriseCustomScenariosCard.tsx", import.meta.url), "utf8");
  assert.match(source, /industryScope\?\.orgId === orgId \? industryScope\.ids : \[\]/);
  assert.match(source, /setIndustryScope\(\{ orgId: payload\.orgId, ids: payload\.effectiveIndustryIds \?\? \[\] \}\)/);
  assert.match(source, /createEmptyEditorForm\(editorConfig\)/);
  assert.match(source, /editableMasterScenarioIndustries\(scenario, editorConfig\)/);
  assert.match(source, /saved scenario is unchanged until you save/);
  assert.match(source, /No industries are currently available for this organization/);
  assert.match(source, /generatingPreview \|\| industries\.length === 0/);
});
