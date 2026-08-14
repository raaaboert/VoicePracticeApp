import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PRODUCTION_WRITE_CONFIRMATION } from "../src/productionSafety.js";
import { assertTrainingContentBackupReconciliationTarget } from "./reconcile-training-content-backup.js";

const STAGING = {
  target: "staging" as const,
  deploymentEnvironment: "staging",
  liveStorageEnvironment: "staging",
  databaseUrl: "postgres://user:pass@host/voicepractice_db",
  apply: false,
  confirmProduction: null,
};

test("backup reconciliation requires aligned explicit environment lanes", () => {
  assert.equal(assertTrainingContentBackupReconciliationTarget(STAGING), "staging");
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget({
      ...STAGING,
      liveStorageEnvironment: "production",
    }),
    /must match PERITIO_ENV, live R2 environment, and DATABASE_URL/
  );
});

test("production backup apply requires the normal explicit confirmation", () => {
  const production = {
    target: "production" as const,
    deploymentEnvironment: "production",
    liveStorageEnvironment: "production",
    databaseUrl: "postgres://user:pass@host/peritio-db-prod",
    apply: true,
    confirmProduction: null,
  };
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget(production),
    /refuses to write to production/
  );
  assert.equal(assertTrainingContentBackupReconciliationTarget({
    ...production,
    confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
  }), "production");
});

test("production confirmation cannot be supplied to a dry run", () => {
  assert.throws(
    () => assertTrainingContentBackupReconciliationTarget({
      target: "production",
      deploymentEnvironment: "production",
      liveStorageEnvironment: "production",
      databaseUrl: "postgres://user:pass@host/peritio-db-prod",
      apply: false,
      confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
    }),
    /only valid for an applied production backup reconciliation/
  );
});

test("reconciliation is dry-run by default and reports IDs without object keys", async () => {
  const source = await readFile(
    new URL("./reconcile-training-content-backup.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.match(source, /if \(!apply\) \{[\s\S]*?assetIds: pending\.map\(\(asset\) => asset\.id\)/);
  assert.doesNotMatch(source, /pending\.map\(\(asset\) => asset\.finalObjectKey\)/);
});
