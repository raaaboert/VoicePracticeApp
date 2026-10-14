import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";

import type { OrgTrainingRecord } from "@voicepractice/shared";
import { createDatabaseStorage } from "./storage.js";
import { createFocusTopicAuthorityStore } from "./storage/focusTopicAuthorityStore.js";
import { createOrgModuleEntitlementStore } from "./storage/orgModuleEntitlementStore.js";
import { createUserNotificationStore } from "./storage/userNotificationStore.js";
import { createAuditEventStore } from "./storage/auditEventStore.js";
import { createOrganizationProductSettingsStore } from "./storage/organizationProductSettingsStore.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";
import {
  createTrainingContentAssetStore,
  TrainingContentAssetStoreError,
} from "./storage/trainingContentAssetStore.js";
import { createWebAuthService } from "./services/webAuth.js";
import { assertIndustryCacheParity } from "./industryRuntimeCache.testSupport.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";

function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

async function withMockResponses<T>(text: string, runner: () => Promise<T>, capture?: (request: string) => void): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target === "https://api.openai.com/v1/responses") {
      capture?.(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({
        output_text: text, model: "local-test-model",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try { return await runner(); }
  finally { globalThis.fetch = originalFetch; }
}

async function withMockScenarioGeneration<T>(runner: (calls: { value: number }) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls = { value: 0 };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target === "https://api.openai.com/v1/chat/completions") {
      calls.value += 1;
      return Promise.resolve(new Response(JSON.stringify({
        model: "server-issued-generation-model",
        choices: [{ message: { content: JSON.stringify({
          title: "Generated source-grounded scenario",
          description: "Use the supplied Related Content to prepare the discussion.",
          desiredOutcome: "Agree a concrete next step.",
          aiRole: "A cautious stakeholder",
          scoringCriteria: [
            "Identifies the stakeholder's primary concern.",
            "Connects the proposal to the supplied source material.",
            "Secures agreement on a concrete next step.",
          ],
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try { return await runner(calls); }
  finally { globalThis.fetch = originalFetch; }
}

test("real PostgreSQL assignment-mode catalog, launch, attribution, and revocation",
  { skip: !databaseUrl }, async (t) => {
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()));
    assert.match(parsed.pathname.toLowerCase(), /(test|integration|throwaway)/);
    const setup = new Pool({ connectionString: databaseUrl, max: 1 });
    const schema = `focus_runtime_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    let pool: Pool | null = null;
    let server: Server | null = null;
    try {
      await setup.query(`CREATE SCHEMA ${quotedSchema}`);
      const url = scopedUrl(databaseUrl, schema);
      pool = new Pool({ connectionString: url, max: 3 });
      const moduleEntitlements = createOrgModuleEntitlementStore({ provider: "postgres", databaseUrl: url,
        pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool });
      await moduleEntitlements.initialize();
      const tokenSecret = "focus_runtime_local_mobile_token_secret_2026";
      const token = `local_${randomUUID()}`;
      process.env.NODE_ENV = "test";
      process.env.PERITIO_ENV = "development";
      process.env.STORAGE_PROVIDER = "postgres";
      process.env.DATABASE_URL = url;
      process.env.PG_IDLE_TIMEOUT_MS = "1000";
      process.env.FOCUS_TOPIC_AUTHORITY = "assignments";
      process.env.ADMIN_TOKEN_SECRET = "focus_runtime_local_admin_token_secret_2026";
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "focus_runtime_local_admin_password";
      process.env.WEB_AUTH_TOKEN_SECRET = "focus_runtime_local_web_token_secret_2026";
      process.env.WEB_AUTH_CODE_SECRET = "focus_runtime_local_web_code_secret_2026";
      process.env.MOBILE_TOKEN_SECRET = tokenSecret;
      process.env.SUPPORT_TRANSCRIPT_SECRET = "focus_runtime_local_support_secret_2026";
      process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
      process.env.OPENAI_API_KEY = "local-test-key";
      // Keep budget limits finite so the HTTP budget-refusal regression can seed
      // an exhausted global budget without affecting the rest of this harness.
      process.env.OPENAI_MAX_DAILY_CALLS_PER_USER = "100";
      process.env.OPENAI_MAX_DAILY_CALLS_GLOBAL = "100";
      process.env.OPENAI_MAX_DAILY_TOKENS_PER_USER = "1000000";
      process.env.OPENAI_MAX_DAILY_TOKENS_GLOBAL = "1000000";
      process.env.ENABLE_INTERNAL_DEBUG_ENDPOINTS = "false";
      const imported = await import("./index.js");
      const now = new Date().toISOString();
      const db = imported.createDefaultDatabase();
      imported.ensureDemoEnterpriseData(db, now);
      const sourceOrg = db.orgs.find((candidate) => candidate.status === "active"
        && candidate.activeIndustries.includes("people_management"));
      assert.ok(sourceOrg);
      const sourceUser = db.users.find((candidate) => candidate.orgId === sourceOrg.id && !candidate.isSuperUser);
      assert.ok(sourceUser);
      const org = { ...sourceOrg, id: "org_focus_runtime", name: "Local runtime test organization" };
      const foreignOrg = { ...sourceOrg, id: "org_focus_foreign", name: "Local foreign organization",
        joinCode: "FOCUS-FOREIGN" };
      const user = { ...sourceUser, id: "user_focus_runtime", orgId: org.id,
        email: "learner@focus-runtime.integration.test", divisionId: "division_runtime_a",
        orgRole: "user" as const };
      const scopedMobileToken = `local_${randomUUID()}`;
      org.divisionsEnabled = true;
      db.orgs = [org, foreignOrg];
      const scopedUserAdmin = {
        ...sourceUser,
        id: "user_focus_scoped_admin",
        orgId: org.id,
        email: "scoped-admin@focus-runtime.integration.test",
        firstName: "Scoped",
        lastName: "Admin",
        orgRole: "user_admin" as const,
        emailVerifiedAt: now,
        status: "active" as const,
        dashboardAccessEnabled: false,
        mobileProfileReonboardingRequired: false,
      };
      const orgAdmin = {
        ...sourceUser,
        id: "user_focus_org_admin",
        orgId: org.id,
        email: "org-admin@focus-runtime.integration.test",
        orgRole: "org_admin" as const,
        emailVerifiedAt: now,
        status: "active" as const,
      };
      const foreignPerformanceUser = {
        ...sourceUser,
        id: "user_focus_foreign_performance",
        orgId: foreignOrg.id,
        email: "foreign-performance@focus-runtime.integration.test",
        firstName: "Foreign", lastName: "Learner",
        orgRole: "user" as const,
        emailVerifiedAt: now,
        status: "active" as const,
        mobileProfileReonboardingRequired: false,
      };
      const scopedManager = {
        ...sourceUser,
        id: "user_focus_scoped_manager",
        orgId: org.id,
        email: "scoped-manager@focus-runtime.integration.test",
        orgRole: "user" as const,
        emailVerifiedAt: now,
        status: "active" as const,
        dashboardAccessEnabled: true,
        performanceAccess: "none" as const,
      };
      const secondReport = {
        ...sourceUser,
        id: "user_focus_second_report",
        orgId: org.id,
        email: "second-report@focus-runtime.integration.test",
        orgRole: "user" as const,
        managerUserId: scopedManager.id,
        emailVerifiedAt: now,
        status: "active" as const,
      };
      user.managerUserId = scopedManager.id;
      db.users = [user, secondReport, scopedManager, scopedUserAdmin, orgAdmin, foreignPerformanceUser];
      user.firstName = "Test";
      user.lastName = "Learner";
      user.emailVerifiedAt = now;
      user.status = "active";
      user.mobileProfileReonboardingRequired = false;
      db.mobileAuthTokens.push({ userId: user.id,
        tokenHash: createHmac("sha256", tokenSecret).update(token).digest("hex"),
        createdAt: now, updatedAt: now });
      db.mobileAuthTokens.push({ userId: scopedUserAdmin.id,
        tokenHash: createHmac("sha256", tokenSecret).update(scopedMobileToken).digest("hex"),
        createdAt: now, updatedAt: now });
      const foreignMobileToken = `local_${randomUUID()}`;
      db.mobileAuthTokens.push({ userId: foreignPerformanceUser.id,
        tokenHash: createHmac("sha256", tokenSecret).update(foreignMobileToken).digest("hex"),
        createdAt: now, updatedAt: now });
      const segment = db.config.segments.find((candidate) => candidate.id === "solution_manager");
      const scenario = segment?.scenarios.find((candidate) => candidate.enabled !== false);
      assert.ok(segment && scenario);
      const unattachedScenario = segment.scenarios.find((candidate) =>
        candidate.enabled !== false && candidate.id !== scenario.id);
      assert.ok(unattachedScenario);
      const snapshotIndustryId = org.activeIndustries[0]!;
      const snapshotOriginalIndustry = db.config.industries.find((entry) => entry.id === snapshotIndustryId);
      assert.ok(snapshotOriginalIndustry);
      snapshotOriginalIndustry.aiBaseline = "SNAPSHOT_ORIGINAL_BASELINE";
      snapshotOriginalIndustry.standardScoringGuidance = "SNAPSHOT_ORIGINAL_SCORING";
      db.orgDivisions.push(
        { id: "division_runtime_a", orgId: org.id, name: "Division A", active: true,
          createdAt: now, updatedAt: now, deletedAt: null },
        { id: "division_runtime_b", orgId: org.id, name: "Division B", active: true,
          createdAt: now, updatedAt: now, deletedAt: null },
      );
      for (const restrictedScenario of [scenario, unattachedScenario]) {
        db.orgStandardScenarioDivisionAssignments.push({ id: `division_${restrictedScenario.id}`,
          orgId: org.id, scenarioId: restrictedScenario.id, divisionId: "division_runtime_b",
          createdAt: now, updatedAt: now });
      }
      const topic: OrgTrainingRecord = { id: "focus_runtime_topic", orgId: org.id,
        name: "Runtime Topic", description: "", status: "active", createdAt: now, updatedAt: now };
      db.orgTrainings.push(topic);
      const customScenarioId = "custom_legacy_only";
      const snapshotCustomScenarioId = "custom_snapshot_platform_admin";
      org.customScenarios = [...(org.customScenarios ?? []), {
        id: customScenarioId, orgId: org.id, segmentId: segment.id, title: "Legacy-only custom scenario",
        description: "A legacy Topic relationship must not authorize scoring.", aiRole: "Counterpart",
        scoringGuidance: "", applicableIndustryIds: [...org.activeIndustries], enabled: true,
        provenance: { sourceMode: "scratch", creationMethod: "manual" }, createdBy: "platform_admin",
        createdAt: now, updatedAt: now,
      }, {
        id: snapshotCustomScenarioId, orgId: org.id, segmentId: segment.id,
        title: "Platform-admin snapshot custom scenario",
        description: "UNVERSIONED_CUSTOM_RUNTIME_MARKER must remain resolvable from the organization scenario.",
        desiredOutcome: "UNVERSIONED_CUSTOM_OUTCOME", aiRole: "UNVERSIONED_CUSTOM_COUNTERPART",
        scoringGuidance: "UNVERSIONED_CUSTOM_SCORING_GUIDANCE",
        applicableIndustryIds: [org.activeIndustries[0]!], enabled: true,
        provenance: { sourceMode: "scratch", creationMethod: "manual" }, createdBy: "platform_admin",
        createdAt: now, updatedAt: now,
      }];
      db.orgTrainingScenarioAttachments.push({ id: "legacy_custom_attachment", orgId: org.id,
        trainingId: topic.id, scenarioId: customScenarioId, createdAt: now, updatedAt: now });
      const foreignTopic: OrgTrainingRecord = { ...topic, id: "focus_foreign_topic", orgId: foreignOrg.id };
      const unmanagedTopic: OrgTrainingRecord = {
        ...topic, id: "focus_runtime_unmanaged_topic", name: "Unmanaged Topic",
      };
      const inactiveTopic: OrgTrainingRecord = {
        ...topic, id: "focus_runtime_inactive_topic", name: "Inactive Topic", status: "archived",
      };
      db.orgTrainings.push(foreignTopic, unmanagedTopic, inactiveTopic);
      const storage = createDatabaseStorage({ provider: "postgres", dbPath: "unused",
        databaseUrl: url, pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000,
        queryPool: pool, ensureDatabaseShape: imported.ensureDatabaseShape,
        createDefaultDatabase: imported.createDefaultDatabase });
      await storage.save(db);
      await moduleEntitlements.setOrgModuleEntitlement({
        orgId: org.id, moduleKey: "training_content", enabled: true,
        updatedByActorId: "platform_admin", updatedAt: new Date(now),
      });
      const categoryId = randomUUID();
      const foreignCategoryId = randomUUID();
      const contentId = randomUUID();
      const restrictedContentId = randomUUID();
      const foreignContentId = randomUUID();
      await pool.query(`INSERT INTO org_content_categories
        (id,org_id,name,description,display_order,is_default,created_by_actor_id,updated_by_actor_id,created_at,updated_at)
        VALUES ($1,$2,'General','',0,TRUE,'platform_admin','platform_admin',$3,$3),
          ($4,$5,'General','',0,TRUE,'platform_admin','platform_admin',$3,$3)`,
      [categoryId, org.id, now, foreignCategoryId, foreignOrg.id]);
      await pool.query(`INSERT INTO org_content_items
        (id,org_id,category_id,title,description,content_type,publication_state,native_body,
          display_order,content_version,created_by_actor_id,updated_by_actor_id,created_at,updated_at)
        VALUES ($1,$2,$3,'Scoped content','', 'native','published','Content body',0,1,
          'platform_admin','platform_admin',$4,$4),
          ($8,$2,$3,'Restricted content','', 'native','published','Restricted body',1,1,
          'platform_admin','platform_admin',$4,$4),
          ($5,$6,$7,'Foreign content','', 'native','published','Foreign body',0,1,
          'platform_admin','platform_admin',$4,$4)`,
      [contentId, org.id, categoryId, now, foreignContentId, foreignOrg.id, foreignCategoryId,
        restrictedContentId]);
      await pool.query(`INSERT INTO org_content_assignments
        (id,org_id,content_id,assignment_type,subject_user_id,created_by_actor_id,created_at)
        VALUES ($1,$2,$3,'organization',NULL,'platform_admin',$4)`,
      [randomUUID(), org.id, contentId, now]);
      const loadedAfterSeed = await storage.load();
      assert.equal(loadedAfterSeed.users.some((candidate) => candidate.id === user.id), true);
      assert.equal(loadedAfterSeed.users.filter((candidate) =>
        candidate.managerUserId === scopedManager.id && candidate.status === "active").length, 2);
      const persistedUsers = await pool.query<{ ids: string[] }>(
        "SELECT ARRAY(SELECT jsonb_array_elements(state_json->'users')->>'id') AS ids FROM app_state WHERE id='primary'");
      assert.equal(persistedUsers.rows[0]?.ids.includes(user.id), true);
      const authority = createFocusTopicAuthorityStore({ provider: "postgres", databaseUrl: url,
        pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool });
      await authority.initialize();
      await createUserNotificationStore({ provider: "postgres", databaseUrl: url,
        pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool }).initialize();
      await createAuditEventStore({ provider: "postgres", dbPath: "unused", databaseUrl: url,
        pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool }).initialize();
      const client = await pool.connect();
      const assignment = { id: "runtime_assignment", orgId: org.id, topicId: topic.id,
        audience: "individual" as const, subjectUserId: user.id, grantsManagement: false,
        createdBy: "platform_admin", createdAt: now, revokedBy: null, revokedAt: null };
      try {
        await client.query("BEGIN");
        await authority.createAssignment(assignment, client);
        await authority.attachScenario({ id: "runtime_attachment", orgId: org.id,
          topicId: topic.id, scenarioKind: "standard", scenarioId: scenario.id,
          attachedBy: "platform_admin", attachedAt: now, detachedBy: null, detachedAt: null }, client);
        await authority.attachScenario({ id: "runtime_custom_snapshot_attachment", orgId: org.id,
          topicId: topic.id, scenarioKind: "org", scenarioId: snapshotCustomScenarioId,
          attachedBy: "platform_admin", attachedAt: now, detachedBy: null, detachedAt: null }, client);
        await authority.createAssignment({ ...assignment, id: "foreign_runtime_assignment",
          orgId: foreignOrg.id, topicId: foreignTopic.id, subjectUserId: foreignPerformanceUser.id }, client);
        await authority.attachScenario({ id: "foreign_runtime_attachment", orgId: foreignOrg.id,
          topicId: foreignTopic.id, scenarioKind: "standard", scenarioId: scenario.id,
          attachedBy: "platform_admin", attachedAt: now, detachedBy: null, detachedAt: null }, client);
        await client.query("COMMIT");
      } finally { client.release(); }
      server = await new Promise<Server>((resolve) => {
        const started = imported.app.listen(0, () => resolve(started));
      });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const call = async (path: string, body?: Record<string, unknown>) => {
        const response = await fetch(base + path, { method: body ? "POST" : "GET",
          headers: { Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const configParity = async (label: string, who = user.id, auth = token, selectedOrg?: string) => {
        const read = async (suffix: string) => {
          const response = await fetch(base + `/mobile/users/${who}/${suffix}`, {
            headers: { Authorization: `Bearer ${auth}`, ...(selectedOrg ? { "X-Superuser-Org-Id": selectedOrg } : {}) },
          });
          return { status: response.status, body: await response.json() as Record<string, any> };
        };
        const config = await read("config");
        const update = await read("updates?cursor=999999&timeoutMs=1000");
        assert.equal(update.status, config.status, label);
        if (config.status !== 200) { assert.deepEqual(update.body, config.body, label); return config; }
        assert.deepEqual(update.body.config, config.body, label);
        assert.equal(update.body.changed, true);
        assert.equal(typeof update.body.cursor, "number");
        assert.equal(update.body.user.id, who);
        assert.ok(update.body.generatedAt && update.body.entitlements);
        return config;
      };
      await t.test("config and updates share assignment scope, resource-only Topics and current delivery authorization", async () => {
        const before = structuredClone(await storage.load());
        const state = structuredClone(before);
        const resourceTopic = { ...topic, id: "config_resource_only", name: "Resource only" };
        state.orgTrainings.push(resourceTopic);
        await storage.save(state);
        const client = await pool!.connect();
        try {
          await authority.createAssignment({ ...assignment, id: "config_resource_assignment", topicId: resourceTopic.id }, client);
          await authority.attachContent({ id: "config_resource_attachment", orgId: org.id, topicId: resourceTopic.id,
            contentId, attachedBy: "platform_admin", attachedAt: now, detachedBy: null, detachedAt: null }, client);
        } finally { client.release(); }
        try {
          const active = await configParity("direct assignments");
          const topics = active.body.orgTrainings as Array<{ id: string }>;
          assert.ok(topics.some((entry) => entry.id === topic.id));
          assert.ok(topics.some((entry) => entry.id === resourceTopic.id));
          assert.ok(topics.every((entry) => entry.id !== unmanagedTopic.id && entry.id !== foreignTopic.id));
          const resourceDetail = await call(`/mobile/users/${user.id}/focus-topics/${resourceTopic.id}`);
          assert.equal(resourceDetail.status, 200);
          assert.deepEqual(resourceDetail.body.scenarios, []);
          assert.equal((resourceDetail.body.resources as unknown[]).length, 1);
          await configParity("foreign organization", foreignPerformanceUser.id, foreignMobileToken);
          await configParity("foreign token rejected", user.id, foreignMobileToken);
          assert.equal((await configParity("missing token rejected", user.id, "")).status, 401);
          const forgedOrg = await configParity("normal learner cannot select another organization", user.id, token, foreignOrg.id);
          assert.ok((forgedOrg.body.orgTrainings as Array<{ orgId: string }>).every((row) => row.orgId === org.id));
          const waitUntilRegistered = async () => {
            const deadline = Date.now() + 5000;
            while (imported.getMobileUpdateWaiterCountForTest(user.id) === 0) {
              assert.ok(Date.now() < deadline, "long-poll waiter was not registered");
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          };
          const initial = await call(`/mobile/users/${user.id}/updates?cursor=999999&timeoutMs=1000`);
          const pending = call(`/mobile/users/${user.id}/updates?cursor=${initial.body.cursor}&timeoutMs=1000`);
          await waitUntilRegistered();
          await pool!.query("UPDATE focus_topic_assignments SET revoked_at=NOW(),revoked_by='platform_admin' WHERE id='config_resource_assignment'");
          const idle = await pending;
          assert.equal(idle.status, 200);
          assert.equal(idle.body.changed, false);
          assert.equal(idle.body.config, undefined);
          const revoked = await configParity("revocation cannot reuse prior payload");
          assert.ok(!(revoked.body.orgTrainings as Array<{ id: string }>).some((row) => row.id === resourceTopic.id));

          const login = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
          assert.equal(login.status, 200);
          const masterToken = (await login.json() as { token: string }).token;
          const beforeEvent = await call(`/mobile/users/${user.id}/updates?cursor=999999&timeoutMs=1000`);
          const eventPending = call(`/mobile/users/${user.id}/updates?cursor=${beforeEvent.body.cursor}&timeoutMs=1000`);
          await waitUntilRegistered();
          const mutation = await fetch(base + "/config", { method: "PATCH",
            headers: { Authorization: `Bearer ${masterToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ defaultDifficulty: state.config.defaultDifficulty }) });
          assert.equal(mutation.status, 200);
          const delivered = await eventPending;
          assert.equal(delivered.status, 200);
          assert.equal(delivered.body.changed, true);
          assert.equal(delivered.body.reason, "config");
          assert.deepEqual(delivered.body.config, (await call(`/mobile/users/${user.id}/config`)).body);
          assert.ok((delivered.body.cursor as number) > (beforeEvent.body.cursor as number));
          assert.equal(imported.getMobileUpdateWaiterCountForTest(user.id), 0);

          const current = await call(`/mobile/users/${user.id}/updates?cursor=999999&timeoutMs=1000`);
          const deniedPending = call(`/mobile/users/${user.id}/updates?cursor=${current.body.cursor}&timeoutMs=1000`);
          await waitUntilRegistered();
          const disabled = structuredClone(await storage.load());
          disabled.users.find((row) => row.id === user.id)!.status = "disabled";
          await storage.save(disabled);
          assert.equal((await deniedPending).status, 401);
          await configParity("disabled user denied");

          const unverified = structuredClone(state);
          unverified.users.find((row) => row.id === user.id)!.emailVerifiedAt = null;
          await storage.save(unverified);
          const unverifiedConfig = await configParity("unverified learner");
          assert.equal(unverifiedConfig.status, 401);

          const noIndustries = structuredClone(state);
          noIndustries.orgs.find((row) => row.id === org.id)!.activeIndustries = [];
          await storage.save(noIndustries);
          const empty = await configParity("zero effective industries");
          assert.deepEqual(empty.body.industries, []);
          assert.deepEqual(empty.body.segments, []);
          const inactiveIndustries = structuredClone(state);
          inactiveIndustries.config.industries.forEach((row) => { row.enabled = false; });
          await storage.save(inactiveIndustries);
          assert.deepEqual((await configParity("inactive industries")).body.industries, []);

          const superState = structuredClone(state);
          const superId = "config_superuser";
          const superToken = `super_${randomUUID()}`;
          superState.users.push({ ...user, id: superId, email: "config-super@integration.test", isSuperUser: true });
          superState.mobileAuthTokens.push({ userId: superId,
            tokenHash: createHmac("sha256", tokenSecret).update(superToken).digest("hex"), createdAt: now, updatedAt: now });
          await storage.save(superState);
          const a = await configParity("acting organization A", superId, superToken, org.id);
          const b = await configParity("acting organization B", superId, superToken, foreignOrg.id);
          assert.ok((a.body.orgCustomScenarios as Array<{ id: string }>).some((row) => row.id === customScenarioId));
          assert.ok(!(b.body.orgCustomScenarios as Array<{ id: string }>).some((row) => row.id === customScenarioId));
          assert.ok((a.body.orgTrainings as Array<{ orgId: string }>).every((row) => row.orgId === org.id));
          assert.ok((b.body.orgTrainings as Array<{ orgId: string }>).every((row) => row.orgId === foreignOrg.id));
          await configParity("invalid acting organization", superId, superToken, "org_missing");
        } finally {
          await pool!.query("DELETE FROM org_content_topic_attachments WHERE id='config_resource_attachment'");
          await pool!.query("DELETE FROM focus_topic_assignments WHERE id='config_resource_assignment'");
          await storage.save(before);
        }
      });
      const catalog = await call(`/mobile/users/${user.id}/focus-topics`);
      assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
      assert.deepEqual((catalog.body.topics as Array<{ id: string }>).map((row) => row.id), [topic.id]);
      const detail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal((await call(`/mobile/users/${user.id}/focus-topics/${foreignTopic.id}`)).status, 404);
      assert.deepEqual((detail.body.scenarios as Array<{ id: string; trainingId: string | null }>).map((row) =>
        [row.id, row.trainingId]).sort(), [[scenario.id, null], [snapshotCustomScenarioId, topic.id]].sort());
      const installedParserUrl = new URL("../../mobile/src/focusTopics/model.ts", import.meta.url).href;
      const installedParser = await import(installedParserUrl) as {
        parseFocusTopicCatalogResponse: (value: unknown) => { topics: Array<{ id: string }> };
        parseFocusTopicDetailResponse: (value: unknown) => { scenarios: Array<{ id: string }> };
      };
      assert.deepEqual(installedParser.parseFocusTopicCatalogResponse(catalog.body).topics.map((row) => row.id), [topic.id]);
      assert.deepEqual(installedParser.parseFocusTopicDetailResponse(detail.body).scenarios.map((row) => row.id).sort(),
        [scenario.id, snapshotCustomScenarioId].sort());
      const login = await fetch(`${base}/auth/login`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
      assert.equal(login.status, 200);
      const masterToken = (await login.json() as { token: string }).token;
      const masterCall = async (path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) => {
        const response = await fetch(base + path, { method,
          headers: { Authorization: `Bearer ${masterToken}`,
            ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const assignmentsPath = `/orgs/${org.id}/trainings/${topic.id}/assignments`;
      const managementPath = `/orgs/${org.id}/trainings/${topic.id}/management-grants`;
      const attachmentsPath = `/orgs/${org.id}/trainings/${topic.id}/direct-attachments`;
      const unmanagedAttachmentsPath = `/orgs/${org.id}/trainings/${unmanagedTopic.id}/direct-attachments`;
      const attachmentCountBefore = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM focus_topic_scenario_attachments");
      const unknownStandard = await masterCall(attachmentsPath, "POST", {
        kind: "scenario", scenarioKind: "standard", scenarioId: "unknown_standard_scenario",
      });
      assert.equal(unknownStandard.status, 400, JSON.stringify(unknownStandard.body));
      const attachmentCountAfter = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM focus_topic_scenario_attachments");
      assert.equal(attachmentCountAfter.rows[0]?.count, attachmentCountBefore.rows[0]?.count);
      const rejectedDueDate = await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: secondReport.id, dueDate: "2026-12-31",
      });
      assert.equal(rejectedDueDate.status, 400, JSON.stringify(rejectedDueDate.body));
      assert.equal(rejectedDueDate.body.error, "Focus Topic assignments do not support due dates.");
      const invalidSubject = await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: "foreign_user",
      });
      assert.equal(invalidSubject.status, 400);
      const managementGrant = await masterCall(managementPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id,
      });
      assert.equal(managementGrant.status, 201, JSON.stringify(managementGrant.body));
      assert.equal(managementGrant.body.grantsManagement, true);
      assert.equal((await pool.query(
        "SELECT 1 FROM focus_topic_assignments WHERE id=$1 AND grants_management=TRUE",
        [managementGrant.body.id],
      )).rowCount, 1);
      const scopedCatalogBeforeLearner = await fetch(
        `${base}/mobile/users/${scopedUserAdmin.id}/focus-topics`,
        { headers: { Authorization: `Bearer ${scopedMobileToken}` } },
      );
      assert.equal(scopedCatalogBeforeLearner.status, 200);
      assert.deepEqual(((await scopedCatalogBeforeLearner.json()) as {
        topics: Array<{ id: string }>;
      }).topics, []);
      assert.equal((await pool.query(
        "SELECT 1 FROM user_notifications WHERE kind='topic_assigned' AND recipient_user_id=$1",
        [scopedUserAdmin.id],
      )).rowCount, 0);
      const scopedLearnerAssignment = await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id, grantsManagement: true,
      });
      assert.equal(scopedLearnerAssignment.status, 201, JSON.stringify(scopedLearnerAssignment.body));
      assert.equal(scopedLearnerAssignment.body.grantsManagement, false);
      assert.equal((await masterCall(managementPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id,
      })).status, 409);
      assert.equal((await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id,
      })).status, 409);
      const scopedCatalogWithLearner = await fetch(
        `${base}/mobile/users/${scopedUserAdmin.id}/focus-topics`,
        { headers: { Authorization: `Bearer ${scopedMobileToken}` } },
      );
      assert.deepEqual(((await scopedCatalogWithLearner.json()) as {
        topics: Array<{ id: string }>;
      }).topics.map((entry) => entry.id), [topic.id]);
      const productSettings = createOrganizationProductSettingsStore({
        provider: "postgres", databaseUrl: url, pgPoolMax: 3,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool,
      });
      await productSettings.initialize();
      await pool.query(`INSERT INTO organization_product_settings (
        org_id, allow_user_admin_focus_topic_management, allow_manager_focus_topic_management, updated_at
      ) VALUES ($1, TRUE, TRUE, NOW())
      ON CONFLICT (org_id) DO UPDATE SET allow_user_admin_focus_topic_management=TRUE,
        allow_manager_focus_topic_management=TRUE, updated_at=NOW()`,
      [org.id]);
      const scopedWebAuth = createWebAuthService({
        tokenSecret: process.env.WEB_AUTH_TOKEN_SECRET!,
        codeSecret: process.env.WEB_AUTH_CODE_SECRET!,
      });
      const scopedWebAuthStore = createWebAuthSessionStore({
        provider: "postgres", dbPath: "unused", databaseUrl: url, pgPoolMax: 3,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool,
      });
      await scopedWebAuthStore.initialize();
      const scopedSession = scopedWebAuth.issueSession(
        scopedUserAdmin, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(scopedSession.record);
      let scopedSessionToken = scopedSession.token;
      const orgAdminSession = scopedWebAuth.issueSession(
        orgAdmin, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(orgAdminSession.record);
      const dashboardCall = async (
        sessionToken: string,
        path: string,
        method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
        body?: Record<string, unknown>,
      ) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const scopedCall = (path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
        body?: Record<string, unknown>) => dashboardCall(scopedSessionToken, path, method, body);
      const orgAdminCall = (path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
        body?: Record<string, unknown>) => dashboardCall(orgAdminSession.token, path, method, body);
      const managerGrant = await masterCall(managementPath, "POST", {
        audience: "manager_only", subjectUserId: scopedManager.id,
      });
      assert.equal(managerGrant.status, 201, JSON.stringify(managerGrant.body));
      const managerSession = scopedWebAuth.issueSession(
        scopedManager, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(managerSession.record);
      assert.equal((await dashboardCall(
        managerSession.token, `/orgs/${org.id}/trainings`,
      )).status, 200);
      const managerCall = (
        path: string,
        method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
        body?: Record<string, unknown>,
      ) => dashboardCall(managerSession.token, path, method, body);
      const assignableLearnersPath = `/orgs/${org.id}/trainings/${topic.id}/assignable-learners`;
      const managerAssignableLearners = await managerCall(assignableLearnersPath);
      assert.equal(managerAssignableLearners.status, 200, JSON.stringify(managerAssignableLearners.body));
      assert.deepEqual(
        (managerAssignableLearners.body.learners as Array<{ userId: string }>).map((row) => row.userId).sort(),
        [secondReport.id, user.id].sort(),
      );
      const orgAdminAssignableLearners = await orgAdminCall(assignableLearnersPath);
      assert.equal(orgAdminAssignableLearners.status, 200, JSON.stringify(orgAdminAssignableLearners.body));
      const orgAdminAssignableIds = new Set((orgAdminAssignableLearners.body.learners as Array<{ userId: string }>).map((row) => row.userId));
      assert.equal(orgAdminAssignableIds.has(user.id), true);
      assert.equal(orgAdminAssignableIds.has(secondReport.id), true);
      assert.equal(orgAdminAssignableIds.has(scopedManager.id), true);
      assert.equal(orgAdminAssignableIds.has(scopedUserAdmin.id), false);
      assert.equal(orgAdminAssignableIds.has(foreignPerformanceUser.id), false);
      const managerWorkspace = await managerCall(`/dashboard/performance?orgId=${org.id}`);
      assert.equal(managerWorkspace.status, 200, JSON.stringify(managerWorkspace.body));
      assert.deepEqual(
        (managerWorkspace.body.users as Array<{ userId?: string }>).map((entry) => entry.userId).sort(),
        [scopedManager.id, secondReport.id, user.id].sort(),
      );
      const managerTeam = await managerCall(
        `/dashboard/performance/team?orgId=${org.id}&year=2026&month=10`,
      );
      assert.equal(managerTeam.status, 200, JSON.stringify(managerTeam.body));
      const managerCreatedGoal = await managerCall("/dashboard/performance/plans", "POST", {
        userId: secondReport.id,
        orgId: org.id,
        startDate: "2099-10-01",
        endDate: "2099-11-01",
        timeZone: "UTC",
        activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 1 },
        performanceGoal: {
          enabled: false, metricType: null, targetScore: null,
          improvementAmount: null, comparisonMonthCount: null,
        },
        scopeSelection: { allAssignedScenarios: true, selectedFocusTopicIds: [], selectedScenarioIds: [] },
      });
      assert.equal(managerCreatedGoal.status, 201, JSON.stringify(managerCreatedGoal.body));
      const managerGoalId = String((managerCreatedGoal.body.plan as { id?: string }).id);
      assert.ok(managerGoalId);
      const managerUpdatedGoal = await managerCall(`/dashboard/performance/plans/${managerGoalId}`, "PATCH", {
        userId: secondReport.id,
        orgId: org.id,
        startDate: "2099-10-01",
        endDate: "2099-11-15",
        timeZone: "UTC",
        activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 1 },
        performanceGoal: {
          enabled: false, metricType: null, targetScore: null,
          improvementAmount: null, comparisonMonthCount: null,
        },
        scopeSelection: { allAssignedScenarios: true, selectedFocusTopicIds: [], selectedScenarioIds: [] },
      });
      assert.equal(managerUpdatedGoal.status, 200, JSON.stringify(managerUpdatedGoal.body));
      assert.equal((await managerCall(`/dashboard/performance/plans/${managerGoalId}/updates`, "POST", {
        body: "Current direct-report check-in.",
      })).status, 201);
      assert.equal((await managerCall("/dashboard/performance/preview", "POST", {
        userId: scopedUserAdmin.id, orgId: org.id,
      })).status, 404);
      assert.equal((await managerCall("/dashboard/performance/preview", "POST", {
        userId: foreignPerformanceUser.id, orgId: foreignOrg.id,
      })).status, 404);
      const managerCreated = await managerCall(
        `/orgs/${org.id}/trainings/${topic.id}/content`, "POST", {
          contentType: "pdf", title: "Manager draft", description: "",
        },
      );
      assert.equal(managerCreated.status, 201, JSON.stringify(managerCreated.body));
      const managerAttached = await managerCall(attachmentsPath, "POST", {
        kind: "content", contentId,
      });
      assert.equal(managerAttached.status, 201, JSON.stringify(managerAttached.body));
      assert.equal((await managerCall(
        `${attachmentsPath}/${managerAttached.body.id as string}`, "DELETE",
      )).status, 200);
      const managerAssignedReport = await managerCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: secondReport.id,
      });
      assert.equal(managerAssignedReport.status, 201, JSON.stringify(managerAssignedReport.body));
      assert.equal(Object.hasOwn(managerAssignedReport.body, "dueDate"), false);
      assert.equal((await managerCall(
        `${assignmentsPath}/${managerAssignedReport.body.id as string}`, "DELETE",
      )).status, 200);
      const adminAssignedReport = await orgAdminCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: secondReport.id,
      });
      assert.equal(adminAssignedReport.status, 201, JSON.stringify(adminAssignedReport.body));
      assert.equal((await managerCall(
        `${assignmentsPath}/${adminAssignedReport.body.id as string}`, "DELETE",
      )).status, 200);
      for (const body of [
        { audience: "individual", subjectUserId: scopedManager.id },
        { audience: "individual", subjectUserId: scopedUserAdmin.id },
        { audience: "individual", subjectUserId: "foreign_user" },
        { audience: "organization", subjectUserId: null },
      ]) {
        const deniedAssignment = await managerCall(assignmentsPath, "POST", body);
        assert.notEqual(deniedAssignment.status, 201, JSON.stringify(deniedAssignment.body));
      }
      assert.equal((await orgAdminCall(`/dashboard/admin/users/${secondReport.id}?orgId=${org.id}`, "PATCH", {
        managerUserId: null,
      })).status, 200);
      assert.equal((await dashboardCall(
        managerSession.token, `/orgs/${org.id}/trainings`,
      )).status, 200);
      assert.equal((await orgAdminCall(`/dashboard/admin/users/${user.id}?orgId=${org.id}`, "PATCH", {
        managerUserId: null,
      })).status, 200);
      assert.equal((await dashboardCall(
        managerSession.token, `/orgs/${org.id}/trainings`,
      )).status, 403);
      assert.equal((await managerCall(assignableLearnersPath)).status, 404);
      const managerPerformanceAfterLastReport = await managerCall(
        `/dashboard/performance/team?orgId=${org.id}&year=2026&month=10`,
      );
      assert.notEqual(managerPerformanceAfterLastReport.status, 200, JSON.stringify(managerPerformanceAfterLastReport.body));
      assert.equal((await managerCall(
        `/orgs/${org.id}/trainings/${topic.id}/content`, "POST", {
          contentType: "pdf", title: "Denied after manager-derived access loss", description: "",
        },
      )).status, 404);
      assert.equal((await managerCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: user.id,
      })).status, 404);
      assert.equal((await managerCall(attachmentsPath, "POST", {
        kind: "content", contentId,
      })).status, 404);
      assert.equal((await masterCall(`/users/${scopedManager.id}`, "PATCH", {
        dashboardAccessEnabled: true,
      })).status, 200);
      const manualDashboardSession = scopedWebAuth.issueSession(
        { ...scopedManager, dashboardAccessEnabled: true }, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(manualDashboardSession.record);
      assert.equal((await dashboardCall(
        manualDashboardSession.token, "/dashboard/overview",
      )).status, 200);
      const scopedTopics = await scopedCall(`/orgs/${org.id}/trainings`);
      assert.equal(scopedTopics.status, 200, JSON.stringify(scopedTopics.body));
      assert.deepEqual(
        (scopedTopics.body.trainings as Array<{ id: string }>).map((entry) => entry.id),
        [topic.id],
      );
      assert.equal(
        ((scopedTopics.body.management as { canManageAllTopics: boolean }).canManageAllTopics),
        false,
      );
      await pool.query(`UPDATE organization_product_settings
        SET allow_user_admin_focus_topic_management=FALSE, updated_at=NOW() WHERE org_id=$1`, [org.id]);
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`)).status, 403);
      await pool.query(`UPDATE organization_product_settings
        SET allow_user_admin_focus_topic_management=TRUE, updated_at=NOW() WHERE org_id=$1`, [org.id]);
      const switchRestoredSession = scopedWebAuth.issueSession(scopedUserAdmin, 60, new Date(), {
        accessType: "customer_dashboard_user", orgId: org.id,
      });
      await scopedWebAuthStore.saveSession(switchRestoredSession.record);
      scopedSessionToken = switchRestoredSession.token;
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`)).status, 200);
      assert.equal((await orgAdminCall(`/dashboard/admin/users/${user.id}?orgId=${org.id}`, "PATCH", {
        managerUserId: scopedUserAdmin.id,
      })).status, 200);
      assert.equal((await masterCall(`/users/${scopedUserAdmin.id}`, "PATCH", {
        orgRole: "user",
      })).status, 200);
      const demotedSession = scopedWebAuth.issueSession(
        { ...scopedUserAdmin, orgRole: "user" }, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(demotedSession.record);
      scopedSessionToken = demotedSession.token;
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`)).status, 200);
      assert.equal((await orgAdminCall(`/dashboard/admin/users/${user.id}?orgId=${org.id}`, "PATCH", {
        managerUserId: null,
      })).status, 200);
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`)).status, 403);
      assert.equal((await masterCall(`/users/${scopedUserAdmin.id}`, "PATCH", {
        orgRole: "user_admin",
      })).status, 200);
      const roleRestoredSession = scopedWebAuth.issueSession(scopedUserAdmin, 60, new Date(), {
        accessType: "customer_dashboard_user", orgId: org.id,
      });
      await scopedWebAuthStore.saveSession(roleRestoredSession.record);
      scopedSessionToken = roleRestoredSession.token;
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`)).status, 200);
      assert.equal((await scopedCall(`/orgs/${org.id}/trainings`, "POST", {
        name: "Denied Topic", description: "", status: "draft",
      })).status, 403);
      assert.equal((await scopedCall(assignmentsPath)).status, 200);
      assert.equal((await scopedCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: user.id,
      })).status, 403);
      assert.equal((await scopedCall(
        `/orgs/${org.id}/trainings/${foreignTopic.id}/assignments`,
      )).status, 404);
      const relatedBefore = await scopedCall(attachmentsPath);
      assert.equal(relatedBefore.status, 200, JSON.stringify(relatedBefore.body));
      const relatedBeforeIds = (relatedBefore.body.contentItems as Array<{ id: string }>)
        .map((entry) => entry.id);
      assert.equal(relatedBeforeIds.includes(contentId), true);
      assert.equal(relatedBeforeIds.includes(
        ((managerCreated.body.item as { id: string }).id),
      ), true);
      const restrictedAttach = await scopedCall(attachmentsPath, "POST", {
        kind: "content", contentId: restrictedContentId,
      });
      assert.equal(restrictedAttach.status, 403, JSON.stringify(restrictedAttach.body));
      const adminRestrictedAttachment = await orgAdminCall(attachmentsPath, "POST", {
        kind: "content", contentId: restrictedContentId,
      });
      assert.equal(adminRestrictedAttachment.status, 201, JSON.stringify(adminRestrictedAttachment.body));
      const relatedWithRestrictedAttachment = await scopedCall(attachmentsPath);
      const relatedItems = relatedWithRestrictedAttachment.body.contentItems as Array<{
        id: string; availableToAttach: boolean;
      }>;
      assert.equal(relatedItems.some((entry) => entry.id === contentId), true);
      assert.equal(relatedItems.some((entry) => entry.id === restrictedContentId), true);
      assert.equal(relatedItems.find((entry) => entry.id === restrictedContentId)?.availableToAttach, false);
      assert.equal((await scopedCall(
        `${attachmentsPath}/${adminRestrictedAttachment.body.id as string}`, "DELETE",
      )).status, 200);
      const scopedAttached = await scopedCall(attachmentsPath, "POST", { kind: "content", contentId });
      assert.equal(scopedAttached.status, 201, JSON.stringify(scopedAttached.body));
      assert.equal((await scopedCall(attachmentsPath, "POST", { kind: "content", contentId })).status, 409);
      assert.equal((await scopedCall(attachmentsPath, "POST", {
        kind: "content", contentId: foreignContentId,
      })).status, 403);
      await pool.query(`UPDATE organization_product_settings
        SET allow_customer_scenario_creation=TRUE, updated_at=NOW() WHERE org_id=$1`, [org.id]);
      const practiceScenarioPath = `/orgs/${org.id}/trainings/${topic.id}/practice-scenarios`;
      const sourceDraft = {
        title: "Source-backed scenario", description: "Use the attached resource.",
        desiredOutcome: "Confirm a next step.", aiRole: "A skeptical counterpart",
        scoringGuidance: "Assess clarity.", segmentId: scenario.segmentId,
        applicableIndustryIds: [org.activeIndustries[0]!], sourceContentIds: [contentId],
      };
      const sourceCreated = await orgAdminCall(practiceScenarioPath, "POST", sourceDraft);
      assert.equal(sourceCreated.status, 201, JSON.stringify(sourceCreated.body));
      const sourceScenarioId = String(sourceCreated.body.id);
      assert.deepEqual((sourceCreated.body.currentVersion as { sourceReferences: Array<{ referenceId: string }> })
        .sourceReferences.map((reference) => reference.referenceId), [contentId]);
      const sourceRevision = await orgAdminCall(
        `${practiceScenarioPath}/${sourceScenarioId}/revisions`, "POST",
        { ...sourceDraft, title: "Source-backed scenario revision" },
      );
      assert.equal(sourceRevision.status, 200, JSON.stringify(sourceRevision.body));
      const foreignSource = await orgAdminCall(practiceScenarioPath, "POST", {
        ...sourceDraft, title: "Foreign source denied", sourceContentIds: [foreignContentId],
      });
      assert.equal(foreignSource.status, 400);
      assert.equal(JSON.stringify(foreignSource.body).includes("operator does not exist"), false);
      assert.equal((await orgAdminCall(
        `${attachmentsPath}/${scopedAttached.body.id as string}`, "DELETE",
      )).status, 200);
      const detachedSource = await orgAdminCall(
        `${practiceScenarioPath}/${sourceScenarioId}/revisions`, "POST",
        { ...sourceDraft, title: "Detached source denied" },
      );
      assert.equal(detachedSource.status, 400);
      assert.equal(JSON.stringify(detachedSource.body).includes("operator does not exist"), false);
      const sourceReattached = await scopedCall(attachmentsPath, "POST", { kind: "content", contentId });
      assert.equal(sourceReattached.status, 201, JSON.stringify(sourceReattached.body));

      // HTTP regressions for generation are deliberately exercised against the
      // normal native Related Content path. Generation returns a receipt only;
      // persistence begins only when the author saves through this route.
      const generationPath = `${practiceScenarioPath}/generate`;
      const generatedSaveInput = (draft: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
        title: draft.title, description: draft.description, desiredOutcome: draft.desiredOutcome,
        aiRole: draft.aiRole, scoringGuidance: draft.scoringGuidance, segmentId: scenario.segmentId,
        applicableIndustryIds: [org.activeIndustries[0]!], sourceContentIds: [contentId],
        generationToken: draft.generationToken,
        ...overrides,
      });
      const scenarioCount = async () => Number((await pool!.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM customer_practice_scenarios WHERE org_id=$1 AND home_focus_topic_id=$2",
        [org.id, topic.id],
      )).rows[0]?.count ?? "0");
      const generationInput = { sourceContentIds: [contentId], practiceGuidance: "Practice a concise next step." };

      // A rate-limited request uses an otherwise unauthorized source. Receiving
      // 429 before the source error proves the limiter runs before preparation.
      imported.clearRateLimitsForTest();
      await withMockScenarioGeneration(async (calls) => {
        for (let index = 0; index < 12; index += 1) {
          const generated = await orgAdminCall(generationPath, "POST", generationInput);
          assert.equal(generated.status, 200, JSON.stringify(generated.body));
        }
        const limited = await orgAdminCall(generationPath, "POST", {
          sourceContentIds: [foreignContentId],
        });
        assert.equal(limited.status, 429, JSON.stringify(limited.body));
        assert.equal(calls.value, 12);
      });
      imported.clearRateLimitsForTest();
      await pool.query("DELETE FROM ai_usage_events");

      // Exhaust the configured global budget directly in the disposable test
      // schema. The endpoint must refuse before it calls the provider or writes
      // a scenario.
      const beforeBudgetRefusal = await scenarioCount();
      const budgetRows = Array.from({ length: 100 }, (_, index) => [
        `generation_budget_${index}`, "turn", `budget_user_${index}`, org.id,
        "budget-model", "budget-prompt", 0, 0, 0, now,
      ]);
      await pool.query(`INSERT INTO ai_usage_events
        (id,kind,user_id,org_id,model,prompt_version,input_tokens,output_tokens,total_tokens,created_at)
        SELECT * FROM UNNEST($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],
          $7::int[],$8::int[],$9::int[],$10::timestamptz[])`, [
        budgetRows.map((row) => row[0]), budgetRows.map((row) => row[1]), budgetRows.map((row) => row[2]),
        budgetRows.map((row) => row[3]), budgetRows.map((row) => row[4]), budgetRows.map((row) => row[5]),
        budgetRows.map((row) => row[6]), budgetRows.map((row) => row[7]), budgetRows.map((row) => row[8]),
        budgetRows.map((row) => row[9]),
      ]);
      await withMockScenarioGeneration(async (calls) => {
        const refused = await orgAdminCall(generationPath, "POST", generationInput);
        // The generation route deliberately returns its generic safe provider
        // failure payload for a refused reservation.
        assert.equal(refused.status, 503, JSON.stringify(refused.body));
        assert.equal(refused.body.code, "generation_failed");
        assert.equal(calls.value, 0);
      });
      assert.equal(await scenarioCount(), beforeBudgetRefusal);
      await pool.query("DELETE FROM ai_usage_events");

      const generateDraft = async () => await withMockScenarioGeneration(async (calls) => {
        const generated = await orgAdminCall(generationPath, "POST", generationInput);
        assert.equal(generated.status, 200, JSON.stringify(generated.body));
        assert.equal(calls.value, 1);
        assert.match(String(generated.body.scoringGuidance), /Identifies the stakeholder's primary concern/);
        assert.equal(String(generated.body.promptVersion), "customer-practice-scenario-generation-v2");
        return generated.body;
      });

      // The save route must discard client-provided server provenance and bind
      // the immutable version to the server-issued generation receipt instead.
      const generatedForForgedProvenance = await generateDraft();
      const rejectedGeneratedIndustry = await orgAdminCall(practiceScenarioPath, "POST", generatedSaveInput(
        generatedForForgedProvenance, { applicableIndustryIds: [snapshotIndustryId, "unassigned_industry"] },
      ));
      assert.equal(rejectedGeneratedIndustry.status, 400, JSON.stringify(rejectedGeneratedIndustry.body));
      const forgedProvenanceSave = await orgAdminCall(practiceScenarioPath, "POST", generatedSaveInput(
        generatedForForgedProvenance,
        { serverProvenance: { sourceMode: "scratch", creationMethod: "manual", modelUsed: "forged-client-model" } },
      ));
      assert.equal(forgedProvenanceSave.status, 201, JSON.stringify(forgedProvenanceSave.body));
      const savedProvenance = ((forgedProvenanceSave.body.currentVersion as { provenance?: Record<string, unknown> })
        .provenance ?? {});
      assert.equal(savedProvenance.creationMethod, "ai");
      assert.equal(savedProvenance.modelUsed, "server-issued-generation-model");
      assert.equal(savedProvenance.generatedPrompt, "customer-practice-scenario-generation-v2");
      assert.notEqual(savedProvenance.modelUsed, "forged-client-model");
      assert.equal((forgedProvenanceSave.body.currentVersion as { scoringGuidance: string }).scoringGuidance,
        generatedForForgedProvenance.scoringGuidance);

      const beforeCreationDisabledSave = await scenarioCount();
      const generatedBeforeCreationDisabled = await generateDraft();
      await pool.query(`UPDATE organization_product_settings
        SET allow_customer_scenario_creation=FALSE, updated_at=NOW() WHERE org_id=$1`, [org.id]);
      const creationDisabledSave = await orgAdminCall(
        practiceScenarioPath, "POST", generatedSaveInput(generatedBeforeCreationDisabled),
      );
      assert.equal(creationDisabledSave.status, 403, JSON.stringify(creationDisabledSave.body));
      assert.equal(await scenarioCount(), beforeCreationDisabledSave);
      await pool.query(`UPDATE organization_product_settings
        SET allow_customer_scenario_creation=TRUE, updated_at=NOW() WHERE org_id=$1`, [org.id]);

      const beforeDetachedSourceSave = await scenarioCount();
      const generatedBeforeDetach = await generateDraft();
      await pool.query(
        "UPDATE org_content_topic_attachments SET detached_at=NOW(), detached_by=$2 WHERE id=$1",
        [sourceReattached.body.id, orgAdmin.id],
      );
      const detachedSourceSave = await orgAdminCall(
        practiceScenarioPath, "POST", generatedSaveInput(generatedBeforeDetach),
      );
      assert.notEqual(detachedSourceSave.status, 201, JSON.stringify(detachedSourceSave.body));
      assert.equal(await scenarioCount(), beforeDetachedSourceSave);
      await pool.query("UPDATE org_content_topic_attachments SET detached_at=NULL, detached_by=NULL WHERE id=$1", [
        sourceReattached.body.id,
      ]);

      const topicContentPath = `/orgs/${org.id}/trainings/${topic.id}/content`;
      assert.equal((await scopedCall(topicContentPath, "POST", {
        contentType: "pdf", title: "Spoofed creator", description: "",
        actorId: orgAdmin.id,
      })).status, 400);
      assert.equal((await scopedCall(
        `/orgs/${org.id}/trainings/${unmanagedTopic.id}/content`, "POST", {
          contentType: "pdf", title: "Unmanaged", description: "",
        },
      )).status, 404);
      assert.equal((await scopedCall(
        `/orgs/${foreignOrg.id}/trainings/${foreignTopic.id}/content`, "POST", {
          contentType: "pdf", title: "Foreign", description: "",
        },
      )).status, 404);
      assert.equal((await orgAdminCall(
        `/orgs/${org.id}/trainings/${inactiveTopic.id}/content`, "POST", {
          contentType: "pdf", title: "Inactive", description: "",
        },
      )).status, 404);
      const auditCountBeforeFailedCreate = Number((await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit_events",
      )).rows[0]?.count ?? "0");
      await pool.query(`CREATE FUNCTION reject_runtime_content_notification() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.kind = 'content_added' THEN RAISE EXCEPTION 'forced content notification failure'; END IF;
          RETURN NEW;
        END $$`);
      await pool.query(`CREATE TRIGGER reject_runtime_content_notification
        BEFORE INSERT ON user_notifications FOR EACH ROW
        EXECUTE FUNCTION reject_runtime_content_notification()`);
      const failedAtomicCreate = await scopedCall(topicContentPath, "POST", {
        contentType: "pdf", title: "Must roll back", description: "",
      });
      assert.equal(failedAtomicCreate.status, 500, JSON.stringify(failedAtomicCreate.body));
      assert.equal((await pool.query(
        "SELECT 1 FROM org_content_items WHERE org_id=$1 AND title='Must roll back'",
        [org.id],
      )).rowCount, 0);
      assert.equal(Number((await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit_events",
      )).rows[0]?.count ?? "0"), auditCountBeforeFailedCreate);
      await pool.query("DROP TRIGGER reject_runtime_content_notification ON user_notifications");
      await pool.query("DROP FUNCTION reject_runtime_content_notification() ");
      const orgAdminCreated = await orgAdminCall(topicContentPath, "POST", {
        contentType: "pdf", title: "Org admin Topic draft", description: "",
      });
      assert.equal(orgAdminCreated.status, 201, JSON.stringify(orgAdminCreated.body));
      assert.equal((orgAdminCreated.body.item as {
        publicationState: string; createdByActorId: string;
      }).publicationState, "draft");
      assert.equal((await pool.query(
        `SELECT 1 FROM org_content_topic_attachments
         WHERE org_id=$1 AND content_id=$2 AND topic_id=$3 AND detached_at IS NULL`,
        [org.id, (orgAdminCreated.body.item as { id: string }).id, topic.id],
      )).rowCount, 1);
      for (const externalUrl of [
        "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)",
        "https://youtube.com/watch?v=short",
      ]) assert.equal((await scopedCall(topicContentPath, "POST", {
        contentType: "external_url", externalKind: "youtube", externalUrl,
        title: "Invalid YouTube", description: "",
      })).status, 400);
      const youtubeCreated = await scopedCall(topicContentPath, "POST", {
        contentType: "external_url", externalKind: "youtube",
        externalUrl: "https://youtu.be/dQw4w9WgXcQ",
        title: "Customer YouTube", description: "Public resource with private transcript",
      });
      assert.equal(youtubeCreated.status, 201, JSON.stringify(youtubeCreated.body));
      const youtubeItem = youtubeCreated.body.item as {
        id: string; updatedAt: string; publicationState: string;
        externalKind: string; externalUrl: string;
      };
      assert.equal(youtubeItem.publicationState, "draft");
      assert.equal(youtubeItem.externalKind, "youtube");
      assert.equal(youtubeItem.externalUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      const youtubeRow = await pool.query<{ external_url: string; external_kind: string;
        created_by_actor_id: string }>(
        `SELECT external_url,external_kind,created_by_actor_id FROM org_content_items
         WHERE org_id=$1 AND id=$2`, [org.id, youtubeItem.id],
      );
      assert.deepEqual(youtubeRow.rows[0], { external_url: youtubeItem.externalUrl,
        external_kind: "youtube", created_by_actor_id: scopedUserAdmin.id });
      assert.equal((await pool.query(
        "SELECT 1 FROM org_content_assignments WHERE org_id=$1 AND content_id=$2 AND revoked_at IS NULL",
        [org.id, youtubeItem.id],
      )).rowCount, 0);
      const publishedYoutube = await scopedCall(`${topicContentPath}/${youtubeItem.id}/publish`, "POST", {
        expectedUpdatedAt: youtubeItem.updatedAt,
      });
      assert.equal(publishedYoutube.status, 200, JSON.stringify(publishedYoutube.body));
      const youtubeLearnerDetailBeforeTranscript = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal((youtubeLearnerDetailBeforeTranscript.body.resources as Array<{ id: string }>)
        .some((entry) => entry.id === youtubeItem.id), true);

      const transcriptPath = `${topicContentPath}/${youtubeItem.id}/transcript`;
      assert.equal((await call(transcriptPath)).status, 401);
      assert.equal((await managerCall(transcriptPath)).status, 404);
      assert.equal((await scopedCall(transcriptPath, "PUT", {
        text: "Denied actor spoof", actorId: orgAdmin.id,
      })).status, 400);
      assert.equal((await scopedCall(
        `/orgs/${foreignOrg.id}/trainings/${topic.id}/content/${youtubeItem.id}/transcript`,
      )).status, 404);
      assert.equal((await scopedCall(
        `/dashboard/admin/training-content/${youtubeItem.id}/transcript`,
      )).status, 403);
      await pool.query(`CREATE FUNCTION reject_runtime_transcript_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action LIKE 'training_content_transcript_%' THEN RAISE EXCEPTION 'forced transcript audit failure'; END IF;
          RETURN NEW;
        END $$`);
      await pool.query(`CREATE TRIGGER reject_runtime_transcript_audit
        BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_runtime_transcript_audit()`);
      assert.equal((await scopedCall(transcriptPath, "PUT", {
        text: "PRIVATE_TRANSCRIPT_ROLLBACK_SENTINEL",
      })).status, 500);
      assert.equal((await pool.query(
        "SELECT 1 FROM org_content_transcripts WHERE org_id=$1 AND content_id=$2",
        [org.id, youtubeItem.id],
      )).rowCount, 0);
      await pool.query("DROP TRIGGER reject_runtime_transcript_audit ON audit_events");
      await pool.query("DROP FUNCTION reject_runtime_transcript_audit() ");

      const firstTranscript = await scopedCall(transcriptPath, "PUT", {
        text: "PRIVATE_TRANSCRIPT_SENTINEL_VERSION_ONE",
      });
      assert.equal(firstTranscript.status, 200, JSON.stringify(firstTranscript.body));
      assert.equal((firstTranscript.body.generationSource as { eligible: boolean }).eligible, true);
      const replacedTranscript = await scopedCall(transcriptPath, "PUT", {
        text: "PRIVATE_TRANSCRIPT_SENTINEL_VERSION_TWO",
      });
      assert.equal(replacedTranscript.status, 200, JSON.stringify(replacedTranscript.body));
      const transcriptRows = await pool.query<{ version: number; current: boolean }>(
        `SELECT version,(superseded_at IS NULL AND removed_at IS NULL) AS current
         FROM org_content_transcripts WHERE org_id=$1 AND content_id=$2 ORDER BY version`,
        [org.id, youtubeItem.id],
      );
      assert.deepEqual(transcriptRows.rows.map((row) => [row.version, row.current]), [[1, false], [2, true]]);
      const changedYoutube = await orgAdminCall(`/dashboard/admin/training-content/${youtubeItem.id}`, "PATCH", {
        expectedUpdatedAt: (publishedYoutube.body.item as { updatedAt: string }).updatedAt,
        externalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      });
      assert.equal(changedYoutube.status, 200, JSON.stringify(changedYoutube.body));
      const staleYoutubeTranscript = await scopedCall(attachmentsPath);
      assert.equal((staleYoutubeTranscript.body.contentItems as Array<{
        id: string; generationSource: { reasonCode: string };
      }>).find((entry) => entry.id === youtubeItem.id)?.generationSource.reasonCode, "missing_transcript");
      assert.equal((await pool.query(
        "SELECT 1 FROM org_content_transcripts WHERE org_id=$1 AND content_id=$2 AND superseded_at IS NULL AND removed_at IS NULL",
        [org.id, youtubeItem.id],
      )).rowCount, 1);
      const currentYoutubeTranscript = await scopedCall(transcriptPath, "PUT", {
        text: "CURRENT_YOUTUBE_TRANSCRIPT_SENTINEL",
      });
      assert.equal((currentYoutubeTranscript.body.generationSource as { eligible: boolean }).eligible, true);
      const youtubeLearnerDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      const youtubeMobileDetail = await call(`/mobile/users/${user.id}/training-content/${youtubeItem.id}`);
      assert.equal(((youtubeMobileDetail.body.item as { externalUrl: string }).externalUrl),
        "https://www.youtube.com/watch?v=9bZkp7q19f0");
      for (const learnerPayload of [youtubeLearnerDetail.body, youtubeMobileDetail.body]) {
        const serialized = JSON.stringify(learnerPayload);
        assert.equal(serialized.includes("PRIVATE_TRANSCRIPT_SENTINEL"), false);
        assert.equal(serialized.includes("contentSha256"), false);
        assert.equal(serialized.includes("generationSource"), false);
      }
      const youtubeSharedAttachment = await orgAdminCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId: youtubeItem.id,
      });
      assert.equal(youtubeSharedAttachment.status, 201, JSON.stringify(youtubeSharedAttachment.body));
      const readableSharedTranscript = await scopedCall(transcriptPath);
      assert.equal(readableSharedTranscript.status, 200, JSON.stringify(readableSharedTranscript.body));
      assert.equal((readableSharedTranscript.body.transcript as { text: string }).text,
        "CURRENT_YOUTUBE_TRANSCRIPT_SENTINEL");
      assert.equal((await scopedCall(transcriptPath, "PUT", { text: "Denied shared mutation" })).status, 403);
      const centralTranscriptPath = `/dashboard/admin/training-content/${youtubeItem.id}/transcript`;
      assert.equal((await orgAdminCall(centralTranscriptPath, "PUT", {
        text: "PRIVATE_TRANSCRIPT_SENTINEL_ORG_ADMIN",
      })).status, 200);
      assert.equal((await orgAdminCall(
        `${unmanagedAttachmentsPath}/${youtubeSharedAttachment.body.id as string}`, "DELETE",
      )).status, 200);
      const youtubeStandaloneId = randomUUID();
      await pool.query(`INSERT INTO org_content_assignments
        (id,org_id,content_id,assignment_type,subject_user_id,created_by_actor_id,created_at)
        VALUES ($1,$2,$3,'organization',NULL,$4,NOW())`,
      [youtubeStandaloneId, org.id, youtubeItem.id, orgAdmin.id]);
      assert.equal((await scopedCall(transcriptPath, "PUT", { text: "Denied standalone mutation" })).status, 403);
      await pool.query(`UPDATE org_content_assignments SET revoked_at=NOW(),revoked_by_actor_id=$3
        WHERE org_id=$1 AND id=$2`, [org.id, youtubeStandaloneId, orgAdmin.id]);
      assert.equal((await scopedCall(transcriptPath, "PUT", {
        text: "PRIVATE_TRANSCRIPT_SENTINEL_EXCLUSIVE_AGAIN",
      })).status, 200);
      const removedTranscript = await orgAdminCall(centralTranscriptPath, "DELETE");
      assert.equal(removedTranscript.status, 200, JSON.stringify(removedTranscript.body));
      assert.equal(removedTranscript.body.transcript, null);
      assert.equal((removedTranscript.body.generationSource as { reasonCode: string }).reasonCode,
        "missing_transcript");
      assert.equal((await pool.query(
        `SELECT 1 FROM audit_events WHERE action IN
         ('training_content_transcript_added','training_content_transcript_replaced','training_content_transcript_removed')
         AND metadata::text LIKE '%PRIVATE_TRANSCRIPT%'`,
      )).rowCount, 0);

      const videoCreated = await scopedCall(topicContentPath, "POST", {
        contentType: "video", title: "Scoped video", description: "Finalization authority test",
      });
      assert.equal(videoCreated.status, 201, JSON.stringify(videoCreated.body));
      const videoItem = videoCreated.body.item as { id: string };
      const assetStore = createTrainingContentAssetStore({
        provider: "postgres",
        databaseUrl: url,
        pgPoolMax: 3,
        pgConnectTimeoutMs: 2_000,
        pgIdleTimeoutMs: 2_000,
        queryPool: pool,
      });
      const pendingVideo = await assetStore.createPendingAsset({
        orgId: org.id,
        contentId: videoItem.id,
        assetRole: "primary",
        originalFilename: "scoped-video.mp4",
        declaredMimeType: "video/mp4",
        fileExtension: "mp4",
        declaredByteSize: 8,
        replacementAssetId: null,
        uploadTtlSeconds: 600,
        maxPendingBytesForOrganization: 1_000_000,
        actor: { actorType: "web_user", actorId: scopedUserAdmin.id },
        authorizationScope: "focus_topic",
        authorizationTopicId: topic.id,
      });
      const queuedVideo = await assetStore.queueVideoProcessing({
        orgId: org.id,
        contentId: videoItem.id,
        assetId: pendingVideo.asset.id,
        actualByteSize: 8,
        detectedMimeType: "video/mp4",
        checksumOrEtag: "runtime-video-etag",
        actor: { actorType: "web_user", actorId: scopedUserAdmin.id },
      });
      assert.equal(queuedVideo.status, "queued");
      assert.ok(queuedVideo.asset.finalObjectKey);
      const sharedVideoAttachment = await orgAdminCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId: videoItem.id,
      });
      assert.equal(sharedVideoAttachment.status, 201, JSON.stringify(sharedVideoAttachment.body));
      await assert.rejects(
        assetStore.completeFinalization({
          orgId: org.id,
          contentId: videoItem.id,
          assetId: pendingVideo.asset.id,
          finalObjectKey: queuedVideo.asset.finalObjectKey!,
          actualByteSize: 8,
          detectedMimeType: "video/mp4",
          checksumOrEtag: "runtime-video-etag",
          actor: { actorType: "system", actorId: "training-content-video-worker" },
        }),
        (error: unknown) => error instanceof TrainingContentAssetStoreError
          && error.code === "asset_authority_denied",
      );
      assert.equal((await assetStore.getAssetForOrg(
        org.id, videoItem.id, pendingVideo.asset.id,
      ))?.uploadState, "processing");
      assert.equal((await orgAdminCall(
        `${unmanagedAttachmentsPath}/${sharedVideoAttachment.body.id as string}`, "DELETE",
      )).status, 200);
      const finalizedVideo = await assetStore.completeFinalization({
        orgId: org.id,
        contentId: videoItem.id,
        assetId: pendingVideo.asset.id,
        finalObjectKey: queuedVideo.asset.finalObjectKey!,
        actualByteSize: 8,
        detectedMimeType: "video/mp4",
        checksumOrEtag: "runtime-video-etag",
        actor: { actorType: "system", actorId: "training-content-video-worker" },
      });
      assert.equal(finalizedVideo.asset.uploadState, "ready");
      const videoBeforePublish = await scopedCall(attachmentsPath);
      const videoBeforePublishItem = (videoBeforePublish.body.contentItems as Array<{
        id: string; updatedAt: string;
      }>).find((entry) => entry.id === videoItem.id);
      assert.ok(videoBeforePublishItem);
      assert.equal((await scopedCall(`${topicContentPath}/${videoItem.id}/publish`, "POST", {
        expectedUpdatedAt: videoBeforePublishItem.updatedAt,
      })).status, 200);
      const videoBeforeTranscript = await scopedCall(attachmentsPath);
      assert.equal((videoBeforeTranscript.body.contentItems as Array<{
        id: string; generationSource: { reasonCode: string };
      }>).find((entry) => entry.id === videoItem.id)?.generationSource.reasonCode, "missing_transcript");
      const videoTranscriptPath = `${topicContentPath}/${videoItem.id}/transcript`;
      const videoWithTranscript = await scopedCall(videoTranscriptPath, "PUT", {
        text: "PRIVATE_VIDEO_TRANSCRIPT_SENTINEL",
      });
      assert.equal((videoWithTranscript.body.generationSource as { eligible: boolean }).eligible, true);
      const learnerWithVideoTranscript = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal(JSON.stringify(learnerWithVideoTranscript.body)
        .includes("PRIVATE_VIDEO_TRANSCRIPT_SENTINEL"), false);
      const replacementVideo = await assetStore.createPendingAsset({
        orgId: org.id, contentId: videoItem.id, assetRole: "primary",
        originalFilename: "replacement-video.mp4", declaredMimeType: "video/mp4",
        fileExtension: "mp4", declaredByteSize: 8, replacementAssetId: finalizedVideo.asset.id,
        uploadTtlSeconds: 600, maxPendingBytesForOrganization: 1_000_000,
        actor: { actorType: "web_user", actorId: scopedUserAdmin.id },
        authorizationScope: "focus_topic", authorizationTopicId: topic.id,
      });
      const queuedReplacementVideo = await assetStore.queueVideoProcessing({
        orgId: org.id, contentId: videoItem.id, assetId: replacementVideo.asset.id,
        actualByteSize: 8, detectedMimeType: "video/mp4", checksumOrEtag: "replacement-video-etag",
        actor: { actorType: "web_user", actorId: scopedUserAdmin.id },
      });
      const finalizedReplacementVideo = await assetStore.completeFinalization({
        orgId: org.id, contentId: videoItem.id, assetId: replacementVideo.asset.id,
        finalObjectKey: queuedReplacementVideo.asset.finalObjectKey!, actualByteSize: 8,
        detectedMimeType: "video/mp4", checksumOrEtag: "replacement-video-etag",
        actor: { actorType: "system", actorId: "training-content-video-worker" },
      });
      assert.equal(finalizedReplacementVideo.asset.isCurrent, true);
      const staleTranscript = await scopedCall(attachmentsPath);
      assert.equal((staleTranscript.body.contentItems as Array<{
        id: string; generationSource: { reasonCode: string };
      }>).find((entry) => entry.id === videoItem.id)?.generationSource.reasonCode, "missing_transcript");
      const replacementTranscript = await scopedCall(videoTranscriptPath, "PUT", {
        text: "CURRENT_VIDEO_TRANSCRIPT_SENTINEL",
      });
      assert.equal((replacementTranscript.body.generationSource as { eligible: boolean }).eligible, true);
      const videoWithoutTranscript = await scopedCall(videoTranscriptPath, "DELETE");
      assert.equal((videoWithoutTranscript.body.generationSource as { reasonCode: string }).reasonCode,
        "missing_transcript");

      const scopedCreated = await scopedCall(topicContentPath, "POST", {
        contentType: "pdf", title: "Scoped draft", description: "Initial description",
      });
      assert.equal(scopedCreated.status, 201, JSON.stringify(scopedCreated.body));
      const scopedCreatedItem = scopedCreated.body.item as {
        id: string; publicationState: string; updatedAt: string;
      };
      assert.equal(scopedCreatedItem.publicationState, "draft");
      const scopedCreatedContent = await pool.query<{
        publication_state: string; created_by_actor_id: string;
      }>(
        `SELECT publication_state,created_by_actor_id FROM org_content_items
         WHERE org_id=$1 AND id=$2`, [org.id, scopedCreatedItem.id],
      );
      assert.deepEqual(scopedCreatedContent.rows[0], {
        publication_state: "draft", created_by_actor_id: scopedUserAdmin.id,
      });
      assert.equal((await pool.query(
        `SELECT 1 FROM org_content_topic_attachments
         WHERE org_id=$1 AND content_id=$2 AND topic_id=$3 AND detached_at IS NULL`,
        [org.id, scopedCreatedItem.id, topic.id],
      )).rowCount, 1);
      assert.equal((await pool.query(
        `SELECT 1 FROM org_content_assignments
         WHERE org_id=$1 AND content_id=$2 AND revoked_at IS NULL`,
        [org.id, scopedCreatedItem.id],
      )).rowCount, 0);
      const draftLearnerDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal(draftLearnerDetail.status, 200);
      assert.equal((draftLearnerDetail.body.resources as Array<{ id: string }>)
        .some((entry) => entry.id === scopedCreatedItem.id), false);
      const scopedUpdatePath = `${topicContentPath}/${scopedCreatedItem.id}`;
      const firstUpdate = await scopedCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: scopedCreatedItem.updatedAt,
        title: "Scoped draft updated",
        description: "Updated description",
      });
      assert.equal(firstUpdate.status, 200, JSON.stringify(firstUpdate.body));
      let currentScopedUpdatedAt = ((firstUpdate.body.item as { updatedAt: string }).updatedAt);
      await pool.query(`INSERT INTO org_content_assets (
        id,org_id,content_id,asset_role,version,upload_state,storage_provider,
        final_object_key,original_filename,declared_mime_type,detected_mime_type,
        file_extension,declared_byte_size,byte_size,is_current,finalized_at,created_by_actor_id
      ) VALUES ($1,$2,$3,'primary',1,'ready','r2',$4,'scoped.pdf','application/pdf',
        'application/pdf','pdf',8,8,TRUE,NOW(),$5)`,
      [randomUUID(), org.id, scopedCreatedItem.id,
        `organizations/${org.id}/content/${scopedCreatedItem.id}/primary/1/scoped.pdf`,
        scopedUserAdmin.id]);
      const publishedScoped = await scopedCall(`${scopedUpdatePath}/publish`, "POST", {
        expectedUpdatedAt: currentScopedUpdatedAt,
      });
      assert.equal(publishedScoped.status, 200, JSON.stringify(publishedScoped.body));
      currentScopedUpdatedAt = ((publishedScoped.body.item as { updatedAt: string }).updatedAt);
      const publishedLearnerDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal((publishedLearnerDetail.body.resources as Array<{ id: string }>)
        .some((entry) => entry.id === scopedCreatedItem.id), true);
      const unpublishedScoped = await scopedCall(`${scopedUpdatePath}/unpublish`, "POST", {
        expectedUpdatedAt: currentScopedUpdatedAt,
      });
      assert.equal(unpublishedScoped.status, 200, JSON.stringify(unpublishedScoped.body));
      currentScopedUpdatedAt = ((unpublishedScoped.body.item as { updatedAt: string }).updatedAt);
      const standaloneId = randomUUID();
      await pool.query(`INSERT INTO org_content_assignments
        (id,org_id,content_id,assignment_type,subject_user_id,created_by_actor_id,created_at)
        VALUES ($1,$2,$3,'organization',NULL,$4,NOW())`,
      [standaloneId, org.id, scopedCreatedItem.id, orgAdmin.id]);
      const deniedByStandalone = await scopedCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: currentScopedUpdatedAt, title: "Denied shared edit",
      });
      assert.equal(deniedByStandalone.status, 403, JSON.stringify(deniedByStandalone.body));
      const adminSharedUpdate = await orgAdminCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: currentScopedUpdatedAt, title: "Organization Admin shared edit",
      });
      assert.equal(adminSharedUpdate.status, 200, JSON.stringify(adminSharedUpdate.body));
      currentScopedUpdatedAt = ((adminSharedUpdate.body.item as { updatedAt: string }).updatedAt);
      await pool.query(`UPDATE org_content_assignments SET revoked_at=NOW(),revoked_by_actor_id=$3
        WHERE org_id=$1 AND id=$2`, [org.id, standaloneId, orgAdmin.id]);
      const restoredUpdate = await scopedCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: currentScopedUpdatedAt, title: "Exclusive again",
      });
      assert.equal(restoredUpdate.status, 200, JSON.stringify(restoredUpdate.body));
      currentScopedUpdatedAt = ((restoredUpdate.body.item as { updatedAt: string }).updatedAt);
      const secondTopicAttachment = await orgAdminCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId: scopedCreatedItem.id,
      });
      assert.equal(secondTopicAttachment.status, 201, JSON.stringify(secondTopicAttachment.body));
      assert.equal((await scopedCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: currentScopedUpdatedAt, title: "Denied outside Topic scope",
      })).status, 403);
      assert.equal((await orgAdminCall(
        `${unmanagedAttachmentsPath}/${secondTopicAttachment.body.id as string}`, "DELETE",
      )).status, 200);
      assert.equal((await scopedCall(scopedUpdatePath, "PATCH", {
        expectedUpdatedAt: currentScopedUpdatedAt, title: "Scope restored",
      })).status, 200);
      for (const [path, method, body] of [
        ["/dashboard/admin/training-content", "POST", {}],
        [`/dashboard/admin/training-content/${contentId}`, "PATCH", {}],
        [`/dashboard/admin/training-content/${contentId}/publish`, "POST", {}],
        [`/dashboard/admin/training-content/${contentId}/archive`, "POST", {}],
        [`/dashboard/admin/training-content/${contentId}/assignments`, "PUT", {}],
        [`/dashboard/admin/training-content/${contentId}/assets/uploads`, "POST", {}],
      ] as const) {
        assert.equal((await scopedCall(path, method, body)).status, 403, `${method} ${path}`);
      }
      assert.equal((await scopedCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId,
      })).status, 404);
      const sharedAttachment = await orgAdminCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId,
      });
      assert.equal(sharedAttachment.status, 201, JSON.stringify(sharedAttachment.body));
      const scopedDetached = await scopedCall(
        `${attachmentsPath}/${sourceReattached.body.id as string}`, "DELETE",
      );
      assert.equal(scopedDetached.status, 200, JSON.stringify(scopedDetached.body));
      const attachmentRows = await pool.query<{ topic_id: string; detached_at: Date | null }>(
        `SELECT topic_id,detached_at FROM org_content_topic_attachments
         WHERE content_id=$1 ORDER BY topic_id`, [contentId],
      );
      assert.deepEqual(attachmentRows.rows.map((entry) => [entry.topic_id, Boolean(entry.detached_at)]), [
        [topic.id, true], [topic.id, true], [topic.id, true], [unmanagedTopic.id, false],
      ]);
      assert.equal((await pool.query(
        "SELECT 1 FROM audit_events WHERE action='focus_topic.content.attached'",
      )).rowCount, 8);
      assert.equal((await pool.query(
        "SELECT 1 FROM audit_events WHERE action='focus_topic.attachment.detached'",
      )).rowCount, 7);
      assert.ok(((await pool.query(
        "SELECT 1 FROM user_notifications WHERE kind='content_added' AND recipient_user_id=$1",
        [orgAdmin.id],
      )).rowCount ?? 0) >= 2);
      await moduleEntitlements.setOrgModuleEntitlement({
        orgId: org.id, moduleKey: "training_content", enabled: false,
        updatedByActorId: "platform_admin", updatedAt: new Date(),
      });
      assert.equal((await scopedCall(attachmentsPath, "POST", { kind: "content", contentId })).status, 403);
      assert.equal((await scopedCall(topicContentPath, "POST", {
        contentType: "pdf", title: "Module disabled", description: "",
      })).status, 403);
      await moduleEntitlements.setOrgModuleEntitlement({
        orgId: org.id, moduleKey: "training_content", enabled: true,
        updatedByActorId: "platform_admin", updatedAt: new Date(),
      });
      const learnerCreated = await masterCall(assignmentsPath, "POST", {
        audience: "organization", subjectUserId: null,
      });
      assert.equal(learnerCreated.status, 201, JSON.stringify(learnerCreated.body));
      const masterCreatedBody = learnerCreated.body;
      assert.equal(masterCreatedBody.grantsManagement, false);
      const createdId = masterCreatedBody.id as string;
      assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='focus_topic.assignment.created'")).rowCount, 4);
      assert.ok(((await pool.query("SELECT 1 FROM user_notifications WHERE kind='topic_assigned'")).rowCount ?? 0) >= 1);
      const duplicateAssignment = await masterCall(assignmentsPath, "POST", {
        audience: "organization", subjectUserId: null,
      });
      assert.equal(duplicateAssignment.status, 409, JSON.stringify(duplicateAssignment.body));
      assert.equal(duplicateAssignment.body.code, "focus_topic_assignment_already_active");
      assert.equal((await scopedCall(`${assignmentsPath}/${createdId}`, "DELETE")).status, 403);
      const masterRevoked = await masterCall(`${assignmentsPath}/${createdId}`, "DELETE");
      assert.equal(masterRevoked.status, 200, JSON.stringify(masterRevoked.body));
      assert.equal((await pool.query("SELECT 1 FROM focus_topic_assignments WHERE id=$1 AND revoked_at IS NOT NULL",
        [createdId])).rowCount, 1);
      const revokedManagement = await masterCall(
        `${managementPath}/${managementGrant.body.id as string}`,
        "DELETE",
      );
      assert.equal(revokedManagement.status, 200, JSON.stringify(revokedManagement.body));
      assert.equal((await scopedCall(transcriptPath, "PUT", {
        text: "Denied after management revoke",
      })).status, 404);
      const learnerAfterManagementRevoke = await fetch(
        `${base}/mobile/users/${scopedUserAdmin.id}/focus-topics`,
        { headers: { Authorization: `Bearer ${scopedMobileToken}` } },
      );
      assert.deepEqual(((await learnerAfterManagementRevoke.json()) as {
        topics: Array<{ id: string }>;
      }).topics.map((entry) => entry.id), [topic.id]);
      const staleScopedRequest = await scopedCall(`/orgs/${org.id}/trainings`);
      assert.equal(staleScopedRequest.status, 403, JSON.stringify(staleScopedRequest.body));
      const preRegrantSession = scopedWebAuth.issueSession(
        scopedUserAdmin, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(preRegrantSession.record);
      const regrantedManagement = await masterCall(managementPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id,
      });
      assert.equal(regrantedManagement.status, 201, JSON.stringify(regrantedManagement.body));
      assert.equal((await dashboardCall(
        preRegrantSession.token, `/orgs/${org.id}/trainings`,
      )).status, 200);
      const freshScopedSession = scopedWebAuth.issueSession(
        scopedUserAdmin, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(freshScopedSession.record);
      assert.equal((await dashboardCall(
        freshScopedSession.token, `/orgs/${org.id}/trainings`,
      )).status, 200);
      const learnerRevoked = await masterCall(
        `${assignmentsPath}/${scopedLearnerAssignment.body.id as string}`,
        "DELETE",
      );
      assert.equal(learnerRevoked.status, 200, JSON.stringify(learnerRevoked.body));
      const learnerAfterLearnerRevoke = await fetch(
        `${base}/mobile/users/${scopedUserAdmin.id}/focus-topics`,
        { headers: { Authorization: `Bearer ${scopedMobileToken}` } },
      );
      assert.deepEqual(((await learnerAfterLearnerRevoke.json()) as {
        topics: Array<{ id: string }>;
      }).topics, []);
      assert.equal((await dashboardCall(
        freshScopedSession.token, `/orgs/${org.id}/trainings`,
      )).status, 200);

      const prefetchSessionId = `prefetch_${randomUUID()}`;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (target === "https://api.openai.com/v1/responses") {
          return Promise.resolve(new Response(JSON.stringify({
            output_text: "Hello, let's begin.", model: "local-test-model",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(input, init);
      }) as typeof fetch;
      try {
        const installedOpening = await call(`/mobile/users/${user.id}/ai/opening`, {
          scenarioId: scenario.id, trainingId: null, simulationSessionId: `installed_${randomUUID()}`,
        });
        assert.equal(installedOpening.status, 200, JSON.stringify(installedOpening.body));
        const unattachedOpening = await call(`/mobile/users/${user.id}/ai/opening`, {
          scenarioId: unattachedScenario.id, trainingId: null, simulationSessionId: `unattached_${randomUUID()}`,
        });
        assert.equal(unattachedOpening.status, 404, JSON.stringify(unattachedOpening.body));
        const opening = await call(`/mobile/users/${user.id}/ai/opening`, {
          scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: prefetchSessionId,
        });
        assert.equal(opening.status, 200, JSON.stringify(opening.body));
        const unregistered = await pool.query("SELECT 1 FROM simulation_sessions WHERE simulation_session_id=$1",
          [prefetchSessionId]);
        assert.equal(unregistered.rowCount, 0);
      } finally { globalThis.fetch = originalFetch; }

      const startPath = `/mobile/users/${user.id}/simulation-sessions/start`;
      const startBody = (sessionId: string, trainingId: string | null) => ({
        simulationSessionId: sessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId, trainingPackId: "forged_pack", clientStartedAt: now,
      });
      const turnPath = `/mobile/users/${user.id}/ai/turn`;
      const turnBody = (sessionId: string) => ({ scenarioId: scenario.id,
        trainingId: topic.id, simulationSessionId: sessionId,
        difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
        history: [{ role: "user", content: "Let's agree on a plan for this work." }],
      });
      const unregisteredTurn = await withMockResponses("Let's agree on next steps.", () =>
        call(turnPath, turnBody(`unregistered_${randomUUID()}`)));
      assert.equal(unregisteredTurn.status, 404, JSON.stringify(unregisteredTurn.body));
      const forged = await call(startPath, startBody(`forged_${randomUUID()}`, "foreign_topic"));
      assert.equal(forged.status, 400, JSON.stringify(forged.body));
      const crossOrg = await call(startPath, startBody(`cross_org_${randomUUID()}`, foreignTopic.id));
      assert.equal(crossOrg.status, 400, JSON.stringify(crossOrg.body));
      const topicSessionId = `topic_${randomUUID()}`;
      const started = await call(startPath, startBody(topicSessionId, topic.id));
      assert.equal(started.status, 201, JSON.stringify(started.body));
      const firstTurn = await withMockResponses("Let's agree on next steps.", () =>
        call(turnPath, turnBody(topicSessionId)));
      assert.equal(firstTurn.status, 200, JSON.stringify(firstTurn.body));
      const recorded = await pool.query<{ training_id: string | null; training_pack_id: string | null }>(
        "SELECT training_id,training_pack_id FROM simulation_sessions WHERE simulation_session_id=$1", [topicSessionId]);
      assert.deepEqual(recorded.rows[0], { training_id: topic.id, training_pack_id: null });
      const generalSessionId = `general_${randomUUID()}`;
      assert.equal((await call(startPath, startBody(generalSessionId, null))).status, 201);
      const general = await pool.query<{ training_id: string | null }>(
        "SELECT training_id FROM simulation_sessions WHERE simulation_session_id=$1", [generalSessionId]);
      assert.equal(general.rows[0]?.training_id, null);

      await t.test("assignments general-catalog and registered NULL-snapshot cache parity across live industry changes", async () => {
        const alternate = db.config.industries.find((industry) => industry.enabled && industry.id !== snapshotIndustryId)!;
        assert.ok(alternate);
        await assertIndustryCacheParity({ mode: "assignments", storage,
          patch: (path, body) => masterCall(path, "PATCH", body),
          pool: pool!, call, userId: user.id, otherUserId: scopedUserAdmin.id, orgId: org.id, segmentId: segment.id, scenarioId: scenario.id,
          industryId: snapshotIndustryId, alternateIndustryId: alternate.id });
      });

      await t.test("older-client v1 opening cache cannot override registered v2 turns or scoring", async () => {
        const draft = { title: "Opening window", description: "OPENING_WINDOW_V1_CONTEXT",
          desiredOutcome: "OPENING_WINDOW_V1_OUTCOME", aiRole: "OPENING_WINDOW_V1_ROLE",
          scoringGuidance: "Observe the next step.", segmentId: segment.id,
          applicableIndustryIds: [org.activeIndustries[0]!] };
        const created = await orgAdminCall(practiceScenarioPath, "POST", draft);
        assert.equal(created.status, 201);
        const id = String(created.body.id);
        const path = `${practiceScenarioPath}/${id}`;
        const contains = async (label: string, expected: boolean) => {
          const config = await configParity(label);
          assert.equal((config.body.orgCustomScenarios as Array<{ id: string }>).some((row) => row.id === id), expected, label);
        };
        await contains("draft not published", false);
        assert.equal((await orgAdminCall(`${path}/submit`, "POST")).status, 200);
        await contains("submitted not published", false);
        assert.equal((await orgAdminCall(`${path}/approve`, "POST")).status, 200);
        await contains("approved not published", false);
        const v1 = await orgAdminCall(`${path}/publish`, "POST");
        assert.equal(v1.status, 200);
        await contains("published v1 visible", true);
        const sessionId = `opening_window_${randomUUID()}`;
        const prompts: string[] = [];
        const capture = (request: string) => {
          const parsed = JSON.parse(request) as { input: Array<{ content: string }> };
          prompts.push(parsed.input.map((message) => message.content).join("\n"));
        };
        const opening = await withMockResponses("What shall we discuss?", () => call(`/mobile/users/${user.id}/ai/opening`, {
          simulationSessionId: sessionId, scenarioId: id, trainingId: topic.id, industryId: org.activeIndustries[0],
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
        }), capture);
        assert.equal(opening.status, 200, JSON.stringify(opening.body));
        assert.match(prompts[0]!, /OPENING_WINDOW_V1_CONTEXT/);
        assert.equal((await pool!.query("SELECT 1 FROM simulation_sessions WHERE simulation_session_id=$1", [sessionId])).rowCount, 0);
        assert.equal((await orgAdminCall(`${path}/revisions`, "POST", { ...draft,
          description: "OPENING_WINDOW_V2_CONTEXT", desiredOutcome: "OPENING_WINDOW_V2_OUTCOME",
          aiRole: "OPENING_WINDOW_V2_ROLE" })).status, 200);
        assert.equal((await orgAdminCall(`${path}/submit`, "POST")).status, 200);
        assert.equal((await orgAdminCall(`${path}/approve`, "POST")).status, 200);
        const v2 = await orgAdminCall(`${path}/publish`, "POST");
        assert.equal(v2.status, 200);
        const v2Id = (v2.body.publishedVersion as { id: string }).id;
        assert.equal((await call(startPath, { simulationSessionId: sessionId, segmentId: segment.id,
          scenarioId: id, trainingId: topic.id, clientStartedAt: now })).status, 201);
        const turn = await withMockResponses("We should agree a plan.", () => call(turnPath, {
          simulationSessionId: sessionId, scenarioId: id, trainingId: topic.id, industryId: org.activeIndustries[0],
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Let us agree a plan." }],
        }), capture);
        assert.equal(turn.status, 200, JSON.stringify(turn.body));
        // Repeat the identical request after a forced cache miss. Both paths must
        // honor registration, even though this older client already heard v1.
        imported.clearSimulationRuntimeCacheForTest(sessionId);
        const coldTurn = await withMockResponses("We should agree a plan.", () => call(turnPath, {
          simulationSessionId: sessionId, scenarioId: id, trainingId: topic.id, industryId: org.activeIndustries[0],
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Let us agree a plan." }],
        }), capture);
        assert.equal(coldTurn.status, 200, JSON.stringify(coldTurn.body));
        const score = await withMockResponses(JSON.stringify({ communicationScore: 80, outcomeScore: 75,
          overallScore: 78, completionLevel: "complete", objectiveAchieved: true,
          persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8,
          strengths: ["Clear"], improvements: ["Close"], summary: "Agreed a plan." }),
        () => call(`/mobile/users/${user.id}/ai/score`, {
          simulationSessionId: sessionId, scenarioId: id, trainingId: topic.id,
          industryId: org.activeIndustries[0], startedAt: now, endedAt: new Date(Date.now() + 1000).toISOString(),
          history: [
            { role: "assistant", content: "What shall we discuss?" }, { role: "user", content: "Let us agree a plan." },
            { role: "assistant", content: "What needs doing?" }, { role: "user", content: "Identify a clear owner." },
            { role: "assistant", content: "What next?" }, { role: "user", content: "Review progress tomorrow." },
          ],
        }), capture);
        assert.equal(score.status, 201, JSON.stringify(score.body));
        assert.equal(prompts.length, 4);
        assert.equal(prompts[1], prompts[2], "registered hit/rebuild and miss produce identical AI context");
        for (const prompt of prompts.slice(1)) {
          assert.match(prompt, /OPENING_WINDOW_V2_CONTEXT/);
          assert.doesNotMatch(prompt, /OPENING_WINDOW_V1_CONTEXT|OPENING_WINDOW_V1_ROLE/);
        }
        assert.equal((await pool!.query("SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [sessionId])).rows[0].scenario_version_id, v2Id);
        assert.notEqual(v2Id, (v1.body.publishedVersion as { id: string }).id);
      });

      // Regression: a registered assignment session is permanently pinned to
      // its approved version even after a later revision is published.
      const pinnedV1Draft = {
        title: "Pinned V1 title", description: "PINNED_V1_RUNTIME_CONTENT must remain in the active session.",
        desiredOutcome: "PINNED_V1_DESIRED_OUTCOME", aiRole: "PINNED_V1_COUNTERPART_ROLE",
        scoringGuidance: "Score against PINNED_V1_RUNTIME_CONTENT.", segmentId: segment.id,
        applicableIndustryIds: [org.activeIndustries[0]!],
      };
      const pinnedCreated = await orgAdminCall(practiceScenarioPath, "POST", pinnedV1Draft);
      assert.equal(pinnedCreated.status, 201, JSON.stringify(pinnedCreated.body));
      const pinnedScenarioId = String(pinnedCreated.body.id);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/submit`, "POST")).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/approve`, "POST", { reviewNote: "v1" })).status, 200);
      const pinnedPublishedV1 = await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/publish`, "POST");
      assert.equal(pinnedPublishedV1.status, 200, JSON.stringify(pinnedPublishedV1.body));
      const pinnedV1Id = String((pinnedPublishedV1.body.publishedVersion as { id: string }).id);
      const pinnedSessionId = `pinned_customer_${randomUUID()}`;
      const pinnedTopicDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal(pinnedTopicDetail.status, 200, JSON.stringify(pinnedTopicDetail.body));
      assert.deepEqual((pinnedTopicDetail.body.scenarios as Array<{ id: string; source: string; trainingId: string | null }>)
        .filter((scenario) => scenario.id === pinnedScenarioId)
        .map((scenario) => [scenario.id, scenario.source, scenario.trainingId]),
      [[pinnedScenarioId, "custom", topic.id]]);
      const pinnedStarted = await call(startPath, {
        simulationSessionId: pinnedSessionId, segmentId: segment.id, scenarioId: pinnedScenarioId,
        trainingId: topic.id, clientStartedAt: now,
      });
      assert.equal(pinnedStarted.status, 201, JSON.stringify(pinnedStarted.body));
      assert.equal((await pool.query<{ scenario_version_id: string | null }>(
        "SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [pinnedSessionId],
      )).rows[0]?.scenario_version_id, pinnedV1Id);
      const pinnedV2Draft = {
        ...pinnedV1Draft, title: "Pinned V2 title", description: "PINNED_V2_RUNTIME_CONTENT must never enter the v1 session.",
        desiredOutcome: "PINNED_V2_DESIRED_OUTCOME", aiRole: "PINNED_V2_COUNTERPART_ROLE",
        scoringGuidance: "",
      };
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/revisions`, "POST", pinnedV2Draft)).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/submit`, "POST")).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/approve`, "POST", { reviewNote: "v2" })).status, 200);
      const pinnedPublishedV2 = await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/publish`, "POST");
      assert.equal(pinnedPublishedV2.status, 200, JSON.stringify(pinnedPublishedV2.body));
      const pinnedV2Id = String((pinnedPublishedV2.body.publishedVersion as { id: string }).id);
      await t.test("registered v1 opening survives v2 publication with identical hit/miss industry context", async () => {
        const before = (await pool!.query("SELECT industry_snapshot FROM simulation_sessions WHERE simulation_session_id=$1", [pinnedSessionId])).rows[0].industry_snapshot;
        assert.equal(before.selection.industryId, null, "registration does not assume the selected industry");
        const openingPrompts: string[] = [];
        const capture = (request: string) => {
          const parsed = JSON.parse(request) as { input: Array<{ content: string }> };
          openingPrompts.push(parsed.input.map((message) => message.content).join("\n"));
        };
        const body = { simulationSessionId: pinnedSessionId, scenarioId: pinnedScenarioId,
          trainingId: topic.id, industryId: org.activeIndustries[0],
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle };
        for (let index = 0; index < 3; index++) {
          if (index === 2) imported.clearSimulationRuntimeCacheForTest(pinnedSessionId);
          const opened = await withMockResponses("Pinned opening.", () => call(`/mobile/users/${user.id}/ai/opening`, body), capture);
          assert.equal(opened.status, 200, JSON.stringify(opened.body));
        }
        assert.equal(openingPrompts[0], openingPrompts[1], "cache hit preserves opening context");
        assert.equal(openingPrompts[0], openingPrompts[2], "cache miss preserves opening context");
        assert.match(openingPrompts[0]!, /PINNED_V1_RUNTIME_CONTENT/);
        assert.match(openingPrompts[0]!, /PINNED_V1_COUNTERPART_ROLE/);
        assert.ok(openingPrompts[0]!.includes(`Counterpart rule: you are speaking with a ${segment.label}; do not act as ${segment.label}.`));
        assert.match(openingPrompts[0]!, /SNAPSHOT_ORIGINAL_BASELINE/);
        assert.doesNotMatch(openingPrompts[0]!, /PINNED_V2_RUNTIME_CONTENT|PINNED_V2_COUNTERPART_ROLE/);
        const after = (await pool!.query("SELECT industry_snapshot,scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [pinnedSessionId])).rows[0];
        assert.equal(after.industry_snapshot.selection.industryId, org.activeIndustries[0]);
        assert.equal(after.scenario_version_id, pinnedV1Id);
      });
      const industryOnlySessionId = `industry_only_customer_${randomUUID()}`;
      const industryOnlyStarted = await call(startPath, {
        simulationSessionId: industryOnlySessionId, segmentId: segment.id, scenarioId: pinnedScenarioId,
        trainingId: topic.id, clientStartedAt: now,
      });
      assert.equal(industryOnlyStarted.status, 201, JSON.stringify(industryOnlyStarted.body));
      assert.equal((await pool.query<{ scenario_version_id: string | null }>(
        "SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [industryOnlySessionId],
      )).rows[0]?.scenario_version_id, pinnedV2Id);
      const pinnedRequests: Array<{ input?: Array<{ content?: string }> }> = [];
      const pinnedFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (target === "https://api.openai.com/v1/responses") {
          pinnedRequests.push(JSON.parse(String(init?.body)) as { input?: Array<{ content?: string }> });
          const output = pinnedRequests.length % 2 === 1 ? "Pinned scenario turn." : JSON.stringify({
            communicationScore: 80, outcomeScore: 75, overallScore: 78, completionLevel: "complete", objectiveAchieved: true,
            persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8, strengths: ["Clear framing"],
            improvements: ["Tighter close"], summary: "Handled the conversation well.",
          });
          return Promise.resolve(new Response(JSON.stringify({ output_text: output, model: "local-test-model", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return pinnedFetch(input, init);
      }) as typeof fetch;
      try {
        const pinnedTurn = await call(turnPath, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: pinnedSessionId,
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Let's discuss the current account." }],
        });
        assert.equal(pinnedTurn.status, 200, JSON.stringify(pinnedTurn.body));
        const pinnedScore = await call(`/mobile/users/${user.id}/ai/score`, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: pinnedSessionId,
          startedAt: now, endedAt: new Date(Date.now() + 1_000).toISOString(),
          history: [
            { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
            { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify the blocker." },
            { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose owners and a review date." },
          ],
        });
        assert.equal(pinnedScore.status, 201, JSON.stringify(pinnedScore.body));
        const industryOnlyTurn = await call(turnPath, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: industryOnlySessionId,
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Let's discuss the current account." }],
        });
        assert.equal(industryOnlyTurn.status, 200, JSON.stringify(industryOnlyTurn.body));
        const industryOnlyScore = await call(`/mobile/users/${user.id}/ai/score`, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: industryOnlySessionId,
          startedAt: now, endedAt: new Date(Date.now() + 2_000).toISOString(),
          history: [
            { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
            { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify the blocker." },
            { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose owners and a review date." },
          ],
        });
        assert.equal(industryOnlyScore.status, 201, JSON.stringify(industryOnlyScore.body));
      } finally { globalThis.fetch = pinnedFetch; }
      assert.equal(pinnedRequests.length, 4);
      const [runtimeRequest, scoringRequest, industryOnlyRuntimeRequest, industryOnlyScoringRequest] = pinnedRequests.map((request) =>
        request.input?.map((message) => message.content ?? "").join("\n") ?? "",
      );
      assert.match(runtimeRequest!, /PINNED_V1_RUNTIME_CONTENT/);
      assert.match(runtimeRequest!, /PINNED_V1_COUNTERPART_ROLE/);
      assert.ok(runtimeRequest!.includes(`Counterpart rule: you are speaking with a ${segment.label}; do not act as ${segment.label}.`));
      assert.match(runtimeRequest!, /SNAPSHOT_ORIGINAL_BASELINE/);
      assert.doesNotMatch(runtimeRequest!, /PINNED_V2_RUNTIME_CONTENT|PINNED_V2_COUNTERPART_ROLE/);
      assert.match(scoringRequest!, /PINNED_V1_RUNTIME_CONTENT/);
      assert.match(scoringRequest!, /PINNED_V1_DESIRED_OUTCOME/);
      assert.match(scoringRequest!, /SNAPSHOT_ORIGINAL_SCORING/);
      assert.doesNotMatch(scoringRequest!, /PINNED_V2_RUNTIME_CONTENT|PINNED_V2_DESIRED_OUTCOME/);
      assert.equal((await pool.query<{ scenario_version_id: string | null }>(
        "SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [pinnedSessionId],
      )).rows[0]?.scenario_version_id, pinnedV1Id);
      assert.equal((await pool.query("SELECT industry_id FROM score_records WHERE simulation_session_id=$1", [pinnedSessionId])).rows[0]?.industry_id,
        org.activeIndustries[0], "scoring retains the industry selected by the registered opening");
      assert.match(industryOnlyRuntimeRequest!, /PINNED_V2_RUNTIME_CONTENT/);
      assert.match(industryOnlyRuntimeRequest!, /PINNED_V2_COUNTERPART_ROLE/);
      assert.doesNotMatch(industryOnlyRuntimeRequest!, /Scenario coaching priorities|PINNED_V1_RUNTIME_CONTENT/);
      assert.match(industryOnlyScoringRequest!, /PINNED_V2_RUNTIME_CONTENT/);
      assert.match(industryOnlyScoringRequest!, /PINNED_V2_DESIRED_OUTCOME/);
      assert.match(industryOnlyScoringRequest!, /INDUSTRY STANDARD SCENARIO SCORING GUIDANCE/);
      assert.doesNotMatch(industryOnlyScoringRequest!, /CUSTOM SCENARIO SCORING GUIDANCE|PINNED_V1_RUNTIME_CONTENT/);
      assert.equal((await pool.query<{ scenario_version_id: string | null }>(
        "SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1", [industryOnlySessionId],
      )).rows[0]?.scenario_version_id, pinnedV2Id);

      // A recognized session retains its server-captured industry context after
      // the live definition changes. The fresh persona variant forces a runtime
      // cache miss.
      const originalIndustry = db.config.industries.find((entry) => entry.id === snapshotIndustryId);
      assert.ok(originalIndustry);
      const snapshotCustomerSessionId = `snapshot_customer_${randomUUID()}`;
      const snapshotStandardSessionId = `snapshot_standard_${randomUUID()}`;
      const snapshotUnversionedCustomSessionId = `snapshot_unversioned_custom_${randomUUID()}`;
      const parityLegacySessionId = `snapshot_parity_legacy_${randomUUID()}`;
      const parityLegacyColdSessionId = `snapshot_parity_legacy_cold_${randomUUID()}`;
      assert.equal((await call(startPath, {
        simulationSessionId: snapshotCustomerSessionId, segmentId: segment.id, scenarioId: pinnedScenarioId,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      assert.equal((await call(startPath, {
        simulationSessionId: snapshotStandardSessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      assert.equal((await call(startPath, {
        simulationSessionId: snapshotUnversionedCustomSessionId, segmentId: segment.id,
        scenarioId: snapshotCustomScenarioId, trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      assert.equal((await call(startPath, {
        simulationSessionId: parityLegacySessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      await pool.query("UPDATE simulation_sessions SET industry_snapshot=NULL WHERE simulation_session_id=$1", [parityLegacySessionId]);
      assert.equal((await call(startPath, {
        simulationSessionId: parityLegacyColdSessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      await pool.query("UPDATE simulation_sessions SET industry_snapshot=NULL WHERE simulation_session_id=$1", [parityLegacyColdSessionId]);
      // Existing snapshots predate scenarioKind. Remove it from one persisted
      // snapshot to prove its current, unambiguous org scenario still resolves.
      await pool.query(
        "UPDATE simulation_sessions SET industry_snapshot=industry_snapshot - 'scenarioKind' WHERE simulation_session_id=$1",
        [snapshotUnversionedCustomSessionId],
      );
      const snapshotV3Draft = {
        ...pinnedV2Draft,
        title: "Snapshot V3 title",
        description: "SNAPSHOT_V3_RUNTIME_CONTENT must never enter the v2 session.",
        desiredOutcome: "SNAPSHOT_V3_DESIRED_OUTCOME",
        aiRole: "SNAPSHOT_V3_COUNTERPART_ROLE",
      };
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/revisions`, "POST", snapshotV3Draft)).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/submit`, "POST")).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/approve`, "POST", { reviewNote: "v3" })).status, 200);
      assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/publish`, "POST")).status, 200);
      const unauthorizedScoreResponse = await fetch(
        `${base}/mobile/users/${scopedUserAdmin.id}/ai/score`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${scopedMobileToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioId: pinnedScenarioId, trainingId: topic.id,
            simulationSessionId: snapshotCustomerSessionId, industryId: snapshotIndustryId,
            startedAt: now, endedAt: new Date(Date.now() + 1_000).toISOString(),
            history: [
              { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand." },
              { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify it." },
              { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose next steps." },
            ],
          }),
        },
      );
      assert.equal(unauthorizedScoreResponse.status, 404);
      assert.equal((await pool.query<{ locked_industry: string | null }>(
        "SELECT industry_snapshot #>> '{selection,industryId}' AS locked_industry FROM simulation_sessions WHERE simulation_session_id=$1",
        [snapshotCustomerSessionId],
      )).rows[0]?.locked_industry, null);
      const snapshotRequests: string[] = [];
      const snapshotSystemRequests: string[] = [];
      const snapshotCacheEvents: Array<{ cacheStatus?: string }> = [];
      const postDeactivationRequests: string[] = [];
      let capturePostDeactivationRequests = false;
      const snapshotFetch = globalThis.fetch;
      const snapshotLog = console.log;
      console.log = (...args: unknown[]) => {
        const event = args[1] as { route?: string; cacheStatus?: string } | undefined;
        if (args[0] === "[simulation-route]" && event?.route === "turn" && event.cacheStatus) snapshotCacheEvents.push(event);
        snapshotLog(...args);
      };
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (target === "https://api.openai.com/v1/responses") {
          const parsed = JSON.parse(String(init?.body)) as { input?: Array<{ role?: string; content?: string }> };
          const prompt = parsed.input?.map((message) => message.content ?? "").join("\n") ?? "";
          snapshotRequests.push(prompt);
          snapshotSystemRequests.push(parsed.input?.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n") ?? "");
          if (capturePostDeactivationRequests) {
            postDeactivationRequests.push(prompt);
          }
          const output = prompt.includes("expert communication coach")
            ? JSON.stringify({ communicationScore: 80, outcomeScore: 75, overallScore: 78,
              completionLevel: "complete", objectiveAchieved: true, persuasion: 8, clarity: 7,
              empathy: 9, assertiveness: 8, strengths: ["Clear framing"], improvements: ["Tighter close"],
              summary: "Handled the conversation well." })
            : "Snapshot continuation response.";
          return Promise.resolve(new Response(JSON.stringify({ output_text: output, model: "local-test-model",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }),
          { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return snapshotFetch(input, init);
      }) as typeof fetch;
      try {
        for (const [simulationSessionId, scenarioId] of [
          [snapshotCustomerSessionId, pinnedScenarioId],
          [snapshotStandardSessionId, scenario.id],
        ]) {
          const locked = await call(turnPath, {
            scenarioId, trainingId: topic.id, simulationSessionId, industryId: snapshotIndustryId,
            difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
            history: [{ role: "user", content: "Please help with the account." }],
          });
          assert.equal(locked.status, 200, JSON.stringify(locked.body));
        }
        const autoLockedCustom = await call(turnPath, {
          scenarioId: snapshotCustomScenarioId, trainingId: topic.id,
          simulationSessionId: snapshotUnversionedCustomSessionId,
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Please help with the unversioned scenario." }],
        });
        assert.equal(autoLockedCustom.status, 200, JSON.stringify(autoLockedCustom.body));
        const parityLegacyTurn = await call(turnPath, {
          scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: parityLegacySessionId,
          industryId: snapshotIndustryId, difficulty: db.config.defaultDifficulty,
          personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Please help with the account." }],
        });
        assert.equal(parityLegacyTurn.status, 200, JSON.stringify(parityLegacyTurn.body));
        assert.equal(snapshotRequests[1], snapshotRequests[3]);
        const parityScoreBody = {
          scenarioId: scenario.id, trainingId: topic.id, industryId: snapshotIndustryId,
          startedAt: now, endedAt: new Date(Date.now() + 2_500).toISOString(),
          history: [
            { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
            { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify the blocker." },
            { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose owners and a review date." },
          ],
        };
        const snapshotParityScore = await call(`/mobile/users/${user.id}/ai/score`, {
          ...parityScoreBody, simulationSessionId: snapshotStandardSessionId,
        });
        assert.equal(snapshotParityScore.status, 201, JSON.stringify(snapshotParityScore.body));
        const legacyParityScore = await call(`/mobile/users/${user.id}/ai/score`, {
          ...parityScoreBody, simulationSessionId: parityLegacySessionId,
        });
        assert.equal(legacyParityScore.status, 201, JSON.stringify(legacyParityScore.body));
        assert.equal(snapshotRequests[4], snapshotRequests[5]);
        const conflictingSelection = await call(turnPath, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: snapshotCustomerSessionId,
          industryId: "invalid_industry", difficulty: db.config.defaultDifficulty,
          personaStyle: db.config.defaultPersonaStyle,
          history: [{ role: "user", content: "Please help with the account." }],
        });
        assert.equal(conflictingSelection.status, 400, JSON.stringify(conflictingSelection.body));
        const snapshots = await pool.query<{
          simulation_session_id: string;
          industry_snapshot: {
            selection?: { industryId?: string };
            eligibleIndustries?: Array<{
              id?: string;
              promptBaseline?: string;
              rawScoringAiBaseline?: string;
              standardScoringGuidance?: string;
            }>;
          };
        }>(
          "SELECT simulation_session_id,industry_snapshot FROM simulation_sessions WHERE simulation_session_id = ANY($1::text[])",
          [[snapshotCustomerSessionId, snapshotStandardSessionId, snapshotUnversionedCustomSessionId]],
        );
        assert.equal(snapshots.rows.length, 3);
        assert.deepEqual(snapshots.rows.map((row) => row.industry_snapshot.selection?.industryId).sort(),
          [snapshotIndustryId, snapshotIndustryId, snapshotIndustryId]);
        assert.equal(snapshots.rows.every((row) => row.industry_snapshot.eligibleIndustries?.some((industry) =>
          industry.id === snapshotIndustryId
          && industry.promptBaseline === "SNAPSHOT_ORIGINAL_BASELINE"
          && industry.rawScoringAiBaseline === "SNAPSHOT_ORIGINAL_BASELINE"
          && industry.standardScoringGuidance === "SNAPSHOT_ORIGINAL_SCORING",
        )), true);
        const alternateIndustry = db.config.industries.find((industry) => industry.enabled && industry.id !== snapshotIndustryId);
        assert.ok(alternateIndustry);
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [alternateIndustry.id] })).status, 200);
        const deactivatedDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
        assert.equal(deactivatedDetail.status, 200);
        assert.equal((deactivatedDetail.body.scenarios as Array<{ id: string }>).some((entry) =>
          entry.id === pinnedScenarioId || entry.id === snapshotCustomScenarioId), false);
        const deactivatedManagement = await orgAdminCall(practiceScenarioPath);
        assert.equal((deactivatedManagement.body.historicalIndustryLabels as Array<{ id: string; label: string }>)
          .find((industry) => industry.id === snapshotIndustryId)?.label, originalIndustry.label);
        assert.equal((await call(startPath, {
          simulationSessionId: `stale_industry_${randomUUID()}`, segmentId: segment.id,
          scenarioId: pinnedScenarioId, trainingId: topic.id,
        })).status, 400);
        const staleSession = `unregistered_stale_${randomUUID()}`;
        const staleHistory = [
          { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
          { role: "assistant", content: "We need a plan." }, { role: "user", content: "Let us identify the blocker." },
          { role: "assistant", content: "And next?" }, { role: "user", content: "I propose owners and a review date." },
        ];
        const beforeStaleRequests = snapshotRequests.length;
        assert.equal((await call(turnPath, { scenarioId: pinnedScenarioId, trainingId: topic.id,
          simulationSessionId: staleSession, industryId: snapshotIndustryId,
          difficulty: db.config.defaultDifficulty, personaStyle: db.config.defaultPersonaStyle, history: staleHistory })).status, 404);
        assert.equal((await call(`/mobile/users/${user.id}/ai/score`, {
          scenarioId: pinnedScenarioId, trainingId: topic.id, simulationSessionId: staleSession,
          industryId: snapshotIndustryId, history: staleHistory, startedAt: now,
          endedAt: new Date(Date.now() + 3000).toISOString(),
        })).status, 404);
        assert.equal(snapshotRequests.length, beforeStaleRequests);
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config.industries = state.config.industries.map((entry) => entry.id === snapshotIndustryId
            ? { ...entry, enabled: false,
                aiBaseline: "SNAPSHOT_MUTATED_BASELINE",
                standardScoringGuidance: "SNAPSHOT_MUTATED_SCORING" }
            : entry);
          return { result: undefined, shouldSave: true, state };
        });
        capturePostDeactivationRequests = true;
        for (const [simulationSessionId, scenarioId] of [
          [snapshotCustomerSessionId, pinnedScenarioId],
          [snapshotStandardSessionId, scenario.id],
        ]) {
          const continuationBody = {
            scenarioId, trainingId: topic.id, simulationSessionId, industryId: snapshotIndustryId,
            industryBaseline: "CLIENT BASELINE MUST NOT OVERRIDE SERVER SNAPSHOT",
            difficulty: db.config.defaultDifficulty, personaStyle: "defensive",
            history: [{ role: "user", content: "Please help with the account." }],
          };
          const continued = await call(turnPath, continuationBody);
          assert.equal(continued.status, 200, JSON.stringify(continued.body));
          assert.equal(snapshotCacheEvents.at(-1)?.cacheStatus, "miss");
          const missSystem = snapshotSystemRequests.at(-1)!;
          assert.match(missSystem, /SNAPSHOT_ORIGINAL_BASELINE/);
          const continuedHit = await call(turnPath, continuationBody);
          assert.equal(continuedHit.status, 200, JSON.stringify(continuedHit.body));
          assert.equal(snapshotCacheEvents.at(-1)?.cacheStatus, "hit");
          assert.equal(snapshotSystemRequests.at(-1), missSystem, "snapshot cache hit and miss system prompts remain byte-identical after deactivation");
          const scored = await call(`/mobile/users/${user.id}/ai/score`, {
            scenarioId, trainingId: topic.id, simulationSessionId, industryId: snapshotIndustryId,
            startedAt: now, endedAt: new Date(Date.now() + 3_000).toISOString(),
            history: [
              { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
              { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify the blocker." },
              { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose owners and a review date." },
            ],
          });
          assert.equal(scored.status, 201, JSON.stringify(scored.body));
        }
        const unversionedContinued = await call(turnPath, {
          scenarioId: snapshotCustomScenarioId, trainingId: topic.id,
          simulationSessionId: snapshotUnversionedCustomSessionId,
          difficulty: db.config.defaultDifficulty, personaStyle: "defensive",
          history: [{ role: "user", content: "Continue the original unversioned scenario." }],
        });
        assert.equal(unversionedContinued.status, 200, JSON.stringify(unversionedContinued.body));
        const unversionedScored = await call(`/mobile/users/${user.id}/ai/score`, {
          scenarioId: snapshotCustomScenarioId, trainingId: topic.id,
          simulationSessionId: snapshotUnversionedCustomSessionId,
          startedAt: now, endedAt: new Date(Date.now() + 4_000).toISOString(),
          history: [
            { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
            { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify the blocker." },
            { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose owners and a review date." },
          ],
        });
        assert.equal(unversionedScored.status, 201, JSON.stringify(unversionedScored.body));
        assert.equal((await pool.query<{ industry_id: string | null }>(
          "SELECT industry_id FROM score_records WHERE simulation_session_id=$1",
          [snapshotUnversionedCustomSessionId],
        )).rows[0]?.industry_id, snapshotIndustryId);
        assert.deepEqual((await pool.query<{ scenario_version_id: string | null }>(
          "SELECT scenario_version_id FROM simulation_sessions WHERE simulation_session_id=$1",
          [snapshotCustomerSessionId],
        )).rows[0], { scenario_version_id: pinnedV2Id });
        assert.equal((await pool.query<{ industry_id: string | null }>(
          "SELECT industry_id FROM score_records WHERE simulation_session_id=$1",
          [snapshotCustomerSessionId],
        )).rows[0]?.industry_id, snapshotIndustryId);
        assert.equal((await pool.query<{ industry_id: string | null }>(
          "SELECT industry_id FROM score_records WHERE simulation_session_id=$1",
          [snapshotStandardSessionId],
        )).rows[0]?.industry_id, snapshotIndustryId);
        const postDeactivationRoleplay = postDeactivationRequests.filter((prompt) => !prompt.includes("expert communication coach"));
        const postDeactivationScoring = postDeactivationRequests.filter((prompt) => prompt.includes("expert communication coach"));
        assert.equal(postDeactivationRoleplay.length, 5);
        assert.equal(postDeactivationScoring.length, 3);
        assert.equal(postDeactivationRoleplay.every((prompt) => prompt.includes("SNAPSHOT_ORIGINAL_BASELINE")), true);
        assert.equal(postDeactivationRoleplay.every((prompt) => prompt.includes(originalIndustry.label)), true);
        assert.equal(postDeactivationScoring.every((prompt) => prompt.includes("SNAPSHOT_ORIGINAL_BASELINE")), true);
        assert.equal(postDeactivationScoring.every((prompt) => prompt.includes("SNAPSHOT_ORIGINAL_SCORING")), true);
        assert.equal(postDeactivationScoring.every((prompt) => prompt.includes(originalIndustry.label)), true);
        assert.equal(postDeactivationRequests.some((prompt) => prompt.includes("SNAPSHOT_MUTATED_BASELINE")), false);
        assert.equal(postDeactivationRequests.some((prompt) => prompt.includes("SNAPSHOT_MUTATED_SCORING")), false);
        assert.equal(postDeactivationRequests.some((prompt) => prompt.includes("CLIENT BASELINE MUST NOT OVERRIDE SERVER SNAPSHOT")), false);
        assert.equal(postDeactivationRequests.some((prompt) => /SNAPSHOT_V3_RUNTIME_CONTENT|SNAPSHOT_V3_COUNTERPART_ROLE/.test(prompt)), false);
        assert.equal(postDeactivationRequests.some((prompt) => prompt.includes("UNVERSIONED_CUSTOM_RUNTIME_MARKER")), true);
        assert.equal(postDeactivationRequests.some((prompt) => prompt.includes("UNVERSIONED_CUSTOM_SCORING_GUIDANCE")), true);
        assert.equal(snapshotRequests.filter((prompt) => prompt.includes("expert communication coach")).length, 5);
        const beforeDeniedRequests = snapshotRequests.length;
        // A NULL-snapshot registered session must revalidate current scenario
        // eligibility on both hits and misses, unlike durable snapshot sessions.
        for (const simulationSessionId of [parityLegacySessionId, parityLegacyColdSessionId]) {
          const deniedTurn = await call(turnPath, {
            scenarioId: scenario.id, trainingId: topic.id, simulationSessionId,
            industryId: snapshotIndustryId, difficulty: db.config.defaultDifficulty,
            personaStyle: db.config.defaultPersonaStyle,
            history: [{ role: "user", content: "Please help with the account." }],
          });
          assert.equal(deniedTurn.status, 400, JSON.stringify(deniedTurn.body));
          const deniedScore = await call(`/mobile/users/${user.id}/ai/score`, { ...parityScoreBody, simulationSessionId });
          assert.equal(deniedScore.status, 400, JSON.stringify(deniedScore.body));
        }
        // Valid credentials for a different user cannot replay a cached,
        // authorized snapshot session through either provider route.
        for (const route of ["turn", "score"]) {
          const replay = await fetch(`${base}/mobile/users/${scopedUserAdmin.id}/ai/${route}`, {
            method: "POST", headers: { Authorization: `Bearer ${scopedMobileToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...parityScoreBody, simulationSessionId: snapshotStandardSessionId,
              difficulty: db.config.defaultDifficulty, personaStyle: "defensive" }),
          });
          assert.equal(replay.status, 404);
        }
        assert.equal(snapshotRequests.length, beforeDeniedRequests, "denied NULL-snapshot/replayed sessions never reach the provider");
      } finally {
        globalThis.fetch = snapshotFetch;
        console.log = snapshotLog;
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config.industries = state.config.industries.map((entry) => entry.id === snapshotIndustryId
            ? originalIndustry
            : entry);
          return { result: undefined, shouldSave: true, state };
        });
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: org.activeIndustries })).status, 200);
      }
      const reactivatedDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal((reactivatedDetail.body.scenarios as Array<{ id: string }>).some((entry) => entry.id === pinnedScenarioId), true);
      const emptyIndustrySessionId = `snapshot_empty_${randomUUID()}`;
      assert.equal((await call(startPath, {
        simulationSessionId: emptyIndustrySessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      await pool.query(
        "UPDATE simulation_sessions SET industry_snapshot=$2::jsonb WHERE simulation_session_id=$1",
        [emptyIndustrySessionId, JSON.stringify({
          version: 1, capturedAt: now, scenarioKind: "standard", eligibleIndustries: [],
          selection: { industryId: null, lockedAt: null },
        })],
      );
      const emptyIndustryTurn = await withMockResponses("Empty-industry continuation.", () => call(turnPath, {
        scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: emptyIndustrySessionId,
        difficulty: db.config.defaultDifficulty, personaStyle: "skeptical",
        history: [{ role: "user", content: "Continue without an industry." }],
      }));
      assert.equal(emptyIndustryTurn.status, 200, JSON.stringify(emptyIndustryTurn.body));

      const legacyNullSessionId = `snapshot_legacy_null_${randomUUID()}`;
      assert.equal((await call(startPath, {
        simulationSessionId: legacyNullSessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      await pool.query(
        "UPDATE simulation_sessions SET industry_snapshot=NULL WHERE simulation_session_id=$1",
        [legacyNullSessionId],
      );
      const legacyNullTurn = await withMockResponses("Legacy continuation.", () => call(turnPath, {
        scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: legacyNullSessionId,
        difficulty: db.config.defaultDifficulty, personaStyle: "skeptical",
        history: [{ role: "user", content: "Continue the legacy session." }],
      }));
      assert.equal(legacyNullTurn.status, 200, JSON.stringify(legacyNullTurn.body));

      const malformedSnapshotSessionId = `snapshot_malformed_${randomUUID()}`;
      assert.equal((await call(startPath, {
        simulationSessionId: malformedSnapshotSessionId, segmentId: segment.id, scenarioId: scenario.id,
        trainingId: topic.id, clientStartedAt: now,
      })).status, 201);
      await pool.query(
        "UPDATE simulation_sessions SET industry_snapshot='{\"version\":999}'::jsonb WHERE simulation_session_id=$1",
        [malformedSnapshotSessionId],
      );
      const malformedTurn = await call(turnPath, {
        scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: malformedSnapshotSessionId,
        difficulty: db.config.defaultDifficulty, personaStyle: "skeptical",
        history: [{ role: "user", content: "This must fail safely." }],
      });
      assert.equal(malformedTurn.status, 409, JSON.stringify(malformedTurn.body));
      assert.equal(malformedTurn.body.error, "Simulation session industry context is invalid.");
      const malformedScore = await call(`/mobile/users/${user.id}/ai/score`, {
        scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: malformedSnapshotSessionId,
        startedAt: now, endedAt: new Date(Date.now() + 5_000).toISOString(),
        history: [
          { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand." },
          { role: "assistant", content: "The team is behind." }, { role: "user", content: "Let us identify it." },
          { role: "assistant", content: "We need a plan." }, { role: "user", content: "I propose next steps." },
        ],
      });
      assert.equal(malformedScore.status, 409, JSON.stringify(malformedScore.body));
      assert.equal(malformedScore.body.error, "Simulation session industry context is invalid.");
      const unclaimedCustomScore = await call(`/mobile/users/${user.id}/ai/score`, {
        scenarioId: customScenarioId, startedAt: now, endedAt: new Date(Date.now() + 1000).toISOString(),
        history: [
          { role: "assistant", content: "What concerns you?" },
          { role: "user", content: "I want to understand the concern." },
          { role: "assistant", content: "The team is behind." },
          { role: "user", content: "Let us identify the blocker." },
          { role: "assistant", content: "We need a plan." },
          { role: "user", content: "I propose owners and a review date." },
        ],
      });
      assert.equal(unclaimedCustomScore.status, 404, JSON.stringify(unclaimedCustomScore.body));

      // Organization industry authority is exercised through real HTTP routes
      // and durable scenario versions, without changing historical versions/scores.
      const industryStateBefore = await storage.load();
      const originalIndustryIds = [...industryStateBefore.orgs.find((row) => row.id === org.id)!.activeIndustries];
      const originalConfig = structuredClone(industryStateBefore.config);
      const originalCustom = structuredClone(industryStateBefore.orgs.find((row) => row.id === org.id)!.customScenarios);
      const altIndustryId = "integration_second_industry";
      const unrelatedIndustryId = "integration_foreign_industry";
      const restrictedRoleId = "integration_restricted_role";
      const restrictedStandardId = "integration_restricted_standard";
      const expandedCustomId = "integration_role_expanding_custom";
      const historicalScoresBefore = (await pool.query("SELECT * FROM score_records ORDER BY id")).rows;
      try {
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config.industries.push(
            { id: altIndustryId, label: "Second organization industry", enabled: true },
            { id: unrelatedIndustryId, label: "Other organization industry", enabled: true },
          );
          state.config.roleIndustries.push(
            { roleId: segment.id, industryId: altIndustryId, active: true },
            { roleId: restrictedRoleId, industryId: unrelatedIndustryId, active: true },
          );
          state.config.segments.push({ id: restrictedRoleId, label: "Restricted role", summary: "Test", enabled: true,
            scenarios: [{ id: restrictedStandardId, segmentId: restrictedRoleId, title: "Must stay hidden",
              description: "Not authorized by the organization industry set", aiRole: "Counterpart", enabled: true }] });
          state.orgs.find((row) => row.id === org.id)!.customScenarios!.push({
            ...org.customScenarios![0]!, id: expandedCustomId, segmentId: restrictedRoleId,
            applicableIndustryIds: [snapshotIndustryId], enabled: true,
          });
          return { result: undefined, shouldSave: true, state };
        });
        // An HTTP read refreshes the API process after direct fixture writes.
        assert.equal((await orgAdminCall(practiceScenarioPath)).status, 200);
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [] })).status, 400);
        assert.equal((await masterCall("/orgs", "POST", { name: "Empty industry rejected", activeIndustries: [] })).status, 400);
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [snapshotIndustryId, altIndustryId] })).status, 200);
        assert.equal((await orgAdminCall(`/dashboard/admin/users/${secondReport.id}?orgId=${org.id}`, "PATCH", {
          managerUserId: scopedManager.id,
        })).status, 200);
        const currentManagerCall = (path: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>) =>
          dashboardCall(manualDashboardSession.token, path, method, body);
        for (const authorCall of [orgAdminCall, currentManagerCall]) {
          const options = await authorCall(practiceScenarioPath);
          assert.equal(options.status, 200, JSON.stringify(options.body));
          assert.deepEqual((options.body.industryOptions as Array<{ id: string }>).map((row) => row.id).sort(),
            [snapshotIndustryId, altIndustryId].sort());
          assert.equal((options.body.roleOptions as Array<{ id: string }>).some((row) => row.id === restrictedRoleId), false);
          for (const ids of [[unrelatedIndustryId], [snapshotIndustryId, unrelatedIndustryId], []]) {
            const denied = await authorCall(practiceScenarioPath, "POST", { ...pinnedV1Draft, applicableIndustryIds: ids });
            assert.equal(denied.status, 400, JSON.stringify(denied.body));
          }
          assert.equal((await authorCall(practiceScenarioPath, "POST", {
            ...pinnedV1Draft, segmentId: restrictedRoleId,
          })).status, 400);
        }
        const managerIndustryDraft = await currentManagerCall(practiceScenarioPath, "POST", pinnedV1Draft);
        assert.equal(managerIndustryDraft.status, 201, JSON.stringify(managerIndustryDraft.body));
        assert.equal((await currentManagerCall(
          `${practiceScenarioPath}/${managerIndustryDraft.body.id}/revisions`, "POST",
          { ...pinnedV1Draft, applicableIndustryIds: [snapshotIndustryId, unrelatedIndustryId] },
        )).status, 400);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${pinnedScenarioId}/revisions`, "POST", {
          ...pinnedV1Draft, applicableIndustryIds: [unrelatedIndustryId],
        })).status, 400);
        assert.equal((await orgAdminCall(`/orgs/${foreignOrg.id}/trainings/${foreignTopic.id}/practice-scenarios`)).status, 404);

        const masterDraft = { ...pinnedV1Draft, title: "Master valid industry", enabled: true };
        for (const path of [`/orgs/${org.id}/custom-scenarios`, `/orgs/${org.id}/custom-scenarios/generate`]) {
          for (const ids of [[unrelatedIndustryId], [snapshotIndustryId, unrelatedIndustryId]]) {
            assert.equal((await masterCall(path, "POST", { ...masterDraft, applicableIndustryIds: ids })).status, 400);
          }
          assert.equal((await masterCall(path, "POST", { ...masterDraft, segmentId: restrictedRoleId })).status, 400);
        }
        const masterCreated = await masterCall(`/orgs/${org.id}/custom-scenarios`, "POST", masterDraft);
        assert.equal(masterCreated.status, 201, JSON.stringify(masterCreated.body));
        const masterBeforeInvalidPatch = (await masterCall(`/orgs/${org.id}/custom-scenarios`, "GET")).body;
        assert.deepEqual((masterBeforeInvalidPatch.effectiveIndustryIds as string[]).sort(), [snapshotIndustryId, altIndustryId].sort());
        assert.equal((await masterCall(`/orgs/${org.id}/custom-scenarios/${masterCreated.body.id}`, "PATCH", {
          applicableIndustryIds: [snapshotIndustryId, unrelatedIndustryId], title: "Must not persist",
        })).status, 400);
        assert.deepEqual((await masterCall(`/orgs/${org.id}/custom-scenarios`, "GET")).body.scenarios, masterBeforeInvalidPatch.scenarios);
        await withMockScenarioGeneration(async (calls) => {
          const masterGenerated = await masterCall(`/orgs/${org.id}/custom-scenarios/generate`, "POST", masterDraft);
          assert.equal(masterGenerated.status, 200, JSON.stringify(masterGenerated.body));
          assert.equal(calls.value, 1);
        });

        const partialCreated = await orgAdminCall(practiceScenarioPath, "POST", {
          ...pinnedV1Draft, title: "Partial industry availability", applicableIndustryIds: [snapshotIndustryId, altIndustryId],
        });
        assert.equal(partialCreated.status, 201, JSON.stringify(partialCreated.body));
        const partialId = String(partialCreated.body.id);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${partialId}/submit`, "POST")).status, 200);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${partialId}/approve`, "POST")).status, 200);
        // Deactivate one industry before publication: the other keeps it usable.
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [snapshotIndustryId] })).status, 200);
        const partialPublished = await orgAdminCall(`${practiceScenarioPath}/${partialId}/publish`, "POST");
        assert.equal(partialPublished.status, 200, JSON.stringify(partialPublished.body));
        const publishedVersionBefore = (await pool.query(
          "SELECT * FROM customer_practice_scenario_versions WHERE id=$1", [(partialPublished.body.currentVersion as { id: string }).id],
        )).rows[0];
        const partialStartId = `partial_industry_${randomUUID()}`;
        assert.equal((await call(startPath, { simulationSessionId: partialStartId, segmentId: segment.id,
          scenarioId: partialId, trainingId: topic.id })).status, 201);
        const partialSnapshot = (await pool.query<{ industry_snapshot: { eligibleIndustries: Array<{ id: string }> } }>(
          "SELECT industry_snapshot FROM simulation_sessions WHERE simulation_session_id=$1", [partialStartId],
        )).rows[0]!.industry_snapshot;
        assert.deepEqual(partialSnapshot.eligibleIndustries.map((row) => row.id), [snapshotIndustryId]);

        const blockedCreated = await orgAdminCall(practiceScenarioPath, "POST", { ...pinnedV1Draft, title: "Publication must fail" });
        const blockedId = String(blockedCreated.body.id);
        assert.equal(blockedCreated.status, 201);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${blockedId}/submit`, "POST")).status, 200);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${blockedId}/approve`, "POST")).status, 200);
        const restrictedClient = await pool.connect();
        try {
          for (const [kind, id] of [["standard", restrictedStandardId], ["org", expandedCustomId]] as const) {
            await authority.attachScenario({ id: `industry_attachment_${id}`, orgId: org.id, topicId: topic.id,
              scenarioKind: kind, scenarioId: id, attachedBy: "platform_admin", attachedAt: now,
              detachedBy: null, detachedAt: null }, restrictedClient);
          }
        } finally { restrictedClient.release(); }
        const roleLeakDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
        const visibleIds = (roleLeakDetail.body.scenarios as Array<{ id: string }>).map((row) => row.id);
        assert.equal(visibleIds.includes(expandedCustomId), true);
        assert.equal(visibleIds.includes(restrictedStandardId), false);
        assert.equal((await call(startPath, { simulationSessionId: `role_leak_${randomUUID()}`,
          segmentId: restrictedRoleId, scenarioId: restrictedStandardId, trainingId: topic.id })).status, 400);

        const foreignRead = async (path: string) => {
          const result = await fetch(base + path, { headers: { Authorization: `Bearer ${foreignMobileToken}` } });
          assert.equal(result.status, 200);
          return await result.json() as Record<string, unknown>;
        };
        const foreignConfigBefore = await foreignRead(`/mobile/users/${foreignPerformanceUser.id}/config`);
        const foreignCatalogBefore = await foreignRead(`/mobile/users/${foreignPerformanceUser.id}/focus-topics`);
        assert.ok((foreignCatalogBefore.topics as unknown[]).length > 0);
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [unrelatedIndustryId] })).status, 200);
        assert.deepEqual(await foreignRead(`/mobile/users/${foreignPerformanceUser.id}/config`), foreignConfigBefore);
        assert.deepEqual(await foreignRead(`/mobile/users/${foreignPerformanceUser.id}/focus-topics`), foreignCatalogBefore);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${blockedId}/publish`, "POST")).status, 409);
        assert.equal((await call(startPath, { simulationSessionId: `deactivated_${randomUUID()}`,
          segmentId: segment.id, scenarioId: partialId, trainingId: topic.id })).status, 400);
        assert.equal((await orgAdminCall(practiceScenarioPath)).body.scenarios instanceof Array, true);
        assert.deepEqual((await pool.query("SELECT * FROM customer_practice_scenario_versions WHERE id=$1",
          [publishedVersionBefore.id])).rows[0], publishedVersionBefore);
        assert.equal((await pool.query<{ status: string }>("SELECT status FROM customer_practice_scenarios WHERE id=$1", [partialId])).rows[0]?.status, "published");
        assert.deepEqual((await pool.query("SELECT * FROM score_records ORDER BY id")).rows, historicalScoresBefore);

        // Global disable (and then an empty selection persisted by older code)
        // must not be repaired into broad learner access during normalization.
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config.industries = state.config.industries.map((entry) => ({ ...entry, enabled: false }));
          return { result: undefined, shouldSave: true, state };
        });
        const noIndustriesConfig = await call(`/mobile/users/${user.id}/config`);
        assert.equal(noIndustriesConfig.status, 200);
        const configPayload = (noIndustriesConfig.body.config ?? noIndustriesConfig.body) as {
          industries: unknown[]; orgCustomScenarios: unknown[]; segments: unknown[];
        };
        assert.deepEqual(configPayload.industries, []);
        assert.deepEqual(configPayload.orgCustomScenarios, []);
        assert.deepEqual(configPayload.segments, []);
        assert.equal((configPayload as unknown as { activeSegmentId: string }).activeSegmentId, "");
        assert.deepEqual((await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`)).body.scenarios, []);
        assert.equal((await orgAdminCall(practiceScenarioPath, "POST", pinnedV1Draft)).status, 400);
        assert.equal((await orgAdminCall(`${practiceScenarioPath}/${blockedId}/publish`, "POST")).status, 409);
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config = originalConfig;
          state.orgs.find((row) => row.id === org.id)!.activeIndustries = [];
          return { result: undefined, shouldSave: true, state };
        });
        assert.deepEqual((await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`)).body.scenarios, []);
        assert.equal((await call(startPath, { simulationSessionId: `empty_industry_${randomUUID()}`,
          segmentId: segment.id, scenarioId: partialId, trainingId: topic.id })).status, 400);
        const unavailableGeneration = await orgAdminCall(`${practiceScenarioPath}/generate`, "POST", { sourceContentIds: [contentId] });
        assert.equal(unavailableGeneration.status, 409);
        assert.match(String(unavailableGeneration.body.error), /^Generation requires/);
        assert.doesNotMatch(String(unavailableGeneration.body.error), /Publication/);
        assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { activeIndustries: [snapshotIndustryId] })).status, 200);
        const restoredIndustryDetail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
        assert.equal((restoredIndustryDetail.body.scenarios as Array<{ id: string }>).some((row) => row.id === partialId), true);
        assert.equal((await call(startPath, { simulationSessionId: `reactivated_${randomUUID()}`,
          segmentId: segment.id, scenarioId: partialId, trainingId: topic.id })).status, 201);
      } finally {
        await storage.updateAppStateWithLock((raw) => {
          const state = imported.ensureDatabaseShape(raw);
          state.config = originalConfig;
          const organization = state.orgs.find((row) => row.id === org.id)!;
          organization.activeIndustries = originalIndustryIds;
          organization.customScenarios = originalCustom;
          return { result: undefined, shouldSave: true, state };
        });
      }
      assert.equal((await orgAdminCall(practiceScenarioPath)).status, 200);
      const disabledUserSessionId = `disabled_user_${randomUUID()}`;
      const disabledOrgSessionId = `disabled_org_${randomUUID()}`;
      const movedMemberSessionId = `moved_member_${randomUUID()}`;
      for (const sessionId of [disabledUserSessionId, disabledOrgSessionId, movedMemberSessionId]) {
        const result = await call(startPath, startBody(sessionId, topic.id));
        assert.equal(result.status, 201, JSON.stringify(result.body));
      }

      const revokeClient = await pool.connect();
      try {
        await revokeClient.query("BEGIN");
        await authority.revokeAssignment({ orgId: org.id, topicId: topic.id,
          assignmentId: assignment.id, actorId: "platform_admin", at: new Date() }, revokeClient);
        await revokeClient.query("COMMIT");
      } finally { revokeClient.release(); }
      assert.deepEqual((await call(`/mobile/users/${user.id}/focus-topics`)).body.topics, []);
      const denied = await call(startPath, startBody(`revoked_${randomUUID()}`, topic.id));
      assert.equal(denied.status, 400, JSON.stringify(denied.body));
      const finishingTurn = await withMockResponses("The plan sounds clear.", () =>
        call(turnPath, turnBody(topicSessionId)));
      assert.equal(finishingTurn.status, 200, JSON.stringify(finishingTurn.body));
      const scorePayload = { communicationScore: 80, outcomeScore: 75, overallScore: 78,
        completionLevel: "complete", objectiveAchieved: true,
        persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8,
        strengths: ["Clear framing"], improvements: ["Tighter close"],
        summary: "Handled the conversation well." };
      const scoreFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (target === "https://api.openai.com/v1/responses") {
          return Promise.resolve(new Response(JSON.stringify({
            output_text: JSON.stringify(scorePayload), model: "local-test-model",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return scoreFetch(input, init);
      }) as typeof fetch;
      try {
        const scored = await call(`/mobile/users/${user.id}/ai/score`, {
          scenarioId: scenario.id, trainingId: topic.id, simulationSessionId: topicSessionId,
          startedAt: now, endedAt: new Date(Date.now() + 1000).toISOString(),
          history: [
            { role: "assistant", content: "What concerns you?" },
            { role: "user", content: "I would like to understand the concern more clearly." },
            { role: "assistant", content: "The team is behind." },
            { role: "user", content: "Let's identify the main blocker and its impact." },
            { role: "assistant", content: "We need a plan." },
            { role: "user", content: "I propose clear owners and a review date." },
          ],
        });
        assert.equal(scored.status, 201, JSON.stringify(scored.body));
        const recordedScore = await pool.query<{ training_id: string | null }>(
          "SELECT training_id FROM score_records WHERE simulation_session_id=$1", [topicSessionId]);
        assert.equal(recordedScore.rows[0]?.training_id, topic.id);
      } finally { globalThis.fetch = scoreFetch; }
      const completed = await call("/usage/sessions", { simulationSessionId: topicSessionId,
        userId: user.id, segmentId: segment.id, scenarioId: scenario.id,
        startedAt: now, endedAt: new Date(Date.now() + 1000).toISOString(), rawDurationSeconds: 1 });
      assert.equal(completed.status, 201, JSON.stringify(completed.body));
      const usage = await pool.query<{ training_id: string | null; training_pack_id: string | null }>(
        "SELECT training_id,training_pack_id FROM usage_sessions WHERE user_id=$1", [user.id]);
      assert.equal(usage.rows[0]?.training_id, topic.id);
      assert.equal(usage.rows[0]?.training_pack_id, null);
      const restoredGrant = await masterCall(assignmentsPath, "POST", {
        audience: "organization", subjectUserId: null,
      });
      assert.equal(restoredGrant.status, 201, JSON.stringify(restoredGrant.body));
      const topicPath = `/orgs/${org.id}/trainings/${topic.id}`;
      assert.equal((await masterCall(topicPath, "PATCH", { status: "archived" })).status, 200);
      const archivedStart = await call(startPath, startBody(`archived_${randomUUID()}`, topic.id));
      assert.equal(archivedStart.status, 400, JSON.stringify(archivedStart.body));
      assert.equal((await pool.query("SELECT 1 FROM score_records WHERE simulation_session_id=$1",
        [topicSessionId])).rowCount, 1);
      assert.equal((await masterCall(topicPath, "PATCH", { status: "active" })).status, 200);
      const detached = await masterCall(`${topicPath}/direct-attachments/runtime_attachment`, "DELETE");
      assert.equal(detached.status, 200, JSON.stringify(detached.body));
      const detachedStart = await call(startPath, startBody(`detached_${randomUUID()}`, topic.id));
      assert.equal(detachedStart.status, 400, JSON.stringify(detachedStart.body));
      const usageBody = (simulationSessionId: string) => ({ simulationSessionId,
        userId: user.id, segmentId: segment.id, scenarioId: scenario.id,
        startedAt: now, endedAt: new Date(Date.now() + 1000).toISOString(), rawDurationSeconds: 1 });
      const userPath = `/users/${user.id}`;
      assert.equal((await masterCall(userPath, "PATCH", { orgId: foreignOrg.id })).status, 200);
      assert.notEqual((await call("/usage/sessions", usageBody(movedMemberSessionId))).status, 201);
      assert.equal((await masterCall(userPath, "PATCH", { orgId: org.id })).status, 200);
      assert.equal((await masterCall(userPath, "PATCH", { status: "disabled" })).status, 200);
      assert.notEqual((await call("/usage/sessions", usageBody(disabledUserSessionId))).status, 201);
      const disabledCachedTurn = await withMockResponses("Should never be returned.", () =>
        call(turnPath, turnBody(topicSessionId)));
      assert.notEqual(disabledCachedTurn.status, 200);
      assert.equal((await masterCall(userPath, "PATCH", { status: "active" })).status, 200);
      assert.equal((await masterCall(`/orgs/${org.id}`, "PATCH", { status: "disabled" })).status, 200);
      assert.notEqual((await call("/usage/sessions", usageBody(disabledOrgSessionId))).status, 201);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await pool?.end();
      try { await setup.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`); }
      finally { await setup.end(); }
    }
  });
