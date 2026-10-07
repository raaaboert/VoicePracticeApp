import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createFocusTopicAuthorityStore } from "./focusTopicAuthorityStore.js";

const databaseUrl=process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim()??"";

test("real PostgreSQL enforces Focus Topic authority history, constraints, and idempotent backfill",{skip:!databaseUrl},async()=>{
  const parsed=new URL(databaseUrl); const databaseName=decodeURIComponent(parsed.pathname).replace(/^\/+/,"").toLowerCase();
  assert.match(databaseName,/(test|integration|throwaway)/); assert.doesNotMatch(databaseUrl.toLowerCase(),/peritio[-_]db[-_]prod/);
  const setup=new Pool({connectionString:databaseUrl,max:1}); const schema=`focus_topic_authority_${randomBytes(8).toString("hex")}`; const quoted=`"${schema}"`; let scoped:Pool|null=null;
  try{
    await setup.query(`CREATE SCHEMA ${quoted}`); parsed.searchParams.set("options",`-c search_path=${schema}`);
    scoped=new Pool({connectionString:parsed.toString(),max:2});
    await scoped.query(`CREATE TABLE org_content_items (id UUID NOT NULL, org_id TEXT NOT NULL, PRIMARY KEY(id), UNIQUE(org_id,id))`);
    const store=createFocusTopicAuthorityStore({provider:"postgres",databaseUrl:parsed.toString(),pgPoolMax:2,pgConnectTimeoutMs:15000,pgIdleTimeoutMs:10000,queryPool:scoped}); await store.initialize();
    await assert.rejects(scoped.query(`INSERT INTO focus_topic_assignments VALUES ('b','org','topic','organization','user',false,'actor',NOW(),NULL,NULL)`));
    await assert.rejects(scoped.query(`INSERT INTO focus_topic_assignments VALUES ('m','org','topic','organization',NULL,true,'actor',NOW(),NULL,NULL)`));
    await scoped.query(`INSERT INTO focus_topic_assignments VALUES ('a1','org','topic','individual','user',false,'actor',NOW(),NULL,NULL)`);
    await assert.rejects(scoped.query(`INSERT INTO focus_topic_assignments VALUES ('a2','org','topic','individual','user',false,'actor',NOW(),NULL,NULL)`));
    await scoped.query(`UPDATE focus_topic_assignments SET revoked_by='actor',revoked_at=NOW() WHERE id='a1'`);
    await scoped.query(`INSERT INTO focus_topic_assignments VALUES ('a2','org','topic','individual','user',false,'actor',NOW(),NULL,NULL)`);
    assert.equal((await scoped.query(`SELECT 1 FROM focus_topic_assignments WHERE subject_user_id='user'`)).rowCount,2);
  }finally{
    if(scoped)await scoped.end(); await setup.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`); await setup.end();
  }
});
