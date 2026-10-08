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
import { createWebAuthService } from "./services/webAuth.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";

function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

async function withMockResponses<T>(text: string, runner: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target === "https://api.openai.com/v1/responses") {
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

test("real PostgreSQL assignment-mode catalog, launch, attribution, and revocation",
  { skip: !databaseUrl }, async () => {
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
        email: "learner@focus-runtime.integration.test", divisionId: "division_runtime_a" };
      org.divisionsEnabled = true;
      db.orgs = [org, foreignOrg];
      const scopedUserAdmin = {
        ...sourceUser,
        id: "user_focus_scoped_admin",
        orgId: org.id,
        email: "scoped-admin@focus-runtime.integration.test",
        orgRole: "user_admin" as const,
        emailVerifiedAt: now,
        status: "active" as const,
        dashboardAccessEnabled: false,
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
      db.users = [user, scopedUserAdmin, orgAdmin];
      user.firstName = "Test";
      user.lastName = "Learner";
      user.emailVerifiedAt = now;
      user.status = "active";
      user.mobileProfileReonboardingRequired = false;
      db.mobileAuthTokens.push({ userId: user.id,
        tokenHash: createHmac("sha256", tokenSecret).update(token).digest("hex"),
        createdAt: now, updatedAt: now });
      const segment = db.config.segments.find((candidate) => candidate.id === "solution_manager");
      const scenario = segment?.scenarios.find((candidate) => candidate.enabled !== false);
      assert.ok(segment && scenario);
      const unattachedScenario = segment.scenarios.find((candidate) =>
        candidate.enabled !== false && candidate.id !== scenario.id);
      assert.ok(unattachedScenario);
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
      org.customScenarios = [...(org.customScenarios ?? []), {
        id: customScenarioId, orgId: org.id, segmentId: segment.id, title: "Legacy-only custom scenario",
        description: "A legacy Topic relationship must not authorize scoring.", aiRole: "Counterpart",
        scoringGuidance: "", applicableIndustryIds: [...org.activeIndustries], enabled: true,
        provenance: { sourceMode: "scratch", creationMethod: "manual" }, createdBy: "platform_admin",
        createdAt: now, updatedAt: now,
      }];
      db.orgTrainingScenarioAttachments.push({ id: "legacy_custom_attachment", orgId: org.id,
        trainingId: topic.id, scenarioId: customScenarioId, createdAt: now, updatedAt: now });
      const foreignTopic: OrgTrainingRecord = { ...topic, id: "focus_foreign_topic", orgId: foreignOrg.id };
      const unmanagedTopic: OrgTrainingRecord = {
        ...topic, id: "focus_runtime_unmanaged_topic", name: "Unmanaged Topic",
      };
      db.orgTrainings.push(foreignTopic, unmanagedTopic);
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
          ($5,$6,$7,'Foreign content','', 'native','published','Foreign body',0,1,
          'platform_admin','platform_admin',$4,$4)`,
      [contentId, org.id, categoryId, now, foreignContentId, foreignOrg.id, foreignCategoryId]);
      assert.equal((await storage.load()).users.some((candidate) => candidate.id === user.id), true);
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
        await authority.createAssignment({ ...assignment, id: "foreign_runtime_assignment",
          orgId: foreignOrg.id, topicId: foreignTopic.id }, client);
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
      const catalog = await call(`/mobile/users/${user.id}/focus-topics`);
      assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
      assert.deepEqual((catalog.body.topics as Array<{ id: string }>).map((row) => row.id), [topic.id]);
      const detail = await call(`/mobile/users/${user.id}/focus-topics/${topic.id}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal((await call(`/mobile/users/${user.id}/focus-topics/${foreignTopic.id}`)).status, 404);
      assert.deepEqual((detail.body.scenarios as Array<{ id: string; trainingId: string | null }>).map((row) =>
        [row.id, row.trainingId]), [[scenario.id, null]]);
      const installedParserUrl = new URL("../../mobile/src/focusTopics/model.ts", import.meta.url).href;
      const installedParser = await import(installedParserUrl) as {
        parseFocusTopicCatalogResponse: (value: unknown) => { topics: Array<{ id: string }> };
        parseFocusTopicDetailResponse: (value: unknown) => { scenarios: Array<{ id: string }> };
      };
      assert.deepEqual(installedParser.parseFocusTopicCatalogResponse(catalog.body).topics.map((row) => row.id), [topic.id]);
      assert.deepEqual(installedParser.parseFocusTopicDetailResponse(detail.body).scenarios.map((row) => row.id), [scenario.id]);
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
      const attachmentsPath = `/orgs/${org.id}/trainings/${topic.id}/direct-attachments`;
      const attachmentCountBefore = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM focus_topic_scenario_attachments");
      const unknownStandard = await masterCall(attachmentsPath, "POST", {
        kind: "scenario", scenarioKind: "standard", scenarioId: "unknown_standard_scenario",
      });
      assert.equal(unknownStandard.status, 400, JSON.stringify(unknownStandard.body));
      const attachmentCountAfter = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM focus_topic_scenario_attachments");
      assert.equal(attachmentCountAfter.rows[0]?.count, attachmentCountBefore.rows[0]?.count);
      const invalidSubject = await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: "foreign_user",
      });
      assert.equal(invalidSubject.status, 400);
      const masterCreated = await masterCall(assignmentsPath, "POST", {
        audience: "organization", subjectUserId: null, grantsManagement: true,
      });
      assert.equal(masterCreated.status, 400, JSON.stringify(masterCreated.body));
      const managementGrant = await masterCall(assignmentsPath, "POST", {
        audience: "individual", subjectUserId: scopedUserAdmin.id, grantsManagement: true,
      });
      assert.equal(managementGrant.status, 201, JSON.stringify(managementGrant.body));
      assert.equal(managementGrant.body.grantsManagement, true);
      assert.equal((await pool.query(
        "SELECT 1 FROM focus_topic_assignments WHERE id=$1 AND grants_management=TRUE",
        [managementGrant.body.id],
      )).rowCount, 1);
      const productSettings = createOrganizationProductSettingsStore({
        provider: "postgres", databaseUrl: url, pgPoolMax: 3,
        pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 2000, queryPool: pool,
      });
      await productSettings.initialize();
      await pool.query(`INSERT INTO organization_product_settings (
        org_id, allow_user_admin_focus_topic_management, updated_at
      ) VALUES ($1, TRUE, NOW())
      ON CONFLICT (org_id) DO UPDATE SET allow_user_admin_focus_topic_management=TRUE, updated_at=NOW()`,
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
      const orgAdminSession = scopedWebAuth.issueSession(
        orgAdmin, 60, new Date(), {
          accessType: "customer_dashboard_user", orgId: org.id,
        },
      );
      await scopedWebAuthStore.saveSession(orgAdminSession.record);
      const dashboardCall = async (
        sessionToken: string,
        path: string,
        method: "GET" | "POST" | "DELETE" = "GET",
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
      const scopedCall = (path: string, method: "GET" | "POST" | "DELETE" = "GET",
        body?: Record<string, unknown>) => dashboardCall(scopedSession.token, path, method, body);
      const orgAdminCall = (path: string, method: "GET" | "POST" | "DELETE" = "GET",
        body?: Record<string, unknown>) => dashboardCall(orgAdminSession.token, path, method, body);
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
      assert.deepEqual(
        (relatedBefore.body.contentItems as Array<{ id: string }>).map((entry) => entry.id),
        [contentId],
      );
      const scopedAttached = await scopedCall(attachmentsPath, "POST", { kind: "content", contentId });
      assert.equal(scopedAttached.status, 201, JSON.stringify(scopedAttached.body));
      assert.equal((await scopedCall(attachmentsPath, "POST", { kind: "content", contentId })).status, 409);
      assert.equal((await scopedCall(attachmentsPath, "POST", {
        kind: "content", contentId: foreignContentId,
      })).status, 400);
      const unmanagedAttachmentsPath = `/orgs/${org.id}/trainings/${unmanagedTopic.id}/direct-attachments`;
      assert.equal((await scopedCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId,
      })).status, 404);
      const sharedAttachment = await orgAdminCall(unmanagedAttachmentsPath, "POST", {
        kind: "content", contentId,
      });
      assert.equal(sharedAttachment.status, 201, JSON.stringify(sharedAttachment.body));
      const scopedDetached = await scopedCall(
        `${attachmentsPath}/${scopedAttached.body.id as string}`, "DELETE",
      );
      assert.equal(scopedDetached.status, 200, JSON.stringify(scopedDetached.body));
      const attachmentRows = await pool.query<{ topic_id: string; detached_at: Date | null }>(
        `SELECT topic_id,detached_at FROM org_content_topic_attachments
         WHERE content_id=$1 ORDER BY topic_id`, [contentId],
      );
      assert.deepEqual(attachmentRows.rows.map((entry) => [entry.topic_id, Boolean(entry.detached_at)]), [
        [topic.id, true], [unmanagedTopic.id, false],
      ]);
      assert.equal((await pool.query(
        "SELECT 1 FROM audit_events WHERE action='focus_topic.content.attached'",
      )).rowCount, 2);
      assert.equal((await pool.query(
        "SELECT 1 FROM audit_events WHERE action='focus_topic.attachment.detached'",
      )).rowCount, 1);
      assert.equal((await pool.query(
        "SELECT 1 FROM user_notifications WHERE kind='content_added' AND recipient_user_id=$1",
        [orgAdmin.id],
      )).rowCount, 2);
      await moduleEntitlements.setOrgModuleEntitlement({
        orgId: org.id, moduleKey: "training_content", enabled: false,
        updatedByActorId: "platform_admin", updatedAt: new Date(),
      });
      assert.equal((await scopedCall(attachmentsPath, "POST", { kind: "content", contentId })).status, 403);
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
      assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='focus_topic.assignment.created'")).rowCount, 1);
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
        `${assignmentsPath}/${managementGrant.body.id as string}`,
        "DELETE",
      );
      assert.equal(revokedManagement.status, 200, JSON.stringify(revokedManagement.body));
      const staleScopedRequest = await scopedCall(`/orgs/${org.id}/trainings`);
      assert.equal(staleScopedRequest.status, 403, JSON.stringify(staleScopedRequest.body));

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
