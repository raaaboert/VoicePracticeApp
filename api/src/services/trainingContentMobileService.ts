import type {
  AppConfig,
  MobileModuleAvailabilityResponse,
  MobileRelatedPracticeScenarioSummary,
  MobileRelatedPracticeScenariosResponse,
  MobileTrainingContentAssetAccessResponse,
  MobileTrainingContentCategoriesResponse,
  MobileTrainingContentDetail,
  MobileTrainingContentDetailResponse,
  MobileTrainingContentLibraryResponse,
  MobileTrainingContentSummary,
  TrainingContentType,
  UserProfile,
} from "@voicepractice/shared";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import type { TrainingContentObjectStorage } from "../storage/trainingContentObjectStorage.js";
import type {
  TrainingContentMobileReadRecord,
  TrainingContentStore,
} from "../storage/trainingContentStore.js";
import { resolveTrainingContentEligibility } from "./trainingContentEligibility.js";
import type { TrainingContentScenarioLinkService } from "./trainingContentScenarioLinks.js";
import type { TrainingContentStorageReadinessService } from "./trainingContentStorageReadiness.js";

export interface MobileTrainingContentRequestContext {
  user: UserProfile;
  users: readonly UserProfile[];
  organizationActive: boolean;
  scenarioConfig: Pick<
    AppConfig,
    "industries" | "roleIndustries" | "segments" | "orgCustomScenarios" | "orgTrainings"
  >;
}

export class TrainingContentMobileServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "TrainingContentMobileServiceError";
  }
}

