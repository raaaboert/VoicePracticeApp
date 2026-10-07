import assert from "node:assert/strict";
import test from "node:test";
import { assertFocusTopicBackfillTargetSafety, executeFocusTopicBackfillMode, parseFocusTopicBackfillCliOptions } from "./backfill-focus-topic-authority.js";

test("Focus Topic backfill defaults to read-only plan and requires explicit production confirmation for apply",()=>{
  const plan=parseFocusTopicBackfillCliOptions(["--target","staging"]); assert.equal(plan.apply,false);
  assert.equal(assertFocusTopicBackfillTargetSafety({options:plan,databaseUrl:"postgres://host/voicepractice_db"}),"staging");
  const apply=parseFocusTopicBackfillCliOptions(["--apply","--target","production"]);
  assert.throws(()=>assertFocusTopicBackfillTargetSafety({options:apply,databaseUrl:"postgres://host/peritio-db-prod"}),/confirm-production/i);
});

test("plan mode performs no authority-store write",async()=>{
  let writes=0;
  const result=await executeFocusTopicBackfillMode({apply:false,store:{async applyBackfillPlan(){writes+=1; throw new Error("must not run");}},plan:{} as any,validTopicKeys:new Set()});
  assert.equal(result,null); assert.equal(writes,0);
});
