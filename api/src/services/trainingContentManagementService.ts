import { fromMarkdown } from "mdast-util-from-markdown";

import {
  TRAINING_CONTENT_LIST_SORTS,
  TRAINING_CONTENT_PUBLICATION_STATES,
  TRAINING_CONTENT_TYPES,
  type CreateDashboardTrainingContentRequest,
  type DashboardTrainingContentAsset,
  type DashboardTrainingContentAssignmentSelection,
  type DashboardTrainingContentAssignmentSummary,
  type DashboardTrainingContentDetail,
  type DashboardTrainingContentFocusTopic,
  type DashboardTrainingContentLifecycleRequest,
  type DashboardTrainingContentListItem,
  type DashboardTrainingContentTarget,
  type OrgTrainingRecord,
  type TrainingContentAssignmentType,
  type TrainingContentFileLimitsBytes,
  type TrainingContentListSort,
  type TrainingContentPublicationState,
  type TrainingContentType,
  type UpdateDashboardTrainingContentAssignmentsRequest,
  type UpdateDashboardTrainingContentRequest,
  type UserProfile,
} from "@voicepractice/shared";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import {
  type TrainingContentListFilters,
  type TrainingContentManagementDetail,
  type TrainingContentManagementListRow,
  type TrainingContentStore,
  TrainingContentStoreError,
} from "../storage/trainingContentStore.js";
import { canManageTrainingContent } from "./trainingContentAuthorization.js";
import type { TrainingContentManagementRequestContext } from "./trainingContentAssetService.js";
import { isEligibleManagerUser, resolveStoredUserDisplayName } from "./userProfiles.js";

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2_000;
const NATIVE_BODY_MAX_BYTES = 512 * 1024;
const EXTERNAL_URL_MAX_LENGTH = 2_048;
const TARGET_LIMIT = 50;
const FOCUS_TOPIC_LIMIT = 200;
const USER_SEARCH_MIN_LENGTH = 2;
const CONTENT_TYPE_SET = new Set<string>(TRAINING_CONTENT_TYPES);
const PUBLICATION_STATE_SET = new Set<string>(TRAINING_CONTENT_PUBLICATION_STATES);
const LIST_SORT_SET = new Set<string>(TRAINING_CONTENT_LIST_SORTS);

export interface TrainingContentReferenceData {
  users: readonly UserProfile[];
  focusTopics: readonly OrgTrainingRecord[];
}

export interface TrainingContentManagementList {
  items: DashboardTrainingContentListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export class TrainingContentManagementServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "TrainingContentManagementServiceError";
  }
}

export interface TrainingContentManagementService {
  getFileLimits(): TrainingContentFileLimitsBytes;
  listContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    filters?: {
      query?: unknown;
      focusTopicId?: unknown;
      contentType?: unknown;
      publicationState?: unknown;
      sort?: unknown;
      page?: unknown;
      pageSize?: unknown;
    };
  }): Promise<TrainingContentManagementList>;
  getContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
  }): Promise<DashboardTrainingContentDetail>;
  createContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    input: CreateDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail>;
  updateContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    input: UpdateDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail>;
  updateAssignments(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    input: UpdateDashboardTrainingContentAssignmentsRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail>;
  transitionContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    action: "publish" | "unpublish" | "archive";
    input: DashboardTrainingContentLifecycleRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail>;
  listUserTargets(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    query: unknown;
  }): Promise<DashboardTrainingContentTarget[]>;
  listManagerTargets(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    query: unknown;
  }): Promise<DashboardTrainingContentTarget[]>;
  listFocusTopics(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
  }): Promise<DashboardTrainingContentFocusTopic[]>;
}

interface TrainingContentManagementServiceParams {
  store: TrainingContentStore;
  entitlementStore: OrgModuleEntitlementStore;
  storageConfig: TrainingContentStorageConfig;
}

class DefaultTrainingContentManagementService implements TrainingContentManagementService {
  constructor(private readonly dependencies: TrainingContentManagementServiceParams) {}

  getFileLimits(): TrainingContentFileLimitsBytes {
    return { ...this.dependencies.storageConfig.fileSizeLimits };
  }

