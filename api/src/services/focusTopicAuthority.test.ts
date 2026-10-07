import assert from "node:assert/strict";
import test from "node:test";

import type { EnterpriseOrg, OrgTrainingRecord, UserProfile } from "@voicepractice/shared";

import {
  canFutureActorManageFocusTopic,
  canFutureLearnerAccessFocusTopic,
  type FocusTopicAssignment,
} from "./focusTopicAuthority.js";

const NOW = "2026-10-06T12:00:00.000Z";
const org = { id: "org", status: "active" } as EnterpriseOrg;
const topic = { id: "topic", orgId: "org", status: "active" } as OrgTrainingRecord;

function user(id:string, overrides:Partial<UserProfile>={}):UserProfile {
  return { id,email:`${id}@example.test`,employeeId:null,emailVerifiedAt:NOW,accountType:"enterprise",tier:"enterprise",status:"active",orgId:"org",orgRole:"user",timezone:"UTC",pendingTimezone:null,pendingTimezoneEffectiveAt:null,planAnchorAt:NOW,manualBonusSeconds:0,dailySecondsCapOverride:null,allowDailyOverageThisCycle:false,dailyOverageExpiresAt:null,createdAt:NOW,updatedAt:NOW,...overrides };
}
function row(audience:FocusTopicAssignment["audience"],subjectUserId:string|null=null,overrides:Partial<FocusTopicAssignment>={}):FocusTopicAssignment {
  return {id:`row_${audience}_${subjectUserId??"broad"}`,orgId:"org",topicId:"topic",audience,subjectUserId,grantsManagement:false,createdBy:"admin",createdAt:NOW,revokedBy:null,revokedAt:null,...overrides};
}

test("future learner audiences resolve without division or Training Pack inputs", () => {
  const manager=user("manager"); const report=user("report",{managerUserId:"manager"});
  const admin=user("admin",{orgRole:"org_admin"}); const userAdmin=user("user_admin",{orgRole:"user_admin"}); const regular=user("regular");
  const users=[manager,report,admin,userAdmin,regular];
  const allowed=(candidate:UserProfile,assignment:FocusTopicAssignment)=>canFutureLearnerAccessFocusTopic({user:candidate,users,organization:org,topic,assignments:[assignment]});
  assert.equal(allowed(regular,row("organization")),true);
  assert.equal(allowed(admin,row("managers_and_admins")),true);
  assert.equal(allowed(userAdmin,row("managers_and_admins")),true);
  assert.equal(allowed(manager,row("managers_and_admins")),true);
  assert.equal(allowed(regular,row("managers_and_admins")),false);
  assert.equal(allowed(manager,row("manager_only","manager")),true);
  assert.equal(allowed(report,row("manager_only","manager")),false);
  assert.equal(allowed(manager,row("manager_with_team","manager")),true);
  assert.equal(allowed(report,row("manager_with_team","manager")),true);
  assert.equal(canFutureLearnerAccessFocusTopic({user:report,users:[report,user("manager",{status:"disabled"})],organization:org,topic,assignments:[row("manager_with_team","manager")]}),false);
  assert.equal(allowed(regular,row("individual","regular")),true);
});

test("future learner authority fails closed for inactive, unverified, cross-org, inactive org/topic, and revoked rows", () => {
  const base=user("learner"); const assignment=row("organization");
  const evaluate=(candidate:UserProfile,organization=org,selectedTopic=topic,selectedRow=assignment)=>canFutureLearnerAccessFocusTopic({user:candidate,users:[candidate],organization,topic:selectedTopic,assignments:[selectedRow]});
  assert.equal(evaluate(user("inactive",{status:"disabled"})),false);
  assert.equal(evaluate(user("unverified",{emailVerifiedAt:null})),false);
  assert.equal(evaluate(user("moved",{orgId:"other"})),false);
  assert.equal(evaluate(base,{...org,status:"disabled"}),false);
  assert.equal(evaluate(base,org,{...topic,status:"archived"}),false);
  assert.equal(evaluate(base,org,topic,{...assignment,revokedAt:NOW,revokedBy:"admin"}),false);
});

test("future management requires explicit targeted grants plus current role/manager state and product switch", () => {
  const report=user("report",{managerUserId:"manager"});
  const manager=user("manager"); const userAdmin=user("user_admin",{orgRole:"user_admin"}); const admin=user("admin",{orgRole:"org_admin"});
  const users=[manager,report,userAdmin,admin];
  const settings={allowUserAdminFocusTopicManagement:true,allowManagerFocusTopicManagement:true};
  const evaluate=(actor:UserProfile,assignments:FocusTopicAssignment[],override:Partial<typeof settings>={})=>canFutureActorManageFocusTopic({actor,users,organization:org,topic,assignments,productSettings:{...settings,...override}});
  assert.equal(evaluate(admin,[]),true);
  assert.equal(evaluate(userAdmin,[row("organization",null,{grantsManagement:false})]),false);
  assert.equal(evaluate(userAdmin,[row("individual","user_admin")]),false);
  assert.equal(evaluate(userAdmin,[row("individual","user_admin",{grantsManagement:true})]),true);
  assert.equal(evaluate(userAdmin,[row("individual","user_admin",{grantsManagement:true})],{allowUserAdminFocusTopicManagement:false}),false);
  assert.equal(evaluate(manager,[row("manager_with_team","manager",{grantsManagement:true})]),true);
  assert.equal(canFutureActorManageFocusTopic({actor:manager,users:[manager],organization:org,topic,assignments:[row("manager_only","manager",{grantsManagement:true})],productSettings:settings}),false);
  assert.equal(evaluate(report,[row("manager_with_team","manager",{grantsManagement:true})]),false);
  assert.equal(evaluate(manager,[row("manager_only","manager",{grantsManagement:true,orgId:"other"})]),false);
  assert.equal(evaluate(manager,[row("manager_only","manager",{grantsManagement:true,revokedAt:NOW,revokedBy:"admin"})]),false);
});
