import { fromMarkdown } from "mdast-util-from-markdown";

import {
  TRAINING_CONTENT_LIST_SORTS,
  TRAINING_CONTENT_PUBLICATION_STATES,
  TRAINING_CONTENT_TYPES,
  type ArchiveDashboardTrainingContentCategoryRequest,
  type CreateDashboardTrainingContentRequest,
  type CreateDashboardTrainingContentCategoryRequest,
  type DashboardTrainingContentAsset,
  type DashboardTrainingContentAssignmentSelection,
  type DashboardTrainingContentAssignmentSummary,
  type DashboardTrainingContentCategory,
  type DashboardTrainingContentDetail,
  type DashboardTrainingContentFocusTopic,
  type DashboardTrainingContentLifecycleRequest,
  type DashboardTrainingContentListItem,
  type DashboardTrainingContentOrderGroup,
  type DashboardTrainingContentRelatedScenario,
  type DashboardTrainingContentScenarioOption,
  type DashboardTrainingContentTarget,
  type AppConfig,
  type EnterpriseOrg,
  type OrgTrainingRecord,
  type ReorderDashboardTrainingContentCategoriesRequest,
  type ReorderDashboardTrainingContentRequest,
  type TrainingContentAssignmentType,
  type TrainingContentFileLimitsBytes,
  type TrainingContentListSort,
  type TrainingContentPublicationState,
  type TrainingContentType,
  type UpdateDashboardTrainingContentAssignmentsRequest,
  type UpdateDashboardTrainingContentCategoryRequest,
  type UpdateDashboardTrainingContentRequest,
  type UserProfile,
} from "@voicepractice/shared";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import {
  type TrainingContentCategoryStore,
  TrainingContentCategoryStoreError,
  type TrainingContentCategorySummary,
  type TrainingContentOrderResult,
} from "../storage/trainingContentCategoryStore.js";
import {
  type TrainingContentCurrentAssetRecord,
  type TrainingContentListFilters,
  type TrainingContentManagementDetail,
  type TrainingContentManagementListRow,
  type TrainingContentStore,
  TrainingContentStoreError,
} from "../storage/trainingContentStore.js";
import { canManageTrainingContent } from "./trainingContentAuthorization.js";
import type { TrainingContentManagementRequestContext } from "./trainingContentAssetService.js";
import {
  listValidTrainingContentScenarioLinkTargets,
  resolveTrainingContentScenarioLinkDisplayTargets,
  type TrainingContentScenarioLinkService,
  TrainingContentScenarioLinkServiceError,
} from "./trainingContentScenarioLinks.js";
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
  scenarioConfig: Pick<AppConfig, "segments" | "industries" | "roleIndustries">;
  scenarioOrg: Pick<EnterpriseOrg, "id" | "activeIndustries" | "customScenarios">;
}

