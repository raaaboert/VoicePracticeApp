import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const indexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = indexSource.indexOf(startMarker);
  const end = indexSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return indexSource.slice(start, end);
}

function assertReadOnlyAppStateLifecycle(route: string): void {
  assert.doesNotMatch(route, /withDatabaseWrite|withFreshReportingWrite|saveDatabase/);
  assert.doesNotMatch(route, /appendAuditEvent\(|appendPlatformAuditEvent\(|appendMobileAuditEvent\(|appendWebAuditEvent\(/);
}

test("support mutations deliver audit after the authoritative support case commit", () => {
  const publicSupport = sourceBetween(
    'app.post("/mobile/public/support/errors"',
    "app.use((request: Request, response: Response, next: NextFunction)",
  );
  const mobileSupport = sourceBetween(
    'app.post("/mobile/users/:userId/support/cases"',
    'app.get("/mobile/users/:userId/updates"',
  );

  for (const route of [publicSupport, mobileSupport]) {
    assertReadOnlyAppStateLifecycle(route);
    assert.ok(route.indexOf("supportCaseStore.saveCase") < route.indexOf("deliverPostCommitAuditEventBestEffort"));
    assert.ok(route.indexOf("deliverPostCommitAuditEventBestEffort") < route.lastIndexOf("response.status(201).json"));
  }
});

test("web logout revokes the authoritative session before best-effort audit and response", () => {
  const route = sourceBetween(
    'app.post("/web/auth/logout"',
    'app.get("/dashboard/overview"',
  );
  assertReadOnlyAppStateLifecycle(route);
  assert.ok(route.indexOf("revokeWebAuthSessionById") < route.indexOf("deliverPostCommitAuditEventBestEffort"));
  assert.ok(route.indexOf("deliverPostCommitAuditEventBestEffort") < route.indexOf("response.json"));
});

test("Training Pack create and update respond from committed store rows after best-effort audit", () => {
  const createRoute = sourceBetween(
    'app.post("/orgs/:orgId/training-packs"',
    'app.patch("/orgs/:orgId/training-packs/:trainingPackId"',
  );
  const updateRoute = sourceBetween(
    'app.patch("/orgs/:orgId/training-packs/:trainingPackId"',
    'app.delete("/orgs/:orgId/training-packs/:trainingPackId"',
  );

  assertReadOnlyAppStateLifecycle(createRoute);
  assertReadOnlyAppStateLifecycle(updateRoute);
  assert.ok(createRoute.indexOf("createTrainingPackForOrg") < createRoute.indexOf("deliverPostCommitAuditEventBestEffort"));
  assert.ok(createRoute.indexOf("deliverPostCommitAuditEventBestEffort") < createRoute.indexOf("response.status(201).json(outcome.trainingPack)"));
  assert.ok(updateRoute.indexOf("updateTrainingPackForOrg") < updateRoute.indexOf("deliverPostCommitAuditEventBestEffort"));
  assert.ok(updateRoute.indexOf("deliverPostCommitAuditEventBestEffort") < updateRoute.indexOf("response.json(outcome.trainingPack)"));
});

test("all six in-scope performance plan mutation routes use snapshots without app-state persistence", () => {
  const routes = [
    sourceBetween(
      'app.post("/dashboard/performance/plans"',
      'app.patch("/dashboard/performance/plans/:planId"',
    ),
    sourceBetween(
      'app.patch("/dashboard/performance/plans/:planId"',
      'app.get("/dashboard/performance/plans/:planId"',
    ),
    sourceBetween(
      'app.post("/dashboard/performance/plans/:planId/updates"',
      'app.post("/dashboard/performance/plans/:planId/cancel"',
    ),
    sourceBetween(
      'app.post("/dashboard/performance/plans/:planId/cancel"',
      'app.get("/config"',
    ),
    sourceBetween(
      'app.post("/mobile/users/:userId/performance/plans"',
      'app.get("/mobile/users/:userId/performance/plans"',
    ),
    sourceBetween(
      'app.post("/mobile/users/:userId/performance/plans/:planId/updates"',
      'app.post("/mobile/users/:userId/performance/plans/:planId/cancel"',
    ),
  ];

  for (const route of routes) {
    assert.match(route, /withFreshReportingSnapshotRead/);
    assertReadOnlyAppStateLifecycle(route);
  }

  const wrapper = sourceBetween(
    "async function withFreshReportingSnapshotRead",
    "async function captureFreshReportingDatabaseSnapshot",
  );
  assert.match(wrapper, /withDatabaseLock/);
  assert.match(wrapper, /structuredClone/);
  assert.doesNotMatch(wrapper, /saveDatabase|appendAuditEvent/);
});

test("post-commit audit delivery is observable and cannot reject the committed primary mutation", () => {
  const helper = sourceBetween(
    "async function deliverPostCommitAuditEventBestEffort(",
    "function appendAuditEvent(",
  );
  assert.match(helper, /try\s*{/);
  assert.match(helper, /catch \(error\)/);
  assert.match(helper, /logWarn\(/);
  assert.match(helper, /failed after primary domain commit/);
  assert.doesNotMatch(helper, /catch \(error\)[\s\S]*throw error/);
});
