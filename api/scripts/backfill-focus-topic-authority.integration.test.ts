import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
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

// Run the real API startup/readiness path in a fresh process per restart. IPC
// controls only probe refresh/teardown; no provider requests or production services.
async function startAssignmentsApi(url: string) {
  const program = `
    const api = await import('./api/src/index.ts');
    const listen = api.app.listen.bind(api.app); let server;
    api.app.listen = (...args) => { server = listen(0, '127.0.0.1', args[1]); return server; };
    process.on('message', async message => {
      if (message === 'refresh') {
        for (let i=0;i<3;i++) await api.refreshDatabaseReadinessForTest();
        process.send({ refreshed: true });
      } else if (message === 'close') server.close(() => process.exit(0));
    });
    await api.startApiServer();
    process.send({ port: server.address().port });
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
    cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env,
      NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: url,
      FOCUS_TOPIC_AUTHORITY: "assignments", PORT: "4100", PG_IDLE_TIMEOUT_MS: "100", AI_SPEND_LEDGER_MODE: "off",
      ADMIN_BOOTSTRAP_PASSWORD: "local-cutover-test-password", ADMIN_TOKEN_SECRET: "local-cutover-admin-token-secret-for-readiness-test",
      WEB_AUTH_TOKEN_SECRET: "local-cutover-web-token-secret-for-readiness-test", WEB_AUTH_CODE_SECRET: "local-cutover-web-code-secret-for-readiness-test",
      MOBILE_TOKEN_SECRET: "local-cutover-mobile-token-secret-for-readiness-test", SUPPORT_TRANSCRIPT_SECRET: "local-cutover-support-secret-for-readiness-test",
      AUTH_CODE_DELIVERY_PROVIDER: "log_only", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", OPENAI_API_KEY: "",
      TRAINING_CONTENT_STORAGE_PROVIDER: "disabled",
    },
  });
  let diagnostics = "";
  child.stdout!.on("data", data => { diagnostics = (diagnostics + data).slice(-6000); });
  child.stderr!.on("data", data => { diagnostics = (diagnostics + data).slice(-6000); });
  const message = () => Promise.race([
    once(child, "message", { signal: AbortSignal.timeout(30_000) }).then(([value]) => value as { port?: number; refreshed?: boolean }),
    once(child, "exit", { signal: AbortSignal.timeout(30_000) }).then(([code]) => { throw new Error(`Local API exited (${code}): ${diagnostics}`); }),
  ]);
  try {
    const started = await message();
    assert.ok(started.port, diagnostics);
    return {
      ready: () => fetch(`http://127.0.0.1:${started.port}/ready`),
      refresh: async () => { const reply = message(); child.send("refresh"); assert.equal((await reply).refreshed, true); },
      close: async () => { const exited = once(child, "exit"); child.send("close"); await exited; },
    };
  } catch (error) { child.kill(); throw error; }
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
        if (nonempty) {
          await local.pool.query(`INSERT INTO org_content_categories
            (id,org_id,name,created_by_actor_id,updated_by_actor_id)
            VALUES ('00000000-0000-4000-8000-000000000001','org','Local resources','admin','admin')`);
          await local.pool.query(`INSERT INTO org_content_items
            (id,org_id,category_id,title,content_type,focus_topic_id,created_by_actor_id,updated_by_actor_id)
            VALUES ('00000000-0000-4000-8000-000000000002','org','00000000-0000-4000-8000-000000000001',
              'Draft resource','native','topic','admin','admin')`);
        }
        const plan = await successful();
        assert.equal(plan.mode, "plan"); assert.equal(plan.plan.summary.assignmentCount, nonempty ? 1 : 0);
        assert.equal((await local.pool.query("SELECT to_regclass('focus_topic_backfill_runs') AS table_name")).rows[0].table_name, null,
          "PLAN remains read-only, including no authority DDL");
        const applied = await successful("--apply");
        const runId = applied.run.id;
        const stored = async () => (await local.pool.query("SELECT *, xmin::text AS row_version FROM focus_topic_backfill_runs WHERE id=$1", [runId])).rows[0];

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
          await denied(["--validate", runId, "--by", "Validator"], /missingActiveIds/);
          await successful("--apply"); // Recreates the missing row and retains failed evidence.
          assert.equal((await stored()).result_summary.priorValidationFailures.length, 2);
        });

        if (nonempty) await t.test("exact backfill validation excludes legitimate same-org and cross-org manual/direct rows", async () => {
          await local.pool.query(`INSERT INTO focus_topic_assignments
            (id,org_id,topic_id,audience,subject_user_id,grants_management,created_by,created_at)
            VALUES ('manual_learner','org','topic','individual','manual_user',FALSE,'org_admin',NOW()),
              ('foreign_manual','org_B','topic','individual','other_user',FALSE,'other_org_admin',NOW())`);
          await local.pool.query(`INSERT INTO focus_topic_scenario_attachments
            (id,org_id,topic_id,scenario_kind,scenario_id,attached_by,attached_at)
            VALUES ('manual_scenario','org','topic','org','manual_scenario','org_admin',NOW()),
              ('foreign_manual_scenario','org_B','topic','org','other_scenario','other_org_admin',NOW())`);
          await local.pool.query(`INSERT INTO org_content_topic_attachments
            (id,org_id,content_id,topic_id,attached_by,attached_at)
            VALUES ('manual_content','org','00000000-0000-4000-8000-000000000002','manual_topic','org_admin',NOW())`);
        });

        await t.test("successful validation is explicit and repeatable; missing sign-off still blocks startup", async () => {
          const validated = (await successful("--validate", runId, "--by", "Validator")).run;
          assert.equal(validated.resultSummary.validation.status, "passed");
          assert.equal(validated.validatedBy, "Validator"); assert.ok(validated.validatedAt);
          const repeated = (await successful("--validate", runId, "--by", "Other operator")).run;
          assert.equal(repeated.validatedAt, validated.validatedAt); assert.equal(repeated.validatedBy, "Validator");
          await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
        });

        if (nonempty) await t.test("sign-off rechecks the complete active backfill set, including other organizations", async () => {
          const validated = await stored();
          await local.pool.query(`INSERT INTO focus_topic_assignments
            (id,org_id,topic_id,audience,subject_user_id,grants_management,created_by,created_at)
            VALUES ('unexpected_backfill','org_B','other_topic','individual','other_user',FALSE,'focus-topic-authority-backfill',NOW())`);
          try {
            const refused = await command("--sign-off", runId, "--by", "Owner");
            assert.equal(refused.ok, false);
            assert.match(refused.error, /unexpectedActiveRows.*unexpected_backfill.*org_B/);
            assert.deepEqual(await stored(), validated, "sign-off failure does not alter successful validation evidence");
            assert.equal((await local.pool.query("SELECT revoked_at FROM focus_topic_assignments WHERE id='unexpected_backfill'")).rows[0].revoked_at, null);
          } finally {
            // Test-fixture teardown only. The cutover tool performs no cleanup.
            await local.pool.query("DELETE FROM focus_topic_assignments WHERE id='unexpected_backfill'");
          }
        });

        await t.test("explicit sign-off enables repeated startup; empty results require recorded acknowledgment", async () => {
          if (!nonempty) await denied(["--sign-off", runId, "--by", "Owner"], /--acknowledge-empty/);
          const signed = (await successful("--sign-off", runId, "--by", "Owner", ...(!nonempty ? ["--acknowledge-empty"] : []))).run;
          assert.equal(signed.signedOffBy, "Owner"); assert.ok(signed.signedOffAt);
          const finalized = await stored();
          await denied(["--sign-off", runId, "--by", "Other operator"], /finalized.*must not be revalidated/);
          assert.deepEqual(await stored(), finalized);
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

        await t.test("finalized approval survives source changes; readiness still rejects corrupt evidence and binding", async () => {
          const finalized = await stored();
          await local.pool.query("UPDATE app_state SET state_json=jsonb_set(state_json,'{users,0,status}','\"inactive\"') WHERE id='primary'");
          await denied(["--validate", runId, "--by", "Validator"], /finalized.*must not be revalidated/);
          await denied(["--sign-off", runId, "--by", "Owner"], /finalized.*must not be revalidated/);
          assert.deepEqual(await stored(), finalized);
          await authority.assertAssignmentsReady();
          await local.pool.query("UPDATE app_state SET state_json=$1 WHERE id='primary'", [state]);
          const original = (await stored()).result_summary;
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=result_summary-'validation' WHERE id=$1", [runId]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale|signed-off backfill APPLY/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=$2 WHERE id=$1", [runId, original]);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set(result_summary,'{validation,rowsFingerprint}',$2::jsonb) WHERE id=$1", [runId, JSON.stringify("0".repeat(64))]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=jsonb_set($2::jsonb,'{databaseIdentity}','\"other-database\"') WHERE id=$1", [runId, original]);
          await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/);
          await denied(["--sign-off", runId, "--by", "Owner"], /finalized.*must not be revalidated/);
          await local.pool.query("UPDATE focus_topic_backfill_runs SET result_summary=$2 WHERE id=$1", [runId, original]);
          await authority.assertAssignmentsReady();
          if (nonempty) {
            await local.pool.query("UPDATE focus_topic_assignments SET topic_id='unrelated' WHERE created_by='focus-topic-authority-backfill'");
            await assert.rejects(authority.assertAssignmentsReady(), /inconsistent or stale/,
              "equal row counts cannot mask changed baseline identities");
            await local.pool.query("UPDATE focus_topic_assignments SET topic_id='topic',revoked_at=NOW(),revoked_by='owner' WHERE created_by='focus-topic-authority-backfill'");
            await authority.assertAssignmentsReady(); // Legitimate later revocation keeps its history.
            await local.pool.query("UPDATE focus_topic_assignments SET revoked_at=NULL,revoked_by=NULL WHERE created_by='focus-topic-authority-backfill'");
          }
        });

        if (nonempty) await t.test("finalized CLI approval survives source changes, actual /ready probes and a full assignments API restart", async () => {
          const originalState = (await local.pool.query("SELECT state_json FROM app_state WHERE id='primary'")).rows[0].state_json;
          const finalized = await stored();
          const api = await startAssignmentsApi(local.url);
          try {
            assert.equal((await api.ready()).status, 200);
            await local.pool.query("UPDATE app_state SET state_json=jsonb_set(state_json,'{orgs,0,name}','\"Renamed organization\"') WHERE id='primary'");
            await denied(["--validate", runId, "--by", "Validator"], /finalized.*must not be revalidated/);
            await denied(["--sign-off", runId, "--by", "Owner"], /finalized.*must not be revalidated/);
            assert.deepEqual(await stored(), finalized, "all approval fields, metadata and timestamps remain unchanged");
            await api.refresh();
            assert.equal((await api.ready()).status, 200);
          } finally { await api.close(); }
          const restarted = await startAssignmentsApi(local.url);
          try { assert.equal((await restarted.ready()).status, 200); assert.deepEqual(await stored(), finalized); }
          finally {
            await restarted.close();
            await local.pool.query("UPDATE app_state SET state_json=$1 WHERE id='primary'", [originalState]);
          }
        });

        if (nonempty) await t.test("a newly empty plan cannot validate or sign off stale active prior-backfill rows", async () => {
          const before = await authority.listSnapshot();
          await local.pool.query("UPDATE app_state SET state_json=jsonb_set(state_json,'{orgTrainingScenarioAttachments}','[]') WHERE id='primary'");
          await local.pool.query("UPDATE org_content_items SET focus_topic_id=NULL");
          const emptyPlan = await successful();
          assert.equal(emptyPlan.plan.summary.assignmentCount, 0);
          assert.equal(emptyPlan.plan.summary.scenarioAttachmentCount, 0);
          assert.equal(emptyPlan.plan.summary.contentAttachmentCount, 0);
          const emptyRun = (await successful("--apply")).run;
          const validation = await command("--validate", emptyRun.id, "--by", "Validator");
          assert.equal(validation.ok, false);
          assert.match(validation.error, /unexpectedActiveRows/);
          for (const rows of [before.assignments.filter(row => row.createdBy === "focus-topic-authority-backfill"),
            before.scenarioAttachments.filter(row => row.attachedBy === "focus-topic-authority-backfill"),
            before.contentAttachments.filter(row => row.attachedBy === "focus-topic-authority-backfill")]) {
            assert.ok(rows.length);
            for (const row of rows) assert.ok(validation.error.includes(row.id), "error identifies stale active row " + row.id);
          }
          await denied(["--sign-off", emptyRun.id, "--by", "Owner", "--acknowledge-empty"], /previously failed/);
          await assert.rejects(authority.assertAssignmentsReady(), /signed-off backfill APPLY/);
          assert.deepEqual(await authority.listSnapshot(), before, "the tool never silently removes stale or manual records");
          await local.pool.query("UPDATE app_state SET state_json=$1 WHERE id='primary'", [state]);
          await local.pool.query("UPDATE org_content_items SET focus_topic_id='topic'");
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
