import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCTION_WRITE_CONFIRMATION } from "../src/productionSafety.js";
import {
  assertMigrationTargetSafety,
  parseMigrationCliOptions,
} from "./migrate-training-pack-schema.js";

test("Training Pack migration command is check-only unless apply is explicit", () => {
  const options = parseMigrationCliOptions(["--target", "staging"]);
  assert.equal(options.apply, false);
  assert.equal(options.target, "staging");
  assert.equal(
    assertMigrationTargetSafety({
      options,
      databaseUrl: "postgres://user:pass@host/voicepractice_db",
    }),
    "staging"
  );
});

test("Training Pack migration command rejects target mismatches", () => {
  const options = parseMigrationCliOptions([
    "--apply",
    "--target",
    "staging",
  ]);
  assert.throws(
    () =>
      assertMigrationTargetSafety({
        options,
        databaseUrl: "postgres://user:pass@host/peritio_db_prod",
      }),
    /target mismatch/
  );
});

test("Training Pack production migration requires the exact confirmation", () => {
  const databaseUrl = "postgres://user:pass@host/peritio_db_prod";
  assert.throws(
    () =>
      assertMigrationTargetSafety({
        options: parseMigrationCliOptions([
          "--apply",
          "--target",
          "production",
        ]),
        databaseUrl,
      }),
    /refuses to write to production/
  );
  assert.equal(
    assertMigrationTargetSafety({
      options: parseMigrationCliOptions([
        "--apply",
        "--target",
        "production",
        "--confirm-production",
        PRODUCTION_WRITE_CONFIRMATION,
      ]),
      databaseUrl,
    }),
    "production"
  );
});