  async listContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    filters?: {
      query?: unknown;
      focusTopicId?: unknown;
      contentType?: unknown;
      publicationState?: unknown;
      sort?: unknown;
      page?: unknown;
      pageSize?: unknown;
    };
  }): Promise<TrainingContentManagementList> {
    await this.authorize(params.context);
    const filters = normalizeListFilters(params.filters ?? {});
    const result = await this.dependencies.store.listContentForManagement(
      params.context.orgId,
      filters
    );
    return {
      ...result,
      items: result.items.map((row) =>
        mapListItem(row, params.context.orgId, params.references)
      ),
    };
  }

  async getContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
  }): Promise<DashboardTrainingContentDetail> {
    await this.authorize(params.context);
    const detail = await this.dependencies.store.getContentDetailForOrg(
      params.context.orgId,
      requiredId(params.contentId, "Content id")
    );
    if (!detail) {
      throw notFoundError();
    }
    return mapDetail(detail, params.context.orgId, params.references);
  }

  async createContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    input: CreateDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, [
      "contentType",
      "title",
      "description",
      "focusTopicId",
      "nativeBody",
      "externalUrl",
      "displayOrder",
    ]);
    const contentType = normalizeContentType(params.input.contentType);
    const focusTopic = resolveFocusTopic(
      params.references,
      params.context.orgId,
      params.input.focusTopicId
    );
    const nativeBody = normalizeNativeBodyForType(params.input.nativeBody, contentType);
    const externalUrl = normalizeExternalUrlForType(params.input.externalUrl, contentType);
    const detail = await this.dependencies.store.createContent({
      orgId: params.context.orgId,
      title: normalizeTitle(params.input.title),
      description: normalizeDescription(params.input.description),
      focusTopicId: focusTopic?.id ?? null,
      focusTopicNameSnapshot: focusTopic?.name ?? null,
      contentType,
      nativeBody,
      externalUrl,
      displayOrder: normalizeDisplayOrder(params.input.displayOrder),
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapDetail(detail, params.context.orgId, params.references);
  }

  async updateContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    input: UpdateDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, [
      "expectedUpdatedAt",
      "title",
      "description",
      "focusTopicId",
      "nativeBody",
      "externalUrl",
      "displayOrder",
    ]);
    const contentId = requiredId(params.contentId, "Content id");
    const current = await this.dependencies.store.getContentDetailForOrg(
      params.context.orgId,
      contentId
    );
    if (!current) {
      throw notFoundError();
    }

    const focusTopic = params.input.focusTopicId === undefined
      ? undefined
      : resolveFocusTopic(
        params.references,
        params.context.orgId,
        params.input.focusTopicId
      );
    const detail = await this.dependencies.store.updateContent({
      orgId: params.context.orgId,
      contentId,
      expectedUpdatedAt: normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt),
      title: params.input.title === undefined ? undefined : normalizeTitle(params.input.title),
      description: params.input.description === undefined
        ? undefined
        : normalizeDescription(params.input.description),
      focusTopicId: params.input.focusTopicId === undefined ? undefined : focusTopic?.id ?? null,
      focusTopicNameSnapshot: params.input.focusTopicId === undefined
        ? undefined
        : focusTopic?.name ?? null,
      nativeBody: params.input.nativeBody === undefined
        ? undefined
        : normalizeNativeBodyForType(params.input.nativeBody, current.content.contentType),
      externalUrl: params.input.externalUrl === undefined
        ? undefined
        : normalizeExternalUrlForType(params.input.externalUrl, current.content.contentType),
      displayOrder: params.input.displayOrder === undefined
        ? undefined
        : normalizeDisplayOrder(params.input.displayOrder),
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapDetail(detail, params.context.orgId, params.references);
  }

  async updateAssignments(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    input: UpdateDashboardTrainingContentAssignmentsRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, [
      "expectedUpdatedAt",
      "availableToEveryone",
      "userIds",
      "managerIds",
      "managerTeamIds",
    ]);
    if (typeof params.input.availableToEveryone !== "boolean") {
      throw validationError("availableToEveryone must be true or false.");
    }

    const usersById = new Map(
      params.references.users
        .filter((user) => user.accountType === "enterprise" && user.orgId === params.context.orgId)
        .map((user) => [user.id, user])
    );
    const userIds = normalizeIdArray(params.input.userIds, "userIds");
    const managerIds = normalizeIdArray(params.input.managerIds, "managerIds");
    const managerTeamIds = normalizeIdArray(params.input.managerTeamIds, "managerTeamIds");
    for (const userId of userIds) {
      const user = usersById.get(userId) ?? null;
      if (!isActiveOrganizationUser(user, params.context.orgId)) {
        throw validationError("A selected user is no longer active in this organization.", {
          field: "userIds",
        });
      }
    }
    for (const managerId of new Set([...managerIds, ...managerTeamIds])) {
      const manager = usersById.get(managerId) ?? null;
      if (!manager || !isEligibleManagerUser(manager, params.context.orgId)) {
        throw validationError(
          "A selected manager is no longer an active User Admin in this organization.",
          { field: "managerIds" }
        );
      }
    }

    const assignments: Array<{
      assignmentType: TrainingContentAssignmentType;
      subjectUserId: string | null;
    }> = [];
    if (params.input.availableToEveryone) {
      assignments.push({ assignmentType: "organization", subjectUserId: null });
    }
    assignments.push(
      ...userIds.map((subjectUserId) => ({
        assignmentType: "user" as const,
        subjectUserId,
      })),
      ...managerIds.map((subjectUserId) => ({
        assignmentType: "manager" as const,
        subjectUserId,
      })),
      ...managerTeamIds.map((subjectUserId) => ({
        assignmentType: "manager_team" as const,
        subjectUserId,
      }))
    );
    const current = await this.dependencies.store.getContentDetailForOrg(
      params.context.orgId,
      requiredId(params.contentId, "Content id")
    );
    if (!current) {
      throw notFoundError();
    }
    if (current.content.publicationState === "published") {
      assertHasEffectiveAssignment(
        assignments.map((assignment) => ({ ...assignment, revokedAt: null })),
        params.context.orgId,
        params.references
      );
    }
    const detail = await this.dependencies.store.replaceAssignments({
      orgId: params.context.orgId,
      contentId: current.content.id,
      expectedUpdatedAt: normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt),
      assignments,
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapDetail(detail, params.context.orgId, params.references);
  }

  async transitionContent(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    contentId: string;
    action: "publish" | "unpublish" | "archive";
    input: DashboardTrainingContentLifecycleRequest;
    now?: Date;
  }): Promise<DashboardTrainingContentDetail> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["expectedUpdatedAt"]);
    if (params.action === "publish") {
      const current = await this.dependencies.store.getContentDetailForOrg(
        params.context.orgId,
        requiredId(params.contentId, "Content id")
      );
      if (!current) {
        throw notFoundError();
      }
      assertHasEffectiveAssignment(
        current.assignments,
        params.context.orgId,
        params.references
      );
    }
    const detail = await this.dependencies.store.transitionContent({
      orgId: params.context.orgId,
      contentId: requiredId(params.contentId, "Content id"),
      expectedUpdatedAt: normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt),
      action: params.action,
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapDetail(detail, params.context.orgId, params.references);
  }

  async listUserTargets(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    query: unknown;
  }): Promise<DashboardTrainingContentTarget[]> {
    await this.authorize(params.context);
    const query = normalizeSearchQuery(params.query);
    if (query.length < USER_SEARCH_MIN_LENGTH) {
      return [];
    }
    return searchTargets({
      users: params.references.users,
      orgId: params.context.orgId,
      query,
      managersOnly: false,
    });
  }

  async listManagerTargets(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
    query: unknown;
  }): Promise<DashboardTrainingContentTarget[]> {
    await this.authorize(params.context);
    return searchTargets({
      users: params.references.users,
      orgId: params.context.orgId,
      query: normalizeSearchQuery(params.query),
      managersOnly: true,
    });
  }

  async listFocusTopics(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
  }): Promise<DashboardTrainingContentFocusTopic[]> {
    await this.authorize(params.context);
    return params.references.focusTopics
      .filter((topic) => topic.orgId === params.context.orgId && topic.status !== "archived")
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
      .slice(0, FOCUS_TOPIC_LIMIT)
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        status: topic.status,
      }));
  }

  private async authorize(context: TrainingContentManagementRequestContext): Promise<void> {
    const orgId = requiredId(context.orgId, "Organization id");
    const entitlement = await this.dependencies.entitlementStore.getOrgModuleEntitlement(
      orgId,
      "training_content"
    );
    if (!entitlement.enabled) {
      throw new TrainingContentManagementServiceError(
        "Training Content is not enabled for this organization.",
        403,
        "module_disabled",
        { moduleKey: "training_content" }
      );
    }
    if (!canManageTrainingContent(context, entitlement)) {
      throw new TrainingContentManagementServiceError(
        "Training Content administration is not available for this account.",
        403,
        "dashboard_scope_denied"
      );
    }
  }
}

