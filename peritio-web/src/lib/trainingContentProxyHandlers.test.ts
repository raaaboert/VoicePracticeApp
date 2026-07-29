import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import type {
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentListResponse,
  DashboardViewer,
} from "@voicepractice/shared";

import { DashboardApiError } from "./dashboardApiErrorTypes";
import {
  handleTrainingContentAssignmentsUpdate,
  handleTrainingContentAssetAccess,
  handleTrainingContentCreate,
  handleTrainingContentListGet,
  handleTrainingContentTransition,
  handleTrainingContentUpdate,
  handleTrainingContentUploadFinalize,
  handleTrainingContentUploadInitiate,
} from "./trainingContentProxyHandlers";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

const NOW = "2026-07-28T12:00:00.000Z";

function request(pathname: string, init?: RequestInit): NextRequest {
  return new NextRequest(`https://app.peritio.ai${pathname}`, {
    ...init,
    headers: {
      host: "app.peritio.ai",
      ...(init?.headers ?? {}),
    },
  });
}

function viewer(): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: "admin",
    email: "admin@example.com",
    isSuperUser: false,
    orgId: "org_1",
    orgName: "Example",
    orgRole: "org_admin",
    capabilities: {
      viewOrganizationUsers: true,
      manageRegularOrganizationUsers: true,
      approveRejectAccessRequests: true,
      editEmployeeIds: true,
      editUserNames: true,
      manageUserRoles: true,
      assignUserManagers: true,
      manageOrganizationContent: true,
    },
  };
}

function detailResponse(
  overrides: Partial<DashboardTrainingContentDetailResponse["item"]> = {}
): DashboardTrainingContentDetailResponse {
  return {
    viewer: viewer(),
    org: { id: "org_1", name: "Example" },
    generatedAt: NOW,
    fileLimitsBytes: { video: 500, audio: 100, pdf: 50, docx: 25, image: 20 },
    item: {
      id: "content_1",
      title: "Coaching",
      description: "",
      focusTopicId: null,
      focusTopicName: null,
      focusTopicAvailable: true,
      contentType: "native",
      publicationState: "draft",
      displayOrder: 0,
      contentVersion: 1,
      currentAsset: null,
      assignmentSummary: {
        availableToEveryone: false,
        userCount: 0,
        managerCount: 0,
        managerTeamCount: 0,
        label: "Not assigned",
      },
      updatedByActorId: "admin",
      updatedByDisplayName: "Admin User",
      createdAt: NOW,
      updatedAt: NOW,
      publishedAt: null,
      archivedAt: null,
      nativeBody: "# Coaching",
      externalUrl: null,
      assignments: {
        availableToEveryone: false,
        users: [],
        managers: [],
        managerTeams: [],
      },
      ...overrides,
    },
  };
}

test("Training Content list proxy forwards bounded filters and explicit organization context", async () => {
  let captured: unknown;
  const response = await handleTrainingContentListGet(
    request(
      "/api/admin/training-content?orgId=org_1&q=%25_%5C%27&focusTopicId=topic_1&contentType=pdf&status=draft&sort=title_asc&page=2&pageSize=25"
    ),
    {
      listContent: async (options) => {
        captured = options;
        return {
          viewer: viewer(),
          org: { id: "org_1", name: "Example" },
          generatedAt: NOW,
          items: [],
          page: 2,
          pageSize: 25,
          total: 0,
          totalPages: 1,
          fileLimitsBytes: { video: 500, audio: 100, pdf: 50, docx: 25, image: 20 },
        } satisfies DashboardTrainingContentListResponse;
      },
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(captured, {
    orgId: "org_1",
    q: "%_\\'",
    focusTopicId: "topic_1",
    contentType: "pdf",
    status: "draft",
    sort: "title_asc",
    page: "2",
    pageSize: "25",
  });
});

test("Training Content proxy forwards create, PATCH, assignment PUT, and lifecycle bodies", async () => {
  const calls: unknown[] = [];
  const created = await handleTrainingContentCreate(
    request("/api/admin/training-content?orgId=org_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "native", title: "New content" }),
    }),
    {
      createContent: async (input, orgId) => {
        calls.push({ method: "create", input, orgId });
        return detailResponse({ title: input.title });
      },
    }
  );
  assert.equal(created.status, 201);

  const updated = await handleTrainingContentUpdate(
    request("/api/admin/training-content/content_1?orgId=org_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: NOW, title: "Updated" }),
    }),
    "content_1",
    {
      updateContent: async (contentId, input, orgId) => {
        calls.push({ method: "update", contentId, input, orgId });
        return detailResponse({ title: input.title });
      },
    }
  );
  assert.equal(updated.status, 200);

  const assignments = await handleTrainingContentAssignmentsUpdate(
    request("/api/admin/training-content/content_1/assignments?orgId=org_1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: NOW,
        availableToEveryone: true,
        userIds: ["user_1"],
        managerIds: ["manager_1"],
        managerTeamIds: ["manager_1"],
      }),
    }),
    "content_1",
    {
      updateAssignments: async (contentId, input, orgId) => {
        calls.push({ method: "assign", contentId, input, orgId });
        return detailResponse();
      },
    }
  );
  assert.equal(assignments.status, 200);

  const published = await handleTrainingContentTransition(
    request("/api/admin/training-content/content_1/publish?orgId=org_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: NOW }),
    }),
    "content_1",
    "publish",
    {
      transitionContent: async (contentId, action, input, orgId) => {
        calls.push({ method: action, contentId, input, orgId });
        return detailResponse({ publicationState: "published" });
      },
    }
  );
  assert.equal(published.status, 200);
  assert.deepEqual(calls, [
    {
      method: "create",
      input: { contentType: "native", title: "New content" },
      orgId: "org_1",
    },
    {
      method: "update",
      contentId: "content_1",
      input: { expectedUpdatedAt: NOW, title: "Updated" },
      orgId: "org_1",
    },
    {
      method: "assign",
      contentId: "content_1",
      input: {
        expectedUpdatedAt: NOW,
        availableToEveryone: true,
        userIds: ["user_1"],
        managerIds: ["manager_1"],
        managerTeamIds: ["manager_1"],
      },
      orgId: "org_1",
    },
    {
      method: "publish",
      contentId: "content_1",
      input: { expectedUpdatedAt: NOW },
      orgId: "org_1",
    },
  ]);
});

