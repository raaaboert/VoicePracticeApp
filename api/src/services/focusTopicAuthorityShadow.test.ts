import assert from "node:assert/strict";
import test from "node:test";
import { compareFocusTopicAuthorityProjections, type FocusTopicProjection } from "./focusTopicAuthorityShadow.js";

function row(overrides:Partial<FocusTopicProjection>={}):FocusTopicProjection{return{orgId:"org",userId:"user",topicId:"topic",topicOrgId:"org",standardScenarioIds:[],orgScenarioIds:[],contentIds:[],...overrides};}
test("shadow comparator is clean for identical and empty Topic projections",()=>{
  const empty=row(); assert.deepEqual(compareFocusTopicAuthorityProjections({legacy:[empty],future:[empty]}),{clean:true,blocking:[],expectedSignoff:[]});
});
test("shadow comparator classifies visibility and cross-org failures as blocking",()=>{
  assert.equal(compareFocusTopicAuthorityProjections({legacy:[row()],future:[]}).blocking[0]?.kind,"visibility_narrowing");
  assert.equal(compareFocusTopicAuthorityProjections({legacy:[],future:[row()]}).blocking[0]?.kind,"visibility_widening");
  assert.equal(compareFocusTopicAuthorityProjections({legacy:[row()],future:[row({topicOrgId:"other"})]}).blocking[0]?.kind,"cross_org_exposure");
});
test("shadow comparator reports intended standard broadening and content changes for signoff",()=>{
  const result=compareFocusTopicAuthorityProjections({legacy:[row({standardScenarioIds:["a"],contentIds:["old"]})],future:[row({standardScenarioIds:["a","b"],contentIds:["new"]})]});
  assert.equal(result.clean,true); assert.deepEqual(result.expectedSignoff.map((entry)=>entry.kind).sort(),["content_projection_changed","standard_children_broadened"]);
});