export interface TrainingContentManagementList {
  items: DashboardTrainingContentListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TrainingContentCategoryManagementList {
  categories: DashboardTrainingContentCategory[];
  orderRevision: string;
}

export interface TrainingContentCategoryManagementMutation {
  category: DashboardTrainingContentCategory;
  movedItemCount?: number;
  orderRevision: string;
}

export interface TrainingContentOrderManagementResult {
  groups: DashboardTrainingContentOrderGroup[];
  orderRevision: string;
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
      categoryId?: unknown;
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
  listScenarioOptions(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
  }): Promise<DashboardTrainingContentScenarioOption[]>;
  listCategories(params: {
    context: TrainingContentManagementRequestContext;
    includeArchived?: unknown;
  }): Promise<TrainingContentCategoryManagementList>;
  createCategory(params: {
    context: TrainingContentManagementRequestContext;
    input: CreateDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation>;
  updateCategory(params: {
    context: TrainingContentManagementRequestContext;
    categoryId: string;
    input: UpdateDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation>;
  reorderCategories(params: {
    context: TrainingContentManagementRequestContext;
    input: ReorderDashboardTrainingContentCategoriesRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementList>;
  archiveCategory(params: {
    context: TrainingContentManagementRequestContext;
    categoryId: string;
    input: ArchiveDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation>;
  getContentOrder(params: {
    context: TrainingContentManagementRequestContext;
  }): Promise<TrainingContentOrderManagementResult>;
  reorderContent(params: {
    context: TrainingContentManagementRequestContext;
    input: ReorderDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<TrainingContentOrderManagementResult>;
}

interface TrainingContentManagementServiceParams {
  store: TrainingContentStore;
  categoryStore: TrainingContentCategoryStore;
  entitlementStore: OrgModuleEntitlementStore;
  storageConfig: TrainingContentStorageConfig;
  scenarioLinkService: TrainingContentScenarioLinkService;
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
      categoryId?: unknown;
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
    return this.mapDetail(detail, params.context.orgId, params.references);
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
      "categoryId",
      "title",
      "description",
      "focusTopicId",
      "nativeBody",
      "externalUrl",
      "relatedScenarioIds",
    ]);
    const actor = buildActor(params.context);
    const relatedScenarioIds = params.input.relatedScenarioIds === undefined
      ? undefined
      : this.dependencies.scenarioLinkService.validateScenarioLinkTargets({
        config: params.references.scenarioConfig,
        org: params.references.scenarioOrg,
        scenarioIds: params.input.relatedScenarioIds,
      });
    const category = params.input.categoryId === undefined
      || params.input.categoryId === null
      || params.input.categoryId === ""
      ? await this.dependencies.categoryStore.ensureDefaultCategory({
        orgId: params.context.orgId,
        actor,
        now: params.now,
      })
      : await this.getRequiredActiveCategory(
        params.context.orgId,
        params.input.categoryId
      );
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
      categoryId: category.id,
      title: normalizeTitle(params.input.title),
      description: normalizeDescription(params.input.description),
      focusTopicId: focusTopic?.id ?? null,
      focusTopicNameSnapshot: focusTopic?.name ?? null,
      contentType,
      nativeBody,
      externalUrl,
      actor,
      now: params.now,
    });
    if (relatedScenarioIds !== undefined) {
      await this.dependencies.scenarioLinkService.replaceScenarioLinksForContent({
        config: params.references.scenarioConfig,
        org: params.references.scenarioOrg,
        contentId: detail.content.id,
        scenarioIds: relatedScenarioIds,
        actor,
        now: params.now,
      });
    }
    return this.mapDetail(detail, params.context.orgId, params.references);
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
      "categoryId",
      "title",
      "description",
      "focusTopicId",
      "nativeBody",
      "externalUrl",
      "relatedScenarioIds",
    ]);
    const contentId = requiredId(params.contentId, "Content id");
    const current = await this.dependencies.store.getContentDetailForOrg(
      params.context.orgId,
      contentId
    );
    if (!current) {
      throw notFoundError();
    }

    const existingScenarioIds = params.input.relatedScenarioIds === undefined
      ? []
      : (await this.dependencies.scenarioLinkService.listRawScenarioLinkCandidatesForContent(
        params.context.orgId,
        contentId
      )).map((link) => link.scenarioId);
    const relatedScenarioIds = params.input.relatedScenarioIds === undefined
      ? undefined
      : this.dependencies.scenarioLinkService.validateScenarioLinkTargets({
        config: params.references.scenarioConfig,
        org: params.references.scenarioOrg,
        scenarioIds: params.input.relatedScenarioIds,
        preservedExistingScenarioIds: existingScenarioIds,
      });

    const focusTopic = params.input.focusTopicId === undefined
      ? undefined
      : resolveFocusTopic(
        params.references,
        params.context.orgId,
        params.input.focusTopicId
      );
    const categoryId = params.input.categoryId === undefined
      ? undefined
      : (await this.getRequiredActiveCategory(
        params.context.orgId,
        params.input.categoryId
      )).id;
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt);
    const hasContentChanges = [
      params.input.categoryId,
      params.input.title,
      params.input.description,
      params.input.focusTopicId,
      params.input.nativeBody,
      params.input.externalUrl,
    ].some((value) => value !== undefined);
    if (relatedScenarioIds !== undefined && current.content.publicationState === "archived") {
      throw new TrainingContentManagementServiceError(
        "Archived Training Content cannot be edited.",
        409,
        "training_content_archived"
      );
    }
    let detail = current;
    if (hasContentChanges || relatedScenarioIds === undefined) {
      detail = await this.dependencies.store.updateContent({
        orgId: params.context.orgId,
        contentId,
        expectedUpdatedAt,
        categoryId,
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
        actor: buildActor(params.context),
        now: params.now,
      });
    } else if (expectedUpdatedAt !== current.content.updatedAt) {
      throw new TrainingContentManagementServiceError(
        "Training Content changed in another session. Reload before saving.",
        409,
        "training_content_conflict",
        { currentUpdatedAt: current.content.updatedAt }
      );
    }
    if (relatedScenarioIds !== undefined) {
      await this.dependencies.scenarioLinkService.replaceScenarioLinksForContent({
        config: params.references.scenarioConfig,
        org: params.references.scenarioOrg,
        contentId,
        scenarioIds: relatedScenarioIds,
        actor: buildActor(params.context),
        now: params.now,
        preservedExistingScenarioIds: existingScenarioIds,
      });
    }
    return this.mapDetail(detail, params.context.orgId, params.references);
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
    return this.mapDetail(detail, params.context.orgId, params.references);
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
    return this.mapDetail(detail, params.context.orgId, params.references);
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

  async listScenarioOptions(params: {
    context: TrainingContentManagementRequestContext;
    references: TrainingContentReferenceData;
  }): Promise<DashboardTrainingContentScenarioOption[]> {
    await this.authorize(params.context);
    return listValidTrainingContentScenarioLinkTargets({
      config: params.references.scenarioConfig,
      org: params.references.scenarioOrg,
    }).map((scenario) => ({
      id: scenario.scenarioId,
      title: scenario.title,
      source: scenario.source,
    }));
  }

  async listCategories(params: {
    context: TrainingContentManagementRequestContext;
    includeArchived?: unknown;
  }): Promise<TrainingContentCategoryManagementList> {
    await this.authorize(params.context);
    await this.ensureDefaultCategory(params.context);
    const result = await this.dependencies.categoryStore.listCategories({
      orgId: params.context.orgId,
      includeArchived: normalizeOptionalBoolean(params.includeArchived, "includeArchived"),
    });
    return mapCategoryList(result);
  }

  async createCategory(params: {
    context: TrainingContentManagementRequestContext;
    input: CreateDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["name", "description"]);
    const actor = buildActor(params.context);
    await this.dependencies.categoryStore.ensureDefaultCategory({
      orgId: params.context.orgId,
      actor,
      now: params.now,
    });
    const result = await this.dependencies.categoryStore.createCategory({
      orgId: params.context.orgId,
      name: normalizeCategoryName(params.input.name),
      description: normalizeCategoryDescription(params.input.description),
      actor,
      now: params.now,
    });
    return mapCategoryMutation(result);
  }

  async updateCategory(params: {
    context: TrainingContentManagementRequestContext;
    categoryId: string;
    input: UpdateDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["expectedUpdatedAt", "name", "description"]);
    if (params.input.name === undefined && params.input.description === undefined) {
      throw validationError("Provide a category name or description.");
    }
    const result = await this.dependencies.categoryStore.updateCategory({
      orgId: params.context.orgId,
      categoryId: requiredId(params.categoryId, "Category id"),
      expectedUpdatedAt: normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt),
      name: params.input.name === undefined
        ? undefined
        : normalizeCategoryName(params.input.name),
      description: params.input.description === undefined
        ? undefined
        : normalizeCategoryDescription(params.input.description),
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapCategoryMutation(result);
  }

  async reorderCategories(params: {
    context: TrainingContentManagementRequestContext;
    input: ReorderDashboardTrainingContentCategoriesRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementList> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["expectedOrderRevision", "categoryIds"]);
    const result = await this.dependencies.categoryStore.reorderCategories({
      orgId: params.context.orgId,
      categoryIds: normalizeOrderedIdArray(params.input.categoryIds, "categoryIds", 500),
      expectedOrderRevision: normalizeExpectedUpdatedAt(params.input.expectedOrderRevision),
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapCategoryList(result);
  }

  async archiveCategory(params: {
    context: TrainingContentManagementRequestContext;
    categoryId: string;
    input: ArchiveDashboardTrainingContentCategoryRequest;
    now?: Date;
  }): Promise<TrainingContentCategoryManagementMutation> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["expectedUpdatedAt", "destinationCategoryId"]);
    const result = await this.dependencies.categoryStore.archiveCategory({
      orgId: params.context.orgId,
      categoryId: requiredId(params.categoryId, "Category id"),
      destinationCategoryId: requiredString(
        params.input.destinationCategoryId,
        "destinationCategoryId",
        200
      ),
      expectedUpdatedAt: normalizeExpectedUpdatedAt(params.input.expectedUpdatedAt),
      actor: buildActor(params.context),
      now: params.now,
    });
    return {
      category: mapCategory(result.category),
      movedItemCount: result.movedItemCount,
      orderRevision: result.orderRevision,
    };
  }

  async getContentOrder(params: {
    context: TrainingContentManagementRequestContext;
  }): Promise<TrainingContentOrderManagementResult> {
    await this.authorize(params.context);
    await this.ensureDefaultCategory(params.context);
    return mapContentOrder(
      await this.dependencies.categoryStore.getContentOrder(params.context.orgId)
    );
  }

  async reorderContent(params: {
    context: TrainingContentManagementRequestContext;
    input: ReorderDashboardTrainingContentRequest;
    now?: Date;
  }): Promise<TrainingContentOrderManagementResult> {
    await this.authorize(params.context);
    assertOnlyFields(params.input, ["expectedOrderRevision", "categories"]);
    const categories = normalizeContentOrderGroups(params.input.categories);
    const result = await this.dependencies.categoryStore.reorderContent({
      orgId: params.context.orgId,
      categories,
      expectedOrderRevision: normalizeExpectedUpdatedAt(params.input.expectedOrderRevision),
      actor: buildActor(params.context),
      now: params.now,
    });
    return mapContentOrder(result);
  }

  private async ensureDefaultCategory(
    context: TrainingContentManagementRequestContext
  ): Promise<void> {
    await this.dependencies.categoryStore.ensureDefaultCategory({
      orgId: context.orgId,
      actor: buildActor(context),
    });
  }

  private async getRequiredActiveCategory(
    orgId: string,
    value: unknown
  ): Promise<{ id: string }> {
    const categoryId = requiredString(value, "categoryId", 200);
    const category = await this.dependencies.categoryStore.getActiveCategoryForOrg(
      orgId,
      categoryId
    );
    if (!category) {
      throw categoryNotFoundError();
    }
    return category;
  }

  private async mapDetail(
    detail: TrainingContentManagementDetail,
    orgId: string,
    references: TrainingContentReferenceData
  ): Promise<DashboardTrainingContentDetail> {
    const links = await this.dependencies.scenarioLinkService
      .listRawScenarioLinkCandidatesForContent(orgId, detail.content.id);
    const relatedScenarios: DashboardTrainingContentRelatedScenario[] =
      resolveTrainingContentScenarioLinkDisplayTargets({
        config: references.scenarioConfig,
        org: references.scenarioOrg,
        scenarioIds: links.map((link) => link.scenarioId),
      }).map((scenario) => ({
        id: scenario.scenarioId,
        title: scenario.title,
        available: scenario.available,
      }));
    return mapDetail(detail, orgId, references, relatedScenarios);
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
  categoryId?: unknown;
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
    categoryId: normalizeOptionalString(input.categoryId, 200),
    focusTopicId: normalizeOptionalString(input.focusTopicId, 200),
    contentType,
    publicationState,
    sort: sort ?? "library_order",
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
    categoryId: row.content.categoryId,
    categoryName: row.categoryName,
    title: row.content.title,
    description: row.content.description,
    focusTopicId: row.content.focusTopicId,
    focusTopicName: currentTopic?.name ?? row.content.focusTopicNameSnapshot,
    focusTopicAvailable: row.content.focusTopicId === null || currentTopic !== null,
    contentType: row.content.contentType,
    publicationState: row.content.publicationState,
    contentVersion: row.content.contentVersion,
    currentAsset: row.currentAsset ? mapDashboardAsset(row.currentAsset) : null,
    hasActiveVideoProcessing: row.hasActiveVideoProcessing === true,
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
  references: TrainingContentReferenceData,
  relatedScenarios: DashboardTrainingContentRelatedScenario[]
): DashboardTrainingContentDetail {
  const base = mapListItem(detail, orgId, references);
  return {
    ...base,
    nativeBody: detail.content.nativeBody,
    externalUrl: detail.content.externalUrl,
    latestVideoUploadAsset: detail.latestVideoUploadAsset
      ? mapDashboardAsset(detail.latestVideoUploadAsset)
      : null,
    assignments: mapAssignmentSelection(detail, orgId, references),
    relatedScenarios,
  };
}

function mapDashboardAsset(
  asset: TrainingContentCurrentAssetRecord
): DashboardTrainingContentAsset {
  return {
    id: asset.id,
    contentId: asset.contentId,
    assetRole: asset.assetRole,
    version: asset.version,
    uploadState: asset.uploadState,
    originalFilename: asset.originalFilename,
    declaredMimeType: asset.declaredMimeType,
    detectedMimeType: asset.detectedMimeType,
    fileExtension: asset.fileExtension,
    declaredByteSize: asset.declaredByteSize,
    byteSize: asset.byteSize,
    uploadExpiresAt: asset.uploadExpiresAt,
    processingAttemptCount: asset.processingAttemptCount,
    processingNextAttemptAt: asset.processingNextAttemptAt,
    processingErrorCategory: asset.processingErrorCategory,
    rejectionReasonCategory: asset.rejectionReasonCategory,
    finalizedAt: asset.finalizedAt,
    supersededAt: asset.supersededAt,
    replacementForAssetId: asset.replacementForAssetId,
    isCurrent: asset.isCurrent,
    cleanupPending: asset.cleanupPending,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function mapCategoryList(result: {
  categories: TrainingContentCategorySummary[];
  orderRevision: string;
}): TrainingContentCategoryManagementList {
  return {
    categories: result.categories.map(mapCategory),
    orderRevision: result.orderRevision,
  };
}

function mapCategoryMutation(result: {
  category: TrainingContentCategorySummary;
  orderRevision: string;
}): TrainingContentCategoryManagementMutation {
  return {
    category: mapCategory(result.category),
    orderRevision: result.orderRevision,
  };
}

function mapCategory(category: TrainingContentCategorySummary): DashboardTrainingContentCategory {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isDefault: category.isDefault,
    activeItemCount: category.activeItemCount,
    archivedItemCount: category.archivedItemCount,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    archivedAt: category.archivedAt,
  };
}

function mapContentOrder(result: TrainingContentOrderResult): TrainingContentOrderManagementResult {
  return {
    groups: result.groups.map((group) => ({
      categoryId: group.categoryId,
      categoryName: group.categoryName,
      items: group.items.map((item) => ({
        id: item.id,
        title: item.title,
        categoryId: item.categoryId,
        publicationState: item.publicationState,
      })),
    })),
    orderRevision: result.orderRevision,
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

function normalizeCategoryName(value: unknown): string {
  return requiredString(value, "name", 120);
}

function normalizeCategoryDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw validationError("Category description must be text.", { field: "description" });
  }
  const normalized = value.trim();
  if (normalized.length > 1_000) {
    throw validationError("Category description must be 1,000 characters or fewer.", {
      field: "description",
    });
  }
  return normalized;
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

function normalizeOrderedIdArray(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array.`, { field });
  }
  if (value.length > limit) {
    throw validationError(`${field} cannot contain more than ${limit} entries.`, { field });
  }
  const normalized = value.map((entry) => requiredString(entry, field, 200));
  if (normalized.length !== new Set(normalized).size) {
    throw validationError(`${field} cannot contain duplicate IDs.`, { field });
  }
  return normalized;
}

function normalizeContentOrderGroups(
  value: unknown
): Array<{ categoryId: string; contentIds: string[] }> {
  if (!Array.isArray(value)) {
    throw validationError("categories must be an array.", { field: "categories" });
  }
  if (value.length > 500) {
    throw validationError("categories cannot contain more than 500 entries.", {
      field: "categories",
    });
  }
  const groups = value.map((entry, index) => {
    assertOnlyFields(entry, ["categoryId", "contentIds"]);
    const record = entry as { categoryId?: unknown; contentIds?: unknown };
    return {
      categoryId: requiredString(record.categoryId, `categories[${index}].categoryId`, 200),
      contentIds: normalizeOrderedIdArray(
        record.contentIds,
        `categories[${index}].contentIds`,
        2_000
      ),
    };
  });
  if (groups.length !== new Set(groups.map((entry) => entry.categoryId)).size) {
    throw validationError("categories cannot contain duplicate category IDs.", {
      field: "categories",
    });
  }
  const contentIds = groups.flatMap((entry) => entry.contentIds);
  if (contentIds.length > 2_000) {
    throw validationError("Content order cannot contain more than 2,000 items.", {
      field: "categories",
    });
  }
  if (contentIds.length !== new Set(contentIds).size) {
    throw validationError("Content order cannot contain duplicate item IDs.", {
      field: "categories",
    });
  }
  return groups;
}

function normalizeOptionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null || value === "" || value === false || value === "false") {
    return false;
  }
  if (value === true || value === "true") {
    return true;
  }
  throw validationError(`${field} must be true or false.`, { field });
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

function categoryNotFoundError(): TrainingContentManagementServiceError {
  return new TrainingContentManagementServiceError(
    "Content Category was not found.",
    404,
    "training_content_category_not_found"
  );
}

export function mapTrainingContentManagementServiceError(
  error: unknown
): TrainingContentManagementServiceError {
  if (error instanceof TrainingContentManagementServiceError) {
    return error;
  }
  if (error instanceof TrainingContentScenarioLinkServiceError) {
    return new TrainingContentManagementServiceError(
      "One or more selected scenarios is not available to this organization.",
      400,
      "training_content_invalid_scenario",
      { field: "relatedScenarioIds" }
    );
  }
  if (error instanceof TrainingContentStoreError) {
    const status = error.code === "training_content_not_found"
      || error.code === "training_content_category_not_found"
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
  if (error instanceof TrainingContentCategoryStoreError) {
    const status = error.code === "training_content_category_not_found"
      ? 404
      : error.code === "training_content_category_reorder_invalid"
        || error.code === "training_content_reorder_invalid"
        ? 400
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