test("Training Content upload proxy returns signing metadata while bytes bypass Next.js", async () => {
  let initiatedInput: unknown;
  const initiated = await handleTrainingContentUploadInitiate(
    request("/api/admin/training-content/content_1/assets/uploads?orgId=org_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetRole: "primary",
        originalFilename: "guide.pdf",
        declaredMimeType: "application/pdf",
        declaredByteSize: 8,
        replacementAssetId: null,
      }),
    }),
    "content_1",
    {
      initiateUpload: async (contentId, input, orgId) => {
        initiatedInput = { contentId, input, orgId };
        return {
          asset: {
            id: "asset_1",
            contentId,
            assetRole: "primary",
            version: 1,
            uploadState: "pending",
            originalFilename: "guide.pdf",
            declaredMimeType: "application/pdf",
            detectedMimeType: null,
            fileExtension: "pdf",
            declaredByteSize: 8,
            byteSize: null,
            uploadExpiresAt: NOW,
            finalizedAt: null,
            supersededAt: null,
            replacementForAssetId: null,
            isCurrent: false,
            cleanupPending: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
          upload: {
            url: "https://signed-upload.invalid/private",
            expiresAt: NOW,
            method: "PUT",
            requiredHeaders: { "content-type": "application/pdf" },
          },
        };
      },
    }
  );
  assert.equal(initiated.status, 201);
  assert.deepEqual(initiatedInput, {
    contentId: "content_1",
    input: {
      assetRole: "primary",
      originalFilename: "guide.pdf",
      declaredMimeType: "application/pdf",
      declaredByteSize: 8,
      replacementAssetId: null,
    },
    orgId: "org_1",
  });
  const initiatedPayload = await initiated.json() as any;
  assert.equal(initiatedPayload.upload.url, "https://signed-upload.invalid/private");

  const finalized = await handleTrainingContentUploadFinalize(
    request("/api/admin/training-content/content_1/assets/asset_1/finalize?orgId=org_1", {
      method: "POST",
    }),
    "content_1",
    "asset_1",
    {
      finalizeUpload: async (contentId, assetId, orgId) => {
        assert.deepEqual({ contentId, assetId, orgId }, {
          contentId: "content_1",
          assetId: "asset_1",
          orgId: "org_1",
        });
        return {
          asset: {
            ...initiatedPayload.asset,
            uploadState: "ready",
            isCurrent: true,
          },
          replacedAssetId: null,
        };
      },
    }
  );
  assert.equal(finalized.status, 200);

  const access = await handleTrainingContentAssetAccess(
    request("/api/admin/training-content/content_1/assets/asset_1/access?orgId=org_1", {
      method: "POST",
    }),
    "content_1",
    "asset_1",
    {
      getAssetAccess: async () => ({
        access: {
          url: "https://signed-access.invalid/private",
          expiresAt: NOW,
          requiredHeaders: {},
        },
      }),
    }
  );
  assert.equal(access.status, 200);
  assert.equal((await access.json() as any).access.url, "https://signed-access.invalid/private");
});

test("Training Content proxy preserves structured status, code, and validation details", async () => {
  const response = await handleTrainingContentUpdate(
    request("/api/admin/training-content/content_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: NOW, title: "Stale" }),
    }),
    "content_1",
    {
      updateContent: async () => {
        throw new DashboardApiError(
          409,
          "Training Content changed in another session. Reload before saving.",
          "training_content_conflict",
          { currentUpdatedAt: "2026-07-28T12:01:00.000Z" }
        );
      },
    }
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Training Content changed in another session. Reload before saving.",
    code: "training_content_conflict",
    currentUpdatedAt: "2026-07-28T12:01:00.000Z",
  });
});

test("Training Content proxy rejects the public-site host without invoking services", async () => {
  let invoked = false;
  const response = await handleTrainingContentListGet(
    new NextRequest("https://peritio.ai/api/admin/training-content", {
      headers: { host: "peritio.ai" },
    }),
    {
      listContent: async () => {
        invoked = true;
        throw new Error("not expected");
      },
    }
  );
  assert.equal(response.status, 404);
  assert.equal(invoked, false);
});
