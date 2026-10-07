import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFocusTopicAuthorityStore } from "./focusTopicAuthorityStore.js";

test("authority schema enforces audience subjects, management scope, historical uniqueness, and content organization FK",async()=>{
  const sql=await readFile(new URL("../../sql/015_focus_topic_authority.sql",import.meta.url),"utf8");
  assert.match(sql,/focus_topic_assignments_subject_check/); assert.match(sql,/focus_topic_assignments_management_check/);
  assert.match(sql,/WHERE revoked_at IS NULL AND audience IN/); assert.match(sql,/focus_topic_scenario_attachments_active_uidx/);
  assert.match(sql,/FOREIGN KEY \(org_id, content_id\)[\s\S]*REFERENCES org_content_items \(org_id, id\)[\s\S]*ON DELETE RESTRICT/);
  assert.match(sql,/focus_topic_backfill_runs_signoff_check/); assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS focus_topics/);
  assert.doesNotMatch(sql,/ON DELETE CASCADE/);
});

test("store initialization applies additive schema and topic reference lookup covers all relation history",async()=>{
  const queries:string[]=[];
  const store=createFocusTopicAuthorityStore({provider:"postgres",databaseUrl:"postgres://test",pgPoolMax:1,pgConnectTimeoutMs:1,pgIdleTimeoutMs:1,queryPool:{
    async query(text:string){queries.push(text); return /AS referenced/.test(text)?{rows:[{referenced:true}],rowCount:1}:{rows:[],rowCount:0};},
    async connect(){throw new Error("unused");},
  } as any});
  await store.initialize(); assert.equal(await store.hasTopicReferences("org","topic"),true);
  assert.match(queries[0]!,/CREATE TABLE IF NOT EXISTS focus_topic_assignments/);
  assert.match(queries.at(-1)!,/org_content_topic_attachments/);
});

test("backfill apply is transactional and idempotent while validation and signoff remain explicit",async()=>{
  const queries:string[]=[]; const timestamp="2026-10-06T12:00:00.000Z";
  const run={id:"ftbr_fingerprint",run_version:"v1",mode:"apply",schema_generation:"g1",input_fingerprint:"fingerprint",result_summary:{assignmentCount:1},executed_at:timestamp,validated_at:null,validated_by:null,signed_off_at:null,signed_off_by:null};
  const client={
    async query(text:string){queries.push(text); if(/RETURNING \*/.test(text))return{rows:[run],rowCount:1}; return{rows:[],rowCount:0};},
    release(){},
  };
  const store=createFocusTopicAuthorityStore({provider:"postgres",databaseUrl:"postgres://test",pgPoolMax:1,pgConnectTimeoutMs:1,pgIdleTimeoutMs:1,queryPool:{
    async query(text:string){queries.push(text); return{rows:[],rowCount:0};}, async connect(){return client;},
  } as any});
  const plan={version:"v1",schemaGeneration:"g1",capturedAt:timestamp,inputFingerprint:"fingerprint",assignments:[{id:"a",orgId:"org",topicId:"topic",audience:"organization" as const,subjectUserId:null,grantsManagement:false,createdBy:"backfill",createdAt:timestamp,revokedBy:null,revokedAt:null}],scenarioAttachments:[],contentAttachments:[],issues:[],requiredScenarioSubsetDifferences:[],summary:{assignmentCount:1,scenarioAttachmentCount:0,contentAttachmentCount:0,issueCount:0,requiredScenarioSubsetDifferenceCount:0}};
  const validTopicKeys=new Set(["org:topic"]);
  const first=await store.applyBackfillPlan({plan,validTopicKeys}); const second=await store.applyBackfillPlan({plan,validTopicKeys});
  assert.equal(first.signedOffAt,null); assert.equal(second.id,first.id);
  assert.equal(queries.filter((query)=>query==="BEGIN").length,2);
  assert.equal(queries.filter((query)=>query==="COMMIT").length,2);
  assert.equal(queries.some((query)=>/ON CONFLICT \(id\) DO NOTHING/.test(query)),true);
  assert.equal(queries.some((query)=>/ON CONFLICT \(run_version, schema_generation, input_fingerprint\)/.test(query)),true);
  await assert.rejects(store.markBackfillSignedOff({runId:first.id,signedOffBy:"reviewer"}),/Validated backfill run was not found/);
  assert.equal(queries.some((query)=>/validated_at IS NOT NULL/.test(query)),true);
});