export interface TrainingContentMobileService {
  getModules(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileModuleAvailabilityResponse>;
  getLibrary(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileTrainingContentLibraryResponse>;
  getCategories(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileTrainingContentCategoriesResponse>;
  getRelatedForScenario(
    context: MobileTrainingContentRequestContext,
    scenarioId: string,
    trainingId?: string | null
  ): Promise<MobileTrainingContentLibraryResponse>;
  getRelatedScenariosForContent(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ): Promise<MobileRelatedPracticeScenariosResponse>;
  getDetail(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ): Promise<MobileTrainingContentDetailResponse>;
  createAssetAccess(
    context: MobileTrainingContentRequestContext,
    contentId: string,
    now?: Date
  ): Promise<MobileTrainingContentAssetAccessResponse>;
}

interface TrainingContentMobileServiceDependencies {
  store: TrainingContentStore;
  scenarioLinkService: Pick<
    TrainingContentScenarioLinkService,
    | "listRawContentLinkCandidateIdsForScenario"
    | "listRawScenarioLinkCandidatesForContent"
  >;
  entitlementStore: OrgModuleEntitlementStore;
  objectStorage: TrainingContentObjectStorage;
  readiness: TrainingContentStorageReadinessService;
  storageConfig: TrainingContentStorageConfig;
}

const MOBILE_LIBRARY_LIMIT = 500;
const UPLOADED_CONTENT_TYPES = new Set<TrainingContentType>([
  "video",
  "audio",
  "pdf",
  "docx",
  "image",
]);

class DefaultTrainingContentMobileService implements TrainingContentMobileService {
  constructor(private readonly dependencies: TrainingContentMobileServiceDependencies) {}

  async getModules(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileModuleAvailabilityResponse> {
    const orgId = requireActiveMembership(context);
    const entitlement = await this.dependencies.entitlementStore.getOrgModuleEntitlement(
      orgId,
      "training_content"
    );
    return {
      modules: {
        trainingContent: {
          enabled: entitlement.enabled,
        },
      },
    };
  }

  async getLibrary(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileTrainingContentLibraryResponse> {
    const orgId = await this.requireEnabledModule(context);
    const result = await this.dependencies.store.listPublishedContentForMobile(
      orgId,
      MOBILE_LIBRARY_LIMIT
    );
    return buildLibrary(
      result.items.filter((record) => isEligible(record, context, orgId)),
      result.truncated
    );
  }

  async getCategories(
    context: MobileTrainingContentRequestContext
  ): Promise<MobileTrainingContentCategoriesResponse> {
    const library = await this.getLibrary(context);
    return { categories: library.categories };
  }

  async getRelatedForScenario(
    context: MobileTrainingContentRequestContext,
    scenarioId: string,
    trainingId?: string | null
  ): Promise<MobileTrainingContentLibraryResponse> {
    const orgId = await this.requireEnabledModule(context);
    const normalizedScenarioId = scenarioId.trim();
    if (
      !normalizedScenarioId
      || !isScenarioAvailableToMobileUser(
        context.scenarioConfig,
        orgId,
        normalizedScenarioId,
        trainingId
      )
    ) {
      throw unavailableScenarioError();
    }

    const candidateIds = await this.dependencies.scenarioLinkService
      .listRawContentLinkCandidateIdsForScenario(orgId, normalizedScenarioId);
    const candidateRecords = await Promise.all(
      candidateIds.map((contentId) =>
        this.dependencies.store.getPublishedContentForMobile(orgId, contentId)
      )
    );
    return buildLibrary(
      candidateRecords.filter(
        (record): record is TrainingContentMobileReadRecord =>
          record !== null && isEligible(record, context, orgId)
      ),
      false
    );
  }

  async getRelatedScenariosForContent(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ): Promise<MobileRelatedPracticeScenariosResponse> {
    const record = await this.requireEligibleContent(context, contentId);
    const links = await this.dependencies.scenarioLinkService
      .listRawScenarioLinkCandidatesForContent(record.content.orgId, record.content.id);
    const scenarios = new Map<string, MobileRelatedPracticeScenarioSummary>();
    for (const link of links) {
      const scenario = resolveMobileScenarioLaunchContext(
        context.scenarioConfig,
        record.content.orgId,
        link.scenarioId
      );
      if (scenario && !scenarios.has(scenario.id)) {
        scenarios.set(scenario.id, scenario);
      }
    }
    return { scenarios: [...scenarios.values()] };
  }

  async getDetail(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ): Promise<MobileTrainingContentDetailResponse> {
    const record = await this.requireEligibleContent(context, contentId);
    return { item: toDetail(record) };
  }

  async createAssetAccess(
    context: MobileTrainingContentRequestContext,
    contentId: string,
    now = new Date()
  ): Promise<MobileTrainingContentAssetAccessResponse> {
    const record = await this.requireEligibleContent(context, contentId);
    const asset = record.currentAsset;
    if (
      !UPLOADED_CONTENT_TYPES.has(record.content.contentType)
      || !asset
      || asset.orgId !== record.content.orgId
      || asset.contentId !== record.content.id
      || asset.uploadState !== "ready"
      || !asset.isCurrent
      || !asset.finalObjectKey
      || asset.objectDeletedAt
    ) {
      throw unavailableAssetError();
    }

    if (!this.dependencies.readiness.isAvailable()) {
      await this.dependencies.readiness.refresh(now);
    }
    if (!this.dependencies.readiness.isAvailable()) {
      throw storageUnavailableError();
    }

    const isMedia =
      record.content.contentType === "video" || record.content.contentType === "audio";
    const expiresInSeconds = isMedia
      ? Math.min(3600, this.dependencies.storageConfig.mediaAccessUrlTtlSeconds)
      : Math.min(900, this.dependencies.storageConfig.downloadUrlTtlSeconds);
    try {
      const access = await this.dependencies.objectStorage.createPresignedAccess({
        key: asset.finalObjectKey,
        expiresInSeconds,
        now,
      });
      return {
        access: {
          url: access.url,
          expiresAt: access.expiresAt,
          requiredHeaders: access.requiredHeaders,
        },
      };
    } catch {
      throw storageUnavailableError();
    }
  }

  private async requireEnabledModule(
    context: MobileTrainingContentRequestContext
  ): Promise<string> {
    const orgId = requireActiveMembership(context);
    const entitlement = await this.dependencies.entitlementStore.getOrgModuleEntitlement(
      orgId,
      "training_content"
    );
    if (!entitlement.enabled) {
      throw new TrainingContentMobileServiceError(
        "Training Content is not enabled for this organization.",
        403,
        "module_disabled"
      );
    }
    return orgId;
  }

  private async requireEligibleContent(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ): Promise<TrainingContentMobileReadRecord> {
    const orgId = await this.requireEnabledModule(context);
    const normalizedContentId = contentId.trim();
    if (!normalizedContentId) {
      throw unavailableContentError();
    }
    const record = await this.dependencies.store.getPublishedContentForMobile(
      orgId,
      normalizedContentId
    );
    if (!record || !isEligible(record, context, orgId)) {
      throw unavailableContentError();
    }
    return record;
  }
}

function requireActiveMembership(context: MobileTrainingContentRequestContext): string {
  const user = context.user;
  const orgId = user.orgId?.trim() ?? "";
  if (
    !orgId
    || user.accountType !== "enterprise"
    || user.status !== "active"
    || !user.emailVerifiedAt
    || !user.firstName?.trim()
    || !user.lastName?.trim()
    || !context.organizationActive
  ) {
    throw new TrainingContentMobileServiceError(
      "Training Content is not available for this account.",
      403,
      "training_content_access_denied"
    );
  }
  return orgId;
}

function isEligible(
  record: TrainingContentMobileReadRecord,
  context: MobileTrainingContentRequestContext,
  orgId: string
): boolean {
  if (
    record.category.orgId !== orgId
    || record.content.orgId !== orgId
    || record.content.categoryId !== record.category.id
    || record.category.archivedAt !== null
    || record.content.archivedAt !== null
  ) {
    return false;
  }
  return resolveTrainingContentEligibility({
    orgId,
    userId: context.user.id,
    moduleEnabled: true,
    content: record.content,
    assignments: record.assignments,
    users: context.users,
  }).eligible;
}

function buildLibrary(
  records: TrainingContentMobileReadRecord[],
  truncated: boolean
): MobileTrainingContentLibraryResponse {
  const categoryCounts = new Map<string, number>();
  for (const record of records) {
    categoryCounts.set(
      record.category.id,
      (categoryCounts.get(record.category.id) ?? 0) + 1
    );
  }

  const seenCategoryIds = new Set<string>();
  const categories = records.flatMap((record) => {
    if (seenCategoryIds.has(record.category.id)) {
      return [];
    }
    seenCategoryIds.add(record.category.id);
    return [{
      id: record.category.id,
      name: record.category.name,
      description: record.category.description,
      itemCount: categoryCounts.get(record.category.id) ?? 0,
      displayOrder: record.category.displayOrder,
    }];
  });
  return {
    categories,
    items: records.map(toSummary),
    truncated,
  };
}

function toSummary(record: TrainingContentMobileReadRecord): MobileTrainingContentSummary {
  return {
    id: record.content.id,
    contentType: record.content.contentType,
    title: record.content.title,
    description: record.content.description,
    category: {
      id: record.category.id,
      name: record.category.name,
    },
    relatedFocusTopic: record.content.focusTopicNameSnapshot,
  };
}

function toDetail(record: TrainingContentMobileReadRecord): MobileTrainingContentDetail {
  const asset = record.currentAsset;
  return {
    ...toSummary(record),
    nativeBody: record.content.contentType === "native" ? record.content.nativeBody : null,
    externalUrl:
      record.content.contentType === "external_url" ? record.content.externalUrl : null,
    asset: asset
      ? {
          filename: asset.originalFilename,
          mimeType: asset.detectedMimeType,
          fileExtension: asset.fileExtension,
          byteSize: asset.byteSize,
        }
      : null,
    contentVersion: record.content.contentVersion,
  };
}

function unavailableContentError(): TrainingContentMobileServiceError {
  return new TrainingContentMobileServiceError(
    "Training Content is not available.",
    404,
    "training_content_not_found"
  );
}

function unavailableScenarioError(): TrainingContentMobileServiceError {
  return new TrainingContentMobileServiceError(
    "Scenario is not available.",
    404,
    "scenario_not_found"
  );
}

type MobileScenarioConfig = Pick<
  AppConfig,
  "industries" | "roleIndustries" | "segments" | "orgCustomScenarios" | "orgTrainings"
>;

function isScenarioAvailableToMobileUser(
  config: MobileScenarioConfig,
  orgId: string,
  scenarioId: string,
  trainingId?: string | null
): boolean {
  return resolveMobileScenarioLaunchContext(config, orgId, scenarioId, trainingId) !== null;
}

function resolveMobileScenarioLaunchContext(
  config: MobileScenarioConfig,
  orgId: string,
  scenarioId: string,
  trainingId?: string | null
): MobileRelatedPracticeScenarioSummary | null {
  const enabledIndustries = config.industries.filter((industry) => industry.enabled);
  for (const segment of config.segments) {
    if (!segment.enabled) {
      continue;
    }
    const scenario = segment.scenarios.find(
      (candidate) => candidate.id === scenarioId && candidate.enabled !== false
    );
    if (!scenario) {
      continue;
    }
    const linkedIndustryId = config.roleIndustries.find(
      (entry) => entry.active
        && entry.roleId === segment.id
        && enabledIndustries.some((industry) => industry.id === entry.industryId)
    )?.industryId;
    const hasMappedStandardOptions = config.roleIndustries.some(
      (entry) => entry.active
        && enabledIndustries.some((industry) => industry.id === entry.industryId)
        && config.segments.some(
          (candidate) => candidate.id === entry.roleId
            && candidate.enabled
            && candidate.scenarios.some((item) => item.enabled !== false)
        )
    );
    const industryId = linkedIndustryId
      ?? (!hasMappedStandardOptions ? enabledIndustries[0]?.id : null)
      ?? null;
    return industryId
      ? {
        id: scenario.id,
        title: scenario.title,
        source: "standard",
        segmentId: segment.id,
        industryId,
        trainingId: null,
      }
      : null;
  }

  const customScenario = (config.orgCustomScenarios ?? []).find(
    (scenario) => scenario.orgId === orgId
      && scenario.id === scenarioId
      && scenario.enabled === true
  );
  const segment = customScenario
    ? config.segments.find(
      (candidate) => candidate.id === customScenario.segmentId && candidate.enabled
    )
    : null;
  if (!customScenario || !segment) {
    return null;
  }

  const normalizedTrainingId = trainingId?.trim() ?? "";
  const validTrainings = (config.orgTrainings ?? [])
    .filter((training) => training.status === "active"
      && training.orgId === orgId
      && training.attachedCustomScenarioIds.includes(customScenario.id))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const training = normalizedTrainingId
    ? validTrainings.find((candidate) => candidate.id === normalizedTrainingId) ?? null
    : validTrainings[0] ?? null;
  const industry = enabledIndustries.find(
    (candidate) => customScenario.applicableIndustryIds.includes(candidate.id)
  ) ?? null;
  return training && industry
    ? {
      id: customScenario.id,
      title: customScenario.title,
      source: "custom",
      segmentId: segment.id,
      industryId: industry.id,
      trainingId: training.id,
    }
    : null;
}

function unavailableAssetError(): TrainingContentMobileServiceError {
  return new TrainingContentMobileServiceError(
    "Training Content asset is not available.",
    404,
    "training_content_asset_not_available"
  );
}

function storageUnavailableError(): TrainingContentMobileServiceError {
  return new TrainingContentMobileServiceError(
    "Training Content storage is temporarily unavailable.",
    503,
    "training_content_storage_unavailable"
  );
}

export function mapTrainingContentMobileServiceError(error: unknown): {
  status: number;
  body: { error: string; code: string; moduleKey?: "training_content" };
} {
  if (error instanceof TrainingContentMobileServiceError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        ...(error.code === "module_disabled"
          ? { moduleKey: "training_content" as const }
          : {}),
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "Training Content could not be loaded.",
      code: "training_content_request_failed",
    },
  };
}

export function createTrainingContentMobileService(
  dependencies: TrainingContentMobileServiceDependencies
): TrainingContentMobileService {
  return new DefaultTrainingContentMobileService(dependencies);
}
