import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createLocalAuthDatabase } from "../src/storage/authVerificationTestDatabase.js";
import { createFocusTopicAuthorityStore } from "../src/storage/focusTopicAuthorityStore.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = "aa79a9d1fbac6704eb1d0033af81c6342538073d";
const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();

async function cli(url: string, args: string[], script = "backfill-focus-topic-authority") {
  try {
    const result = await execute(process.execPath, ["--import", "tsx", `api/scripts/${script}.ts`, ...args], {
      cwd: root, env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url }, timeout: 30_000, maxBuffer: 2_000_000,
    });
    return { ok: true, body: JSON.parse(result.stdout), error: "" };
  } catch (error) {
    return { ok: false, body: null, error: String((error as { stderr?: string }).stderr ?? error) };
  }
}

for (const nonempty of [false, true]) {
  test(`local PostgreSQL production-baseline upgrade and actual backfill CLI: ${nonempty ? "nonempty" : "empty"} cutover`,
    { skip: !databaseUrl }, async t => {
      const local = await createLocalAuthDatabase(databaseUrl!);
      const authority = createFocusTopicAuthorityStore({ provider: "postgres", databaseUrl: local.url,
        pgPoolMax: 2, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100, queryPool: local.pool });
      const command = (...args: string[]) => cli(local.url, [...args, "--target", "development"]);
      const successful = async (...args: string[]) => {
        const result = await command(...args); assert.equal(result.ok, true, result.error); return result.body;
      };
      const denied = async (args: string[], message: RegExp) => {
        const result = await command(...args); assert.equal(result.ok, false); assert.match(result.error, message);
      };
      try {
        // Begin with the actual frozen production revision's schema, in an isolated
        // local schema. Neither checkout nor any shared database is modified.
        for (const name of ["001_app_state", "002_training_packs", "008_training_content", "009_training_content_storage",
          "010_training_content_categories", "011_training_content_video_processing", "012_training_content_backup", "013_training_content_scenario_links"]) {
          const { stdout } = await execute("git", ["show", `${baseline}:api/sql/${name}.sql`], { cwd: root });
          await local.pool.query(stdout);
        }
        await local.migrate(); // Explicit required 024; never apply dormant 025.
        const packMigration = await cli(local.url, ["--apply", "--target", "development"], "migrate-training-pack-schema");
        assert.equal(packMigration.ok, true, packMigration.error);
        const now = new Date().toISOString();
        const state = { orgs: [{ id: "org", status: "active", activeIndustries: ["sales"], divisionsEnabled: false,
          customScenarios: nonempty ? [{ id: "scenario", orgId: "org", segmentId: "role", enabled: true,
            applicableIndustryIds: ["sales"], createdAt: now }] : [] }],
          users: [{ id: "learner", orgId: "org", accountType: "enterprise", orgRole: "user", status: "active", emailVerifiedAt: now }],
          config: { industries: [{ id: "sales", enabled: true }], segments: [{ id: "role", enabled: true, scenarios: [] }],
            roleIndustries: [{ roleId: "role", industryId: "sales", active: true }] },
          orgTrainings: nonempty ? [{ id: "topic", orgId: "org", status: "active", createdAt: now }] : [],
          orgTrainingScenarioAttachments: nonempty ? [{ orgId: "org", trainingId: "topic", scenarioId: "scenario", createdAt: now }] : [],
          orgTrainingPackAttachments: [], trainingPackAssignments: [], orgDivisions: [], orgStandardScenarioDivisionAssignments: [] };
        await local.pool.query("INSERT INTO app_state (id,state_json) VALUES ('primary',$1::jsonb)", [JSON.stringify(state)]);
        const plan = await successful();
        assert.equal(plan.mode, "plan"); assert.equal(plan.plan.summary.assignmentCount, nonempty ? 1 : 0);
        assert.equal((await local.pool.query("SELECT to_regclass('focus_topic_backfill_runs') AS table_name")).rows[0].table_name, null,
          "PLAN remains read-only, including no authority DDL");
        const applied = await successful("--apply");
        const runId = applied.run.id;
        const stored = async () => (await local.pool.query("SELECT * FROM focus_topic_backfill_runs WHERE id=$1", [runId])).rows[0];

        await t.test("unsigned APPLY, sign-off before validation, invalid ID and wrong environment are denied", async () => {
          await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
          await denied(["--sign-off", runId, "--by", "Owner"], /validation is required/);
          await denied(["--validate", "not-a-run", "--by", "Validator"], /Backfill run was not found/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{targetEnvironment}','\"staging\"') WHERE id=$1", [runId]);
          await denied(["--validate", runId, "--by", "Validator"], /environment\/database mismatch/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{targetEnvironment}','\"development\"') WHERE id=$1", [runId]);
          assert.equal((await stored()).validated_at, null);
        });

        await t.test("issue-bearing/failed validation cannot become success without explicit re-APPLY; failure history survives", async () => {
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{issueCount}','1') WHERE id=$1", [runId]);
          await denied(["--validate", runId, "--by", "Validator"], /failed, incomplete, issue-bearing or stale/);
          assert.equal((await stored()).result_summary.validation.status, "failed");
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{issueCount}','0') WHERE id=$1", [runId]);
          await denied(["--validate", runId, "--by", "Validator"], /previously failed/);
          await denied(["--sign-off", runId, "--by", "Owner"], /previously failed/);
          assert.equal((await successful("--apply")).run.id, runId);
          assert.equal((await stored()).result_summary.priorValidationFailures.length, 1);
        });

        if (nonempty) await t.test("incomplete applied rows fail validation even when summary counts claim success", async () => {
          await local.pool.query("DELETE FROM focus_topic_assignments");
          await denied(["--validate", runId, "--by", "Validator"], /rows are incomplete/);
          await successful("--apply"); // Recreates the missing row and retains failed evidence.
          assert.equal((await stored()).result_summary.priorValidationFailures.length, 2);
        });

        await t.test("successful validation is explicit and repeatable; missing sign-off still blocks startup", async () => {
          const validated = (await successful("--validate", runId, "--by", "Validator")).run;
          assert.equal(validated.resultSummary.validation.status, "passed");
          assert.equal(validated.validatedBy, "Validator"); assert.ok(validated.validatedAt);
          const repeated = (await successful("--validate", runId, "--by", "Other operator")).run;
          assert.equal(repeated.validatedAt, validated.validatedAt); assert.equal(repeated.validatedBy, "Validator");
          await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
        });

        await t.test("explicit sign-off enables repeated startup; empty results require recorded acknowledgment", async () => {
          if (!nonempty) await denied(["--sign-off", runId, "--by", "Owner"], /--acknowledge-empty/);
          const signed = (await successful("--sign-off", runId, "--by", "Owner", ...(!nonempty ? ["--acknowledge-empty"] : []))).run;
          assert.equal(signed.signedOffBy, "Owner"); assert.ok(signed.signedOffAt);
          const repeated = (await successful("--sign-off", runId, "--by", "Other operator")).run;
          assert.equal(repeated.signedOffAt, signed.signedOffAt); assert.equal(repeated.signedOffBy, "Owner");
          assert.equal((await successful("--apply")).run.signedOffAt, signed.signedOffAt, "repeat APPLY never rewrites successful approval");
          await authority.assertAssignmentsReady();
          const restart = createFocusTopicAuthorityStore({ provider: "postgres", databaseUrl: local.url,
            pgPoolMax: 2, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100, queryPool: local.pool });
          await restart.initialize(); await restart.assertAssignmentsReady();
          await local.pool.query("UPDATE focus_topic_backfill_runs SET validated_at=NULL,validated_by=NULL,signed_off_at=NULL,signed_off_by=NULL WHERE id=$1", [runId]);
          await assert.rejects(restart.assertAssignmentsReady(), /signed-off backfill APPLY/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET validated_at=$2,validated_by=$3,signed_off_at=$4,signed_off_by=$5 WHERE id=$1",
            [runId, signed.validatedAt, signed.validatedBy, signed.signedOffAt, signed.signedOffBy]);
          if (!nonempty) {
            const original = (await stored()).result_summary;
            await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=result_summary-'emptyAcknowledgment' WHERE id=$1", [runId]);
            await assert.rejects(restart.assertAssignmentsReady(), /signed-off backfill APPLY/);
            await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=$2 WHERE id=$1", [runId, original]);
          }
        });

        await t.test("stale source inventory, corrupt evidence and database binding fail closed", async () => {
          await local.pool.query("UPDATE app_state SET state_json=jsonb_set(state_json,'{users,0,status}','\"inactive\"') WHERE id='primary'");
          await denied(["--sign-off", runId, "--by", "Owner"], /failed, incomplete, issue-bearing or stale/);
          await local.pool.query("UPDATE app_state SET state_json=$1 WHERE id='primary'", [state]);
          const original = (await stored()).result_summary;
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=result_summary-'validation' WHERE id=$1", [runId]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale|signed-off backfill APPLY/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=$2 WHERE id=$1", [runId, original]);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{validation,rowsFingerprint}',$2::jsonb) WHERE id=$1", [runId, JSON.stringify("0".repeat(64))]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set($2::jsonb,'{databaseIdentity}','\"other-database\"') WHERE id=$1", [runId, original]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/);
          await denied(["--sign-off", runId, "--by", "Owner"], /environment\/database mismatch/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=$2 WHERE id=$1", [runId, original]);
          await authority.assertAssignmentsReady();
          if (nonempty) {
            await local.pool.query("UPDATE focus_topic_assignments SET topic_id='unrelated'");
            await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/,
              "equal row counts cannot mask changed baseline identities");
            await local.pool.query("UPDATE focus_topic_assignments SET topic_id='topic',revoked_at=NOW(),revoked_by='owner'");
            await authority.assertAssignmentsReady(); // Legitimate later revocation keeps its history.
            await local.pool.query("UPDATE focus_topic_assignments SET revoked_at=NULL,revoked_by=NULL");
          }
        });

        if (nonempty) await t.test("a falsely empty APPLY cannot validate against actual legacy assignments", async () => {
          const temp = await mkdtemp(path.join(tmpdir(), "peritio-r1-"));
          try {
            const inventoryPath = path.join(temp, "empty.json");
            const inventory = { organizations: [], users: [], topics: [], contentItems: [], scenarioAttachments: [],
              customScenarios: [], packAttachments: [], trainingPacks: [], applicableStandardScenarioIdsByOrg: {}, legacyVisibility: [], capturedAt: new Date().toISOString() };
            await writeFile(inventoryPath, JSON.stringify(inventory));
            const falseRun = (await successful("--apply", "--inventory-file", inventoryPath)).run;
            await denied(["--validate", falseRun.id, "--by", "Validator"], /failed, incomplete, issue-bearing or stale/);
            await denied(["--sign-off", falseRun.id, "--by", "Owner", "--acknowledge-empty"], /previously failed/);
            await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
            const restored = (await successful("--apply")).run;
            assert.equal(restored.id, runId);
            assert.equal(restored.signedOffAt, null, "returning to an older inventory requires fresh approval");
            assert.equal(restored.resultSummary.priorSignOffs.length, 1);
            await successful("--validate", runId, "--by", "Validator");
            await successful("--sign-off", runId, "--by", "Owner");
            await authority.assertAssignmentsReady();
          } finally { await rm(temp, { recursive: true, force: true }); }
        });
      } finally { await local.close(); }
    });
}
