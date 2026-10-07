import assert from "node:assert/strict";
import test from "node:test";

import type { FocusTopicAuthorityBackfillInput } from "./focusTopicAuthorityBackfill.js";
import { buildFocusTopicAuthorityBackfillPlan } from "./focusTopicAuthorityBackfill.js";

const NOW="2026-10-06T12:00:00.000Z";
function base():FocusTopicAuthorityBackfillInput {
  return {
    organizations:[{id:"org",status:"active"} as any],
    users:[
      {id:"a",accountType:"enterprise",orgId:"org",status:"active",emailVerifiedAt:NOW} as any,
      {id:"b",accountType:"enterprise",orgId:"org",status:"active",emailVerifiedAt:NOW} as any,
    ],
    topics:[{id:"topic",orgId:"org",status:"active"} as any],
    contentItems:[],scenarioAttachments:[],customScenarios:[],packAttachments:[],trainingPacks:[],
    applicableStandardScenarioIdsByOrg:{org:["s3","s2","s1"]},legacyVisibility:[],capturedAt:NOW,
  };
}

test("backfill creates content, org scenario, and deterministic selected/all standard relations", () => {
  const input=base();
  input.contentItems=[{id:"00000000-0000-4000-8000-000000000001",orgId:"org",focusTopicId:"topic"} as any];
  input.customScenarios=[{id:"custom",orgId:"org"} as any];
  input.scenarioAttachments=[{id:"legacy",orgId:"org",trainingId:"topic",scenarioId:"custom",createdAt:NOW} as any];
  input.trainingPacks=[
    {id:"selected",organizationId:"org",active:true,requiredBehavioralTriggers:["scenario:s3"]} as any,
    {id:"all",organizationId:"org",active:true,requiredBehavioralTriggers:["scenario:*"]} as any,
  ];
  input.packAttachments=[
    {id:"pa1",orgId:"org",trainingId:"topic",trainingPackId:"selected",createdAt:NOW} as any,
    {id:"pa2",orgId:"org",trainingId:"topic",trainingPackId:"all",createdAt:NOW} as any,
  ];
  const plan=buildFocusTopicAuthorityBackfillPlan(input);
  assert.deepEqual(plan.contentAttachments.map((row)=>row.topicId),["topic"]);
  assert.deepEqual(plan.scenarioAttachments.map((row)=>[row.scenarioKind,row.scenarioId]).sort(),[["org","custom"],["standard","s1"],["standard","s2"],["standard","s3"]]);
  assert.equal(plan.scenarioAttachments.every((row)=>row.id===buildFocusTopicAuthorityBackfillPlan(input).scenarioAttachments.find((again)=>again.scenarioId===row.scenarioId)?.id),true);
});

test("visibility fitting uses organization only for all eligible verified members and otherwise exact individuals", () => {
  const all=base();
  all.legacyVisibility=["a","b"].map((userId)=>({orgId:"org",userId,topicId:"topic",standardScenarioIds:[],orgScenarioIds:[],contentIds:["c"]}));
  assert.deepEqual(buildFocusTopicAuthorityBackfillPlan(all).assignments.map((row)=>[row.audience,row.subjectUserId,row.grantsManagement]),[["organization",null,false]]);
  const partial=base(); partial.legacyVisibility=[{orgId:"org",userId:"b",topicId:"topic",standardScenarioIds:[],orgScenarioIds:[],contentIds:["c"]}];
  assert.deepEqual(buildFocusTopicAuthorityBackfillPlan(partial).assignments.map((row)=>[row.audience,row.subjectUserId,row.grantsManagement]),[["individual","b",false]]);
});

test("backfill reports dangling and cross-org relations instead of repairing them", () => {
  const input=base();
  input.topics=[...input.topics,{id:"foreign",orgId:"other",status:"active"} as any];
  input.contentItems=[
    {id:"00000000-0000-4000-8000-000000000001",orgId:"org",focusTopicId:"missing"} as any,
    {id:"00000000-0000-4000-8000-000000000002",orgId:"org",focusTopicId:"foreign"} as any,
  ];
  input.scenarioAttachments=[{id:"x",orgId:"org",trainingId:"topic",scenarioId:"missing",createdAt:NOW} as any];
  const plan=buildFocusTopicAuthorityBackfillPlan(input);
  assert.deepEqual(plan.issues.map((row)=>row.code).sort(),["cross_org_topic","missing_scenario","missing_topic"]);
  assert.equal(plan.contentAttachments.length,0);
});

test("requiredScenario subset broadening is explicit with actors and exact scenario sets", () => {
  const input=base(); input.trainingPacks=[{id:"pack",organizationId:"org",active:true,requiredBehavioralTriggers:["scenario:s1","scenario:s2"]} as any];
  input.packAttachments=[{id:"pa",orgId:"org",trainingId:"topic",trainingPackId:"pack",createdAt:NOW} as any];
  input.legacyVisibility=[{orgId:"org",userId:"a",topicId:"topic",standardScenarioIds:["s1"],orgScenarioIds:[],contentIds:[]}];
  const difference=buildFocusTopicAuthorityBackfillPlan(input).requiredScenarioSubsetDifferences[0];
  assert.deepEqual(difference,{orgId:"org",topicId:"topic",userId:"a",legacyStandardScenarioIds:["s1"],futureStandardScenarioIds:["s1","s2"],broadenedScenarioIds:["s2"]});
});