function normalizeListFilters(input: {
  query?: unknown;
  focusTopicId?: unknown;
  contentType?: unknown;
  publicationState?: unknown;
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): TrainingContentListFilters {
  const contentType = normalizeOptionalEnum(
    input.contentType,
    CONTENT_TYPE_SET,
    "contentType"
  ) as TrainingContentType | null;
  const publicationState = normalizeOptionalEnum(
    input.publicationState,
    PUBLICATION_STATE_SET,
    "status"
  ) as TrainingContentPublicationState | null;
  const sort = normalizeOptionalEnum(input.sort, LIST_SORT_SET, "sort") as
    | TrainingContentListSort
    | null;
  return {
    query: normalizeOptionalString(input.query, 200),
    focusTopicId: normalizeOptionalString(input.focusTopicId, 200),
    contentType,
    publicationState,
    sort: sort ?? "updated_desc",
    page: normalizeQueryInteger(input.page, "page", 1, 10_000, 1),
    pageSize: normalizeQueryInteger(input.pageSize, "pageSize", 1, 100, 25),
  };
}

function mapListItem(
  row: TrainingContentManagementListRow,
  orgId: string,
  references: TrainingContentReferenceData
): DashboardTrainingContentListItem {
  const currentTopic = row.content.focusTopicId
    ? references.focusTopics.find(
      (topic) =>
        topic.id === row.content.focusTopicId
        && topic.orgId === orgId
        && topic.status !== "archived"
    ) ?? null
    : null;
  const updatedBy = references.users.find(
    (user) => user.id === row.content.updatedByActorId && user.orgId === orgId
  ) ?? null;
  return {
    id: row.content.id,
    title: row.content.title,
    description: row.content.description,
    focusTopicId: row.content.focusTopicId,
    focusTopicName: currentTopic?.name ?? row.content.focusTopicNameSnapshot,
    focusTopicAvailable: row.content.focusTopicId === null || currentTopic !== null,
    contentType: row.content.contentType,
    publicationState: row.content.publicationState,
    displayOrder: row.content.displayOrder,
    contentVersion: row.content.contentVersion,
    currentAsset: row.currentAsset ? {
      id: row.currentAsset.id,
      contentId: row.currentAsset.contentId,
      assetRole: row.currentAsset.assetRole,
      version: row.currentAsset.version,
      uploadState: row.currentAsset.uploadState,
      originalFilename: row.currentAsset.originalFilename,
      declaredMimeType: row.currentAsset.declaredMimeType,
      detectedMimeType: row.currentAsset.detectedMimeType,
      fileExtension: row.currentAsset.fileExtension,
      declaredByteSize: row.currentAsset.declaredByteSize,
      byteSize: row.currentAsset.byteSize,
      uploadExpiresAt: row.currentAsset.uploadExpiresAt,
      finalizedAt: row.currentAsset.finalizedAt,
      supersededAt: row.currentAsset.supersededAt,
      replacementForAssetId: row.currentAsset.replacementForAssetId,
      isCurrent: row.currentAsset.isCurrent,
      cleanupPending: row.currentAsset.cleanupPending,
      createdAt: row.currentAsset.createdAt,
      updatedAt: row.currentAsset.updatedAt,
    } satisfies DashboardTrainingContentAsset : null,
    assignmentSummary: buildAssignmentSummary(row),
    updatedByActorId: row.content.updatedByActorId,
    updatedByDisplayName: updatedBy ? resolveStoredUserDisplayName(updatedBy) : null,
    createdAt: row.content.createdAt,
    updatedAt: row.content.updatedAt,
    publishedAt: row.content.publishedAt,
    archivedAt: row.content.archivedAt,
  };
}

function mapDetail(
  detail: TrainingContentManagementDetail,
  orgId: string,
  references: TrainingContentReferenceData
): DashboardTrainingContentDetail {
  const base = mapListItem(detail, orgId, references);
  return {
    ...base,
    nativeBody: detail.content.nativeBody,
    externalUrl: detail.content.externalUrl,
    assignments: mapAssignmentSelection(detail, orgId, references),
  };
}

function mapAssignmentSelection(
  detail: TrainingContentManagementDetail,
  orgId: string,
  references: TrainingContentReferenceData
): DashboardTrainingContentAssignmentSelection {
  const byType = (assignmentType: TrainingContentAssignmentType) =>
    detail.assignments.filter((assignment) => assignment.assignmentType === assignmentType);
  return {
    availableToEveryone: byType("organization").length > 0,
    users: byType("user").map((assignment) =>
      mapStoredTarget(assignment.subjectUserId, orgId, references, false)
    ),
    managers: byType("manager").map((assignment) =>
      mapStoredTarget(assignment.subjectUserId, orgId, references, true)
    ),
    managerTeams: byType("manager_team").map((assignment) =>
      mapStoredTarget(assignment.subjectUserId, orgId, references, true)
    ),
  };
}

function mapStoredTarget(
  userId: string | null,
  orgId: string,
  references: TrainingContentReferenceData,
  managerRequired: boolean
): DashboardTrainingContentTarget {
  const user = userId
    ? references.users.find((candidate) => candidate.id === userId && candidate.orgId === orgId) ?? null
    : null;
  if (!user || !userId) {
    return {
      userId: userId ?? "unavailable",
      displayName: "Unavailable user",
      email: "Unavailable",
      employeeId: null,
      orgRole: "user",
      status: "disabled",
      available: false,
    };
  }
  return toTarget(
    user,
    managerRequired
      ? isEligibleManagerUser(user, orgId)
      : isActiveOrganizationUser(user, orgId)
  );
}

function buildAssignmentSummary(
  row: TrainingContentManagementListRow
): DashboardTrainingContentAssignmentSummary {
  const counts = row.assignmentCounts;
  const parts: string[] = [];
  if (counts.organization > 0) {
    parts.push("Everyone");
  }
  if (counts.user > 0) {
    parts.push(`${counts.user} user${counts.user === 1 ? "" : "s"}`);
  }
  if (counts.manager > 0) {
    parts.push(`${counts.manager} manager${counts.manager === 1 ? "" : "s"}`);
  }
  if (counts.managerTeam > 0) {
    parts.push(`${counts.managerTeam} team${counts.managerTeam === 1 ? "" : "s"}`);
  }
  return {
    availableToEveryone: counts.organization > 0,
    userCount: counts.user,
    managerCount: counts.manager,
    managerTeamCount: counts.managerTeam,
    label: parts.length > 0 ? parts.join(" + ") : "Not assigned",
  };
}

function searchTargets(params: {
  users: readonly UserProfile[];
  orgId: string;
  query: string;
  managersOnly: boolean;
}): DashboardTrainingContentTarget[] {
  const query = params.query.toLocaleLowerCase();
  return params.users
    .filter((user) =>
      params.managersOnly
        ? isEligibleManagerUser(user, params.orgId)
        : isActiveOrganizationUser(user, params.orgId)
    )
    .filter((user) => {
      if (!query) {
        return true;
      }
      return [
        user.firstName ?? "",
        user.lastName ?? "",
        resolveStoredUserDisplayName(user),
        user.email,
        user.employeeId ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(query));
    })
    .sort((left, right) => {
      const nameDelta = resolveStoredUserDisplayName(left).localeCompare(
        resolveStoredUserDisplayName(right),
        undefined,
        { sensitivity: "base" }
      );
      return nameDelta !== 0 ? nameDelta : left.email.localeCompare(right.email);
    })
    .slice(0, TARGET_LIMIT)
    .map((user) => toTarget(user, true));
}

function toTarget(user: UserProfile, available: boolean): DashboardTrainingContentTarget {
  return {
    userId: user.id,
    displayName: resolveStoredUserDisplayName(user),
    email: user.email,
    employeeId: user.employeeId,
    orgRole: user.orgRole,
    status: user.status,
    available,
  };
}

function isActiveOrganizationUser(user: UserProfile | null, orgId: string): user is UserProfile {
  return Boolean(
    user
    && user.accountType === "enterprise"
    && user.orgId === orgId
    && user.status === "active"
  );
}

function assertHasEffectiveAssignment(
  assignments: readonly {
    assignmentType: TrainingContentAssignmentType;
    subjectUserId: string | null;
    revokedAt: string | null;
  }[],
  orgId: string,
  references: TrainingContentReferenceData
): void {
  const usersById = new Map(
    references.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === orgId)
      .map((user) => [user.id, user])
  );
  const hasEffectiveAssignment = assignments.some((assignment) => {
    if (assignment.revokedAt !== null) {
      return false;
    }
    if (assignment.assignmentType === "organization") {
      return true;
    }
    const user = assignment.subjectUserId
      ? usersById.get(assignment.subjectUserId) ?? null
      : null;
    return assignment.assignmentType === "user"
      ? isActiveOrganizationUser(user, orgId)
      : Boolean(user && isEligibleManagerUser(user, orgId));
  });
  if (!hasEffectiveAssignment) {
    throw new TrainingContentManagementServiceError(
      "Training Content is not ready to publish.",
      422,
      "training_content_publish_invalid",
      { reasons: ["assignment_required"] }
    );
  }
}

