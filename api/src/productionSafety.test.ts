import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionWriteAllowed,
  inferApiTargetEnvironment,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION
} from "./productionSafety.js";

test("script target parser accepts explicit deployment aliases", () => {
  assert.equal(parseScriptTarget("local"), "development");
  assert.equal(parseScriptTarget("stage"), "staging");
  assert.equal(parseScriptTarget("prod"), "production");
  assert.equal(parseScriptTarget(undefined), null);
});

test("database target inference uses non-secret database markers", () => {
  assert.equal(
    inferDatabaseTargetEnvironment("postgres://user:pass@host/voicepractice_db"),
    "staging"
  );
  assert.equal(
    inferDatabaseTargetEnvironment("postgres://user:pass@host/peritio_db_prod"),
    "production"
  );
  assert.equal(inferDatabaseTargetEnvironment("postgres://user:pass@localhost/dev"), "development");
});

test("api target inference uses known API host markers", () => {
  assert.equal(inferApiTargetEnvironment("https://voicepractice-api-dev.onrender.com"), "staging");
  assert.equal(inferApiTargetEnvironment("https://peritio-api-prod.onrender.com"), "production");
  assert.equal(inferApiTargetEnvironment("http://localhost:4100"), "development");
});

test("production writes require explicit target and exact confirmation", () => {
  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "test-script",
        explicitTarget: null,
        inferredTarget: "production",
        confirmProduction: null
      }),
    /refuses to write to production/
  );

  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "test-script",
        explicitTarget: "production",
        inferredTarget: "production",
        confirmProduction: "I know"
      }),
    /refuses to write to production/
  );

  assert.equal(
    assertProductionWriteAllowed({
      operationName: "test-script",
      explicitTarget: "production",
      inferredTarget: "production",
      confirmProduction: PRODUCTION_WRITE_CONFIRMATION
    }),
    "production"
  );
});

test("explicit target mismatch is refused before writes", () => {
  assert.throws(
    () =>
      assertProductionWriteAllowed({
        operationName: "test-script",
        explicitTarget: "staging",
        inferredTarget: "production",
        confirmProduction: PRODUCTION_WRITE_CONFIRMATION
      }),
    /target mismatch/
  );
});
