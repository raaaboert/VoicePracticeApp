import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCTION_WRITE_CONFIRMATION } from "../src/productionSafety.js";
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

test("validation and sign-off are distinct explicit writes with production and environment safeguards", () => {
  for (const action of ["--apply", "--validate", "--sign-off"]) {
    const args = action === "--apply" ? [action] : [action, "ftbr_run", "--by", "Rob"];
    const options = parseFocusTopicBackfillCliOptions([...args, "--target", "production"]);
    assert.throws(() => assertFocusTopicBackfillTargetSafety({ options, databaseUrl: "postgres://host/peritio_db_prod" }), /confirm-production/);
    options.confirmProduction = PRODUCTION_WRITE_CONFIRMATION;
    assert.equal(assertFocusTopicBackfillTargetSafety({ options, databaseUrl: "postgres://host/peritio_db_prod" }), "production");
    assert.throws(() => assertFocusTopicBackfillTargetSafety({ options, databaseUrl: "postgres://127.0.0.1/local_test" }), /target mismatch/);
    const staged = { ...options, target: "staging" as const };
    assert.throws(() => assertFocusTopicBackfillTargetSafety({ options: staged, databaseUrl: "postgres://host/unknown" }), /unknown target/);
  }
  for (const args of [["--validate"], ["--sign-off", "run"], ["--validate", "run", "--by", ""],
    ["--apply", "--validate", "run", "--by", "Rob"], ["--acknowledge-empty"],
    ["--validate", "run", "--by", "Rob", "--inventory-file", "untrusted.json"]]) {
    assert.throws(() => parseFocusTopicBackfillCliOptions(args));
  }
  assert.equal(parseFocusTopicBackfillCliOptions(["--sign-off", "run", "--by", "Rob", "--acknowledge-empty"]).acknowledgeEmpty, true);
});
