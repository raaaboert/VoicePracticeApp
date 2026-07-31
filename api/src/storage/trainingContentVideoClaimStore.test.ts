import assert from "node:assert/strict";
import test from "node:test";

import { createTrainingContentAssetStore } from "./trainingContentAssetStore.js";

const ASSET_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  org_id: "org_1",
  content_id: "22222222-2222-4222-8222-222222222222",
  asset_role: "primary",
  version: 1,
  upload_state: "processing",
  storage_provider: "r2",
  temporary_object_key: "tmp/org/content/asset/nonce",
  final_object_key: "objects/org/content/primary/1/nonce",
  original_filename: "coaching.mp4",
  declared_mime_type: "video/mp4",
  detected_mime_type: "video/mp4",
  file_extension: "mp4",
  declared_byte_size: "100",
  byte_size: "100",
  checksum_or_etag: "\"etag\"",
  upload_expires_at: new Date("2026-07-30T13:00:00.000Z"),
  finalization_nonce: "nonce_nonce_nonce_nonce",
  finalization_started_at: new Date("2026-07-30T12:00:00.000Z"),
  processing_attempt_count: 1,
  processing_lease_token: "lease-token",
  processing_lease_expires_at: new Date("2026-07-30T12:30:00.000Z"),
  processing_next_attempt_at: null,
  processing_error_category: null,
  replacement_for_asset_id: null,
  is_current: false,
  cleanup_pending: false,
  rejection_reason_category: null,
  finalized_at: null,
  superseded_at: null,
  object_deleted_at: null,
  created_by_actor_id: "admin_1",
  created_at: new Date("2026-07-30T11:00:00.000Z"),
  updated_at: new Date("2026-07-30T12:00:00.000Z"),
};

test("PostgreSQL video claim is atomic, skips locked rows, and cannot return one asset twice", async () => {
  const claimQueries: string[] = [];
  let claimed = false;
  const queryPool = {
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async query(text: string) {
      claimQueries.push(text);
      if (!text.includes("WITH candidate AS")) {
        throw new Error(`Unexpected query: ${text}`);
      }
      if (claimed) {
        return { rows: [], rowCount: 0 };
      }
      claimed = true;
      return { rows: [ASSET_ROW], rowCount: 1 };
    },
  };
  const store = createTrainingContentAssetStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: queryPool as any,
  });

  const first = await store.claimNextVideoProcessing({
    leaseSeconds: 1800,
    maximumAttempts: 3,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  const second = await store.claimNextVideoProcessing({
    leaseSeconds: 1800,
    maximumAttempts: 3,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.equal(first?.asset.id, ASSET_ROW.id);
  assert.equal(first?.asset.processingAttemptCount, 1);
  assert.equal(second, null);
  assert.match(claimQueries[0]!, /SELECT asset\.id AS candidate_asset_id/);
  assert.match(
    claimQueries[0]!,
    /WHERE asset\.id = candidate\.candidate_asset_id/
  );
  assert.match(claimQueries[0]!, /FOR UPDATE OF asset SKIP LOCKED/);
  assert.match(claimQueries[0]!, /content\.content_type = 'video'/);
  assert.match(claimQueries[0]!, /processing_lease_expires_at/);
  assert.match(claimQueries[0]!, /processing_attempt_count < \$1/);
});