function resolveFocusTopic(
  references: TrainingContentReferenceData,
  orgId: string,
  value: unknown
): OrgTrainingRecord | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const focusTopicId = requiredString(value, "focusTopicId", 200);
  const topic = references.focusTopics.find(
    (candidate) =>
      candidate.id === focusTopicId
      && candidate.orgId === orgId
      && candidate.status !== "archived"
  ) ?? null;
  if (!topic) {
    throw validationError("Focus Topic is no longer available for this organization.", {
      field: "focusTopicId",
    });
  }
  return topic;
}

function normalizeContentType(value: unknown): TrainingContentType {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!CONTENT_TYPE_SET.has(normalized)) {
    throw validationError("Select a supported Training Content type.", { field: "contentType" });
  }
  return normalized as TrainingContentType;
}

function normalizeTitle(value: unknown): string {
  return requiredString(value, "title", TITLE_MAX_LENGTH);
}

function normalizeDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw validationError("Description must be text.", { field: "description" });
  }
  const normalized = value.trim();
  if (normalized.length > DESCRIPTION_MAX_LENGTH) {
    throw validationError(
      `Description must be ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      { field: "description" }
    );
  }
  return normalized;
}

function normalizeNativeBodyForType(
  value: unknown,
  contentType: TrainingContentType
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (contentType !== "native") {
    throw validationError("Native body is only valid for Native Peritio content.", {
      field: "nativeBody",
    });
  }
  if (typeof value !== "string") {
    throw validationError("Native body must be Markdown text.", { field: "nativeBody" });
  }
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") > NATIVE_BODY_MAX_BYTES) {
    throw validationError("Native content must be 512 KB or smaller.", {
      field: "nativeBody",
    });
  }
  validateNativeMarkdown(normalized);
  return normalized || null;
}

function validateNativeMarkdown(markdown: string): void {
  const tree = fromMarkdown(markdown) as unknown as MarkdownNode;
  visitMarkdownNode(tree, (node) => {
    if (node.type === "html") {
      throw validationError("Raw HTML is not supported in Native Peritio content.", {
        field: "nativeBody",
      });
    }
    if (node.type === "image" || node.type === "imageReference") {
      throw validationError("Inline images are not supported in Native Peritio content.", {
        field: "nativeBody",
      });
    }
    if (
      (node.type === "link" || node.type === "definition")
      && typeof node.url === "string"
      && !isSafeNativeLink(node.url)
    ) {
      throw validationError("Native content links must use a safe HTTPS or email address.", {
        field: "nativeBody",
      });
    }
  });
}

interface MarkdownNode {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
}

function visitMarkdownNode(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void {
  visitor(node);
  for (const child of node.children ?? []) {
    visitMarkdownNode(child, visitor);
  }
}

function isSafeNativeLink(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "https:" || parsed.protocol === "mailto:")
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function normalizeExternalUrlForType(
  value: unknown,
  contentType: TrainingContentType
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (contentType !== "external_url") {
    throw validationError("External URL is only valid for External URL content.", {
      field: "externalUrl",
    });
  }
  if (typeof value !== "string") {
    throw validationError("External URL must be a valid HTTPS URL.", { field: "externalUrl" });
  }
  const normalized = value.trim();
  if (normalized.length > EXTERNAL_URL_MAX_LENGTH) {
    throw validationError("External URL is too long.", { field: "externalUrl" });
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("unsafe");
    }
    return parsed.toString();
  } catch {
    throw validationError(
      "External URL must use HTTPS and cannot contain embedded credentials.",
      { field: "externalUrl" }
    );
  }
}

function normalizeDisplayOrder(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    throw validationError("Display order must be a whole number from 0 to 1,000,000.", {
      field: "displayOrder",
    });
  }
  return Number(value);
}

function normalizeExpectedUpdatedAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError("expectedUpdatedAt is required.", { field: "expectedUpdatedAt" });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError("expectedUpdatedAt is invalid.", { field: "expectedUpdatedAt" });
  }
  return parsed.toISOString();
}

function normalizeIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`, { field });
  }
  if (value.length > 500) {
    throw validationError(`${field} cannot contain more than 500 entries.`, { field });
  }
  const normalized = value.map((entry) => requiredString(entry, field, 200));
  return [...new Set(normalized)].sort();
}

