import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionWriteAllowed,
  inferApiTargetEnvironment,
  inferDatabaseTargetEnvironment,
  parseTargetEnvironment,
  PRODUCTION_WRITE_CONFIRMATION,
} from "./production-safety.mjs";

test("ops target parser accepts deployment aliases", () => {
  assert.equal(parseTargetEnvironment("local"), "development");
  assert.equal(parseTargetEnvironment("stage"), "staging");
  assert.equal(parseTargetEnvironment("prod"), "production");
  assert.equal(parseTargetEnvironment(undefined), null);
});

test("ops helper allows known staging target", () => {
  assert.equal(
    assertProductionWriteAllowed({
      operationName: "ops-test",
      explicitTarget: null,
      inferredTarget: inferApiTargetEnvironment("https://voicepractice-api-dev.onrender.com"),
      confirmProduction: null,
    }),
    "staging"
  );
});

test("ops helper refuses known production without confirmation", () => {
  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "ops-test",
        explicitTarget: null,
        inferredTarget: inferApiTargetEnvironment("https://peritio-api-prod.onrender.com"),
        confirmProduction: null,
      }),
    /refuses to write to production/
  );
});

test("ops helper allows known production with exact confirmation", () => {
  assert.equal(
    assertProductionWriteAllowed({
      operationName: "ops-test",
      explicitTarget: "production",
      inferredTarget: inferDatabaseTargetEnvironment("postgres://user:pass@host/peritio_db_prod"),
      confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
    }),
    "production"
  );
});

test("ops helper refuses unknown and vanity targets by default", () => {
  assert.equal(inferApiTargetEnvironment("https://api.peritio.ai"), null);
  assert.equal(inferDatabaseTargetEnvironment("postgres://user:pass@pooler.render.com/appdb"), null);

  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "ops-test",
        explicitTarget: null,
        inferredTarget: inferApiTargetEnvironment("https://api.peritio.ai"),
        confirmProduction: null,
      }),
    /refuses to write to an unknown target/
  );

  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "ops-test",
        explicitTarget: "staging",
        inferredTarget: inferDatabaseTargetEnvironment("postgres://user:pass@pooler.render.com/appdb"),
        confirmProduction: null,
      }),
    /refuses to write to an unknown target/
  );
});

test("ops helper allows unknown only with production confirmation", () => {
  assert.equal(
    assertProductionWriteAllowed({
      operationName: "ops-test",
      explicitTarget: "production",
      inferredTarget: inferApiTargetEnvironment("https://api.peritio.ai"),
      confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
    }),
    "production"
  );
});

test("ops helper refuses explicit target mismatch", () => {
  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "ops-test",
        explicitTarget: "staging",
        inferredTarget: "production",
        confirmProduction: PRODUCTION_WRITE_CONFIRMATION,
      }),
    /target mismatch/
  );
});
