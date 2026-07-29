import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCTION_WRITE_CONFIRMATION } from "../src/productionSafety.js";
import { assertTrainingContentCleanupTarget } from "./cleanup-training-content-storage.js";

test("Training Content cleanup requires aligned explicit environment targets", () => {
  assert.equal(assertTrainingContentCleanupTarget({
    target: "staging",
    deploymentEnvironment: "staging",
    storageEnvironment: "staging",
    databaseUrl: "postgres://user:pass@host/voicepractice_db",
    apply: false,
    confirmProduction: null,
  }), "staging");

  assert.throws(() => assertTrainingContentCleanupTarget({
    target: null,
    deploymentEnvironment: "staging",
    storageEnvironment: "staging",
    databaseUrl: "postgres://user:pass@host/voicepractice_db",
    apply: false,
    confirmProduction: null,
  }), /--target staging or --target production is required/);

  assert.throws(() => assertTrainingContentCleanupTarget({
    target: "staging",
    deploymentEnvironment: "staging",
    storageEnvironment: "production",
    databaseUrl: "postgres://user:pass@host/voicepractice_db",
    apply: true,
    confirmProduction: null,
  }), /must match PERITIO_ENV/);
});

test("applied production cleanup requires the standard explicit confirmation", () => {
  const base = {
    target: "production" as const,
    deploymentEnvironment: "production",
    storageEnvironment: "production",
    databaseUrl: "postgres://user:pass@host/peritio_db_prod",
    apply: true,
  };
  assert.throws(() => assertTrainingContentCleanupTarget({
    ...base,
    confirmProduction: null,
  }), /refuses to write to production/);
  assert.equal(assertTrainingContentCleanupTarget({
    ...base,
    confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
  }), "production");
  assert.throws(() => assertTrainingContentCleanupTarget({
    ...base,
    apply: false,
    confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
  }), /only valid for an applied production cleanup/);
});
