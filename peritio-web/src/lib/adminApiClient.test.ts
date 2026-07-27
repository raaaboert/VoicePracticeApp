import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminApiClientError,
  getDownloadFilenameFromContentDisposition,
  readAdminApiJson,
} from "./adminApiClient";

test("readAdminApiJson includes server message and status for API errors", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Employee ID is already assigned within this organization.",
      code: "employee_id_conflict",
    }),
    {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }
  );

  await assert.rejects(
    () => readAdminApiJson(response, "/api/admin/users/u_1"),
    (error) => {
      assert.equal(error instanceof AdminApiClientError, true);
      assert.equal((error as AdminApiClientError).status, 409);
      assert.equal((error as AdminApiClientError).code, "employee_id_conflict");
      assert.equal(
        (error as AdminApiClientError).message,
        "Employee ID is already assigned within this organization. (409)."
      );
      return true;
    }
  );
});

test("download filename parser accepts standard and RFC 5987 headers", () => {
  assert.equal(
    getDownloadFilenameFromContentDisposition('attachment; filename="rob-s-company-users.csv"', "fallback.csv"),
    "rob-s-company-users.csv"
  );
  assert.equal(
    getDownloadFilenameFromContentDisposition("attachment; filename*=UTF-8''rob%20users.csv", "fallback.csv"),
    "rob users.csv"
  );
  assert.equal(getDownloadFilenameFromContentDisposition(null, "fallback.csv"), "fallback.csv");
});