function normalizeSearchQuery(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw validationError("Search query must be text.", { field: "q" });
  }
  return value.trim().slice(0, 120);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw validationError("Filter value must be text.");
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw validationError("Filter value is too long.");
  }
  return normalized || null;
}

function normalizeOptionalEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string
): string | null {
  const normalized = normalizeOptionalString(value, 80);
  if (normalized && !allowed.has(normalized)) {
    throw validationError(`${field} is invalid.`, { field });
  }
  return normalized;
}

function normalizeQueryInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) < minimum || Number(parsed) > maximum) {
    throw validationError(`${field} must be from ${minimum} to ${maximum}.`, { field });
  }
  return Number(parsed);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`${field === "title" ? "Title" : field} is required.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw validationError(`${field} must be ${maxLength.toLocaleString()} characters or fewer.`, {
      field,
    });
  }
  return normalized;
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw validationError(`${label} is required.`);
  }
  return normalized;
}

function assertOnlyFields(value: unknown, allowedFields: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Request body must be a JSON object.");
  }
  const allowed = new Set(allowedFields);
  const unknownFields = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknownFields.length > 0) {
    throw validationError("The request contains unsupported fields.", {
      fields: unknownFields.sort(),
    });
  }
}

function buildActor(context: TrainingContentManagementRequestContext) {
  return {
    actorType: "web_user" as const,
    actorId: requiredId(context.actorId, "Actor id"),
  };
}

function validationError(
  message: string,
  details: Record<string, unknown> | null = null
): TrainingContentManagementServiceError {
  return new TrainingContentManagementServiceError(
    message,
    400,
    "training_content_invalid",
    details
  );
}

function notFoundError(): TrainingContentManagementServiceError {
  return new TrainingContentManagementServiceError(
    "Training Content item was not found.",
    404,
    "training_content_not_found"
  );
}

export function mapTrainingContentManagementServiceError(
  error: unknown
): TrainingContentManagementServiceError {
  if (error instanceof TrainingContentManagementServiceError) {
    return error;
  }
  if (error instanceof TrainingContentStoreError) {
    const status = error.code === "training_content_not_found"
      ? 404
      : error.code === "training_content_publish_invalid"
        ? 422
        : 409;
    return new TrainingContentManagementServiceError(
      error.message,
      status,
      error.code,
      error.details
    );
  }
  return new TrainingContentManagementServiceError(
    "Training Content operation failed.",
    500,
    "training_content_operation_failed"
  );
}

export function createTrainingContentManagementService(
  params: TrainingContentManagementServiceParams
): TrainingContentManagementService {
  return new DefaultTrainingContentManagementService(params);
}
