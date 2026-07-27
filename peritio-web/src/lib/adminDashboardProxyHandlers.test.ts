import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type {
  DashboardAdminAccessRequestRow,
  DashboardAdminUserRow,
  DashboardAdminUsersExportResponse,
  DashboardViewer,
} from "@voicepractice/shared";

import {
  buildDashboardAdminUsersCsvResponse,
  handleDashboardAdminAccessRequestPatch,
  handleDashboardAdminUserPatch,
  handleDashboardAdminUsersGet,
} from "./adminDashboardProxyHandlers";
import { DashboardApiError } from "./dashboardApiErrorTypes";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

function appRequest(pathname: string, init?: RequestInit): NextRequest {
  return new NextRequest(`https://app.peritio.ai${pathname}`, {
    ...init,
    headers: {
      host: "app.peritio.ai",
      ...(init?.headers ?? {}),
    },
  });
}

function createViewer(): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: "admin",
    email: "admin@rob.example",
    isSuperUser: false,
    orgId: "org_1",
    orgName: "Rob's Company",
    orgRole: "org_admin",
    capabilities: {
      viewOrganizationUsers: true,
      manageRegularOrganizationUsers: true,
      approveRejectAccessRequests: true,
      editEmployeeIds: true,
      manageOrganizationContent: true,
    },
  };
}

function createUserRow(overrides: Partial<DashboardAdminUserRow> = {}): DashboardAdminUserRow {
  return {
    userId: "approved_user",
    email: "approved@gmail.com",
    displayName: "Approved User",
    employeeId: null,
    orgRole: "user",
    status: "active",
    dashboardAccessEnabled: false,
    canEditEmployeeId: true,
    canDeactivate: true,
    canReactivate: false,
    isSelf: false,
    createdAt: "2026-07-25T15:00:00.000Z",
    updatedAt: "2026-07-25T15:00:00.000Z",
    ...overrides,
  };
}

function createAccessRequestRow(
  overrides: Partial<DashboardAdminAccessRequestRow> = {}
): DashboardAdminAccessRequestRow {
  return {
    id: "jr_1",
    status: "pending",
    userId: "pending_user",
    displayName: "Pending User",
    email: "pending@gmail.com",
    orgId: "org_1",
    orgName: "Rob's Company",
    createdAt: "2026-07-25T15:00:00.000Z",
    expiresAt: "2099-07-25T15:00:00.000Z",
    updatedAt: "2026-07-25T15:00:00.000Z",
    decidedAt: null,
    decisionReason: null,
    ...overrides,
  };
}

function createExportPayload(overrides: Partial<DashboardAdminUsersExportResponse> = {}): DashboardAdminUsersExportResponse {
  return {
    generatedAt: "2026-07-25T15:00:00.000Z",
    org: { id: "org_1", name: "Rob's Company" },
    rows: [
      {
        employeeId: "EMP-1",
        name: "Rob, Admin",
        email: "admin@rob.example",
        role: "Org Admin",
        status: "active",
      },
      {
        employeeId: "",
        name: "=Formula User",
        email: "formula@example.com",
        role: "User",
        status: "active",
      },
    ],
    ...overrides,
  };
}

