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

test("mobile config is a fresh side-effect-free snapshot read", () => {
  const route = sourceBetween(
    'app.get("/mobile/users/:userId/config"',
    'app.get("/mobile/users/:userId/org-access-requests"',
  );
  assert.match(route, /withFreshDatabaseSnapshotRead/);
  assert.doesNotMatch(route, /withDatabase\(|withDatabaseWrite|withFreshReportingWrite/);
  assert.doesNotMatch(route, /ensureOrgTrainingWorkspace|seedLegacyOrgTraining|saveDatabase/);
  assert.doesNotMatch(route, /trainingPackStore|listTrainingPacks/);
  assert.doesNotMatch(route, /appendPlatformAuditEvent|appendWebAuditEvent|emitMobileUpdateForOrg/);
});

test("performance scope candidates are a pure projection over supplied Training Packs", () => {
  const helper = sourceBetween(
    "function buildPerformanceScopeCandidatesForUser(",
    "function buildPerformanceUserContext(",
  );
  assert.match(helper, /trainingPacks: readonly TrainingPack\[\]/);
  assert.doesNotMatch(helper, /ensureOrgTrainingWorkspace|seedLegacyOrgTraining|saveDatabase/);
  assert.doesNotMatch(helper, /await|trainingPackStore|listTrainingPacksForDashboardOrg/);
  assert.doesNotMatch(helper, /appendPlatformAuditEvent|appendWebAuditEvent|emitMobileUpdateForOrg/);
});

test("dashboard reporting trainings snapshots app-state before extracted-store reads", () => {
  const route = sourceBetween(
    'app.get("/dashboard/reporting/trainings"',
    'app.get("/dashboard/customers"',
  );
  assert.match(route, /captureFreshReportingDatabaseSnapshot/);
  assert.match(route, /buildDashboardTrainingWorkspace/);
  assert.doesNotMatch(route, /withFreshReportingWrite|ensureOrgTrainingWorkspace|seedLegacyOrgTraining|saveDatabase/);
  assert.doesNotMatch(route, /appendPlatformAuditEvent|appendWebAuditEvent|emitMobileUpdateForOrg/);

  const snapshot = sourceBetween(
    "async function captureFreshReportingDatabaseSnapshot()",
    "async function capturePerformanceEvidenceSourceSnapshot()",
  );
  assert.ok(snapshot.indexOf("withFreshDatabaseSnapshotRead") < snapshot.indexOf("refreshReportingSnapshots"));
  assert.match(snapshot, /structuredClone\(source\)/);
});

test("Training Pack GET authorizes under a snapshot lock and queries afterward", () => {
  const route = sourceBetween(
    '"/orgs/:orgId/training-packs",',
    'app.put(\n  "/orgs/:orgId/training-packs/order"',
  );
  const snapshotEnd = route.indexOf("if (!org)");
  const packRead = route.indexOf("listTrainingPacksForContentOrganization");
  assert.match(route, /withFreshDatabaseSnapshotRead/);
  assert.ok(snapshotEnd >= 0 && packRead > snapshotEnd);
  assert.doesNotMatch(route, /withDatabaseRead|withDatabaseWrite|withFreshReportingWrite/);
});
