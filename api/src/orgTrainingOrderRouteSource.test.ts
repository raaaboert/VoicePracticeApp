import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const indexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const routeStart = indexSource.indexOf('"/orgs/:orgId/trainings/order",');
const routeEnd = indexSource.indexOf('app.patch("/orgs/:orgId/trainings/:trainingId"', routeStart);
const route = indexSource.slice(routeStart, routeEnd);

test("Focus Topic reorder uses one serialized app-state write and shared platform/customer authority", () => {
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.equal((route.match(/await withDatabase\(/g) ?? []).length, 1);
  assert.equal((route.match(/emitMobileUpdateForOrg\(/g) ?? []).length, 1);
  assert.equal((route.match(/appendPlatformAuditEvent\(/g) ?? []).length, 1);
  assert.equal((route.match(/appendWebAuditEvent\(/g) ?? []).length, 1);
  assert.match(route, /requireContentOrganizationAuth/);
  assert.doesNotMatch(route, /ensureOrgTrainingWorkspace|trainingPackStore|trainingContentStore/);
});

test("Focus Topic reorder validates the complete request before emitting side effects", () => {
  const reorder = route.indexOf("reorderActiveOrgTrainings");
  const liveUpdate = route.indexOf("emitMobileUpdateForOrg");
  const audit = route.indexOf("appendPlatformAuditEvent");
  assert.ok(reorder >= 0 && reorder < liveUpdate && liveUpdate < audit);
  assert.match(route, /org_training_order_conflict" \? 409(?: as const)? : 400(?: as const)?/);
  assert.match(route, /orderedTrainingIds: trainingIds/);
});

test("Focus Topic reorder checks the revision before validating current active membership", () => {
  const serviceSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "services", "orgTrainingWorkspace.ts"),
    "utf8",
  );
  const serviceStart = serviceSource.indexOf("export function reorderActiveOrgTrainings");
  const serviceEnd = serviceSource.indexOf("export function ensureOrgTrainingCollections", serviceStart);
  const service = serviceSource.slice(serviceStart, serviceEnd);
  assert.ok(serviceStart >= 0 && serviceEnd > serviceStart);
  assert.ok(service.indexOf("getOrgTrainingOrderRevision") < service.indexOf("requestedIds"));
  assert.ok(service.indexOf("org_training_order_conflict") < service.indexOf("org_training_order_invalid"));
});

test("company order is wired to controlled ordering and mobile Setup/catalog paths", () => {
  const mobileStart = indexSource.indexOf("function getMobileReadyOrgTrainings");
  const mobileEnd = indexSource.indexOf("function touchOrgTrainingRecord", mobileStart);
  const mobileConfig = indexSource.slice(mobileStart, mobileEnd);
  assert.match(mobileConfig, /buildOrgTrainingSummariesInCompanyOrder/);

  const dashboardStart = indexSource.indexOf("async function buildDashboardTrainingWorkspaceRowsForOrg");
  const dashboardEnd = indexSource.indexOf("async function buildDashboardTrainingWorkspace\(", dashboardStart);
  const dashboard = indexSource.slice(dashboardStart, dashboardEnd);
  assert.match(dashboard, /buildOrgTrainingSummaries\(/);
  assert.doesNotMatch(dashboard, /buildOrgTrainingSummariesInCompanyOrder/);

  const adminListStart = indexSource.indexOf('"/orgs/:orgId/trainings",');
  const adminListEnd = indexSource.indexOf('app.post("/orgs/:orgId/trainings"', adminListStart);
  assert.match(indexSource.slice(adminListStart, adminListEnd), /buildOrgTrainingSummariesInCompanyOrder/);
});

test("customer Training Pack ordering projects summaries without shrinking platform configuration routes", () => {
  const customerStart = indexSource.indexOf('"/orgs/:orgId/training-packs",');
  const customerEnd = indexSource.indexOf('app.get("/orgs/:orgId/training-packs/:trainingPackId/assignments"', customerStart);
  const customerRoutes = indexSource.slice(customerStart, customerEnd);
  assert.ok(customerStart >= 0 && customerEnd > customerStart);
  assert.match(customerRoutes, /request\.admin\s*\? authoritativePacks\s*:\s*buildCustomerTrainingPackOrderSummaries\(authoritativePacks\)/);
  assert.match(customerRoutes, /request\.admin\s*\? result\.trainingPacks\s*:\s*buildCustomerTrainingPackOrderSummaries\(result\.trainingPacks\)/);

  const createStart = indexSource.indexOf('app.post("/orgs/:orgId/training-packs"');
  const updateStart = indexSource.indexOf('app.patch("/orgs/:orgId/training-packs/:trainingPackId"', createStart);
  const deleteStart = indexSource.indexOf('app.delete("/orgs/:orgId/training-packs/:trainingPackId"', updateStart);
  const createRoute = indexSource.slice(createStart, updateStart);
  const updateRoute = indexSource.slice(updateStart, deleteStart);
  assert.match(createRoute, /response\.status\(201\)\.json\(outcome\.trainingPack\)/);
  assert.match(updateRoute, /response\.json\(outcome\.trainingPack\)/);
  assert.doesNotMatch(createRoute, /buildCustomerTrainingPackOrderSummaries/);
  assert.doesNotMatch(updateRoute, /buildCustomerTrainingPackOrderSummaries/);
});

test("Focus Topic list is a fresh side-effect-free app-state read with no extracted-store work", () => {
  const listStart = indexSource.indexOf('"/orgs/:orgId/trainings",');
  const listEnd = indexSource.indexOf('app.post("/orgs/:orgId/trainings"', listStart);
  const listRoute = indexSource.slice(listStart, listEnd);
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(listRoute, /withFreshDatabaseSnapshotRead/);
  assert.doesNotMatch(listRoute, /withDatabase\(|withDatabaseWrite|ensureOrgTrainingWorkspace/);
  assert.doesNotMatch(listRoute, /trainingPackStore|seedLegacyOrgTraining|saveDatabase/);
  assert.doesNotMatch(listRoute, /appendPlatformAuditEvent|appendWebAuditEvent|emitMobileUpdateForOrg/);

  const helperStart = indexSource.indexOf("async function withFreshDatabaseSnapshotRead");
  const helperEnd = indexSource.indexOf("async function refreshReportingSnapshots", helperStart);
  const helper = indexSource.slice(helperStart, helperEnd);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.match(helper, /forceStorageRead: true/);
  assert.match(helper, /syncEmployeeIdClaims: false/);
  assert.doesNotMatch(helper, /saveDatabase|trainingPackStore/);
});