test("dashboard admin proxy approves an access request and forwards org context", async () => {
  let captured: unknown = null;
  const response = await handleDashboardAdminAccessRequestPatch(
    appRequest("/api/admin/access-requests/jr_1?orgId=org_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }),
    "jr_1",
    {
      decideAccessRequest: async (requestId, input, orgId) => {
        captured = { requestId, input, orgId };
        return { ok: true, request: createAccessRequestRow({ status: "approved" }) };
      },
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(captured, { requestId: "jr_1", input: { action: "approve" }, orgId: "org_1" });
  assert.equal(((await response.json()) as { request: { status: string } }).request.status, "approved");
});

test("dashboard admin proxy rejects an access request through the same PATCH path", async () => {
  let captured: unknown = null;
  const response = await handleDashboardAdminAccessRequestPatch(
    appRequest("/api/admin/access-requests/jr_2?orgId=org_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reason: "Not a trial user" }),
    }),
    "jr_2",
    {
      decideAccessRequest: async (requestId, input, orgId) => {
        captured = { requestId, input, orgId };
        return {
          ok: true,
          request: createAccessRequestRow({
            id: "jr_2",
            status: "rejected",
            decisionReason: "Not a trial user",
          }),
        };
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, {
    requestId: "jr_2",
    input: { action: "reject", reason: "Not a trial user" },
    orgId: "org_1",
  });
  assert.equal(((await response.json()) as { request: { status: string } }).request.status, "rejected");
});

test("dashboard admin proxy forwards PATCH body and explicit org context for user updates", async () => {
  let captured: unknown = null;
  const response = await handleDashboardAdminUserPatch(
    appRequest("/api/admin/users/user_1?orgId=org_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: " EMP-2 ", status: "disabled" }),
    }),
    "user_1",
    {
      updateUser: async (userId, input, orgId) => {
        captured = { userId, input, orgId };
        return { ok: true, user: createUserRow({ userId, employeeId: "EMP-2", status: "disabled" }) };
      },
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(captured, {
    userId: "user_1",
    input: { employeeId: " EMP-2 ", status: "disabled" },
    orgId: "org_1",
  });
  assert.equal(((await response.json()) as { user: { employeeId: string } }).user.employeeId, "EMP-2");
});

test("dashboard admin proxy exports organization users as CSV with safe headers and content", async () => {
  const response = await handleDashboardAdminUsersGet(appRequest("/api/admin/users?orgId=org_1&export=csv"), {
    getUsersExport: async (orgId) => {
      assert.equal(orgId, "org_1");
      return createExportPayload();
    },
    getUsers: async () => {
      throw new Error("Expected CSV export path.");
    },
  });
  const csv = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="rob-s-company-users.csv"');
  assert.equal(csv.includes("Employee ID,Name,Email,Role,Status"), true);
  assert.equal(csv.includes('EMP-1,"Rob, Admin",admin@rob.example,Org Admin,active'), true);
  assert.equal(csv.includes("'=Formula User"), true);
});

test("dashboard admin proxy lists approved organization users through the JSON path", async () => {
  const response = await handleDashboardAdminUsersGet(appRequest("/api/admin/users?orgId=org_1"), {
    getUsers: async (orgId) => {
      assert.equal(orgId, "org_1");
      return {
        viewer: createViewer(),
        generatedAt: "2026-07-25T15:00:00.000Z",
        org: { id: "org_1", name: "Rob's Company" },
        users: [createUserRow({ userId: "approved_user", email: "approved@gmail.com" })],
      };
    },
    getUsersExport: async () => {
      throw new Error("Expected JSON users path.");
    },
  });
  const payload = (await response.json()) as { users: Array<{ userId: string; email: string }> };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.users, [{ ...createUserRow({ userId: "approved_user", email: "approved@gmail.com" }) }]);
});

test("dashboard admin CSV response helper sets no-store and nosniff", () => {
  const response = buildDashboardAdminUsersCsvResponse(createExportPayload());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("dashboard admin proxy propagates backend errors with status and code", async () => {
  const response = await handleDashboardAdminUserPatch(
    appRequest("/api/admin/users/user_1?orgId=org_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: "EMP-1" }),
    }),
    "user_1",
    {
      updateUser: async () => {
        throw new DashboardApiError(
          409,
          "Employee ID is already assigned within this organization.",
          "employee_id_conflict"
        );
      },
    }
  );

  const payload = (await response.json()) as { error: string; code: string };
  assert.equal(response.status, 409);
  assert.equal(payload.error, "Employee ID is already assigned within this organization.");
  assert.equal(payload.code, "employee_id_conflict");
});

test("dashboard admin proxy keeps cross-tenant approval blocks from backend intact", async () => {
  const response = await handleDashboardAdminAccessRequestPatch(
    appRequest("/api/admin/access-requests/jr_other?orgId=org_2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }),
    "jr_other",
    {
      decideAccessRequest: async () => {
        throw new DashboardApiError(404, "Join request not found.");
      },
    }
  );

  const payload = (await response.json()) as { error: string };
  assert.equal(response.status, 404);
  assert.equal(payload.error, "Join request not found.");
});
