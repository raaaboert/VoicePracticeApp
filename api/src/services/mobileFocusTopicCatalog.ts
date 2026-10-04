import type {
  AppConfig,
  MobileFocusTopicCatalogResponse,
  MobileFocusTopicDetailResponse,
  MobileFocusTopicScenarioSummary,
  MobileTrainingContentSummary,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  TrainingPackAssignmentRecord,
  UserProfile,
} from "@voicepractice/shared";

import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import type {
  TrainingContentMobileReadRecord,
  TrainingContentStore,
} from "../storage/trainingContentStore.js";
import type { TrainingPackStore } from "../storage/trainingPackStore.js";
import {
  isMobileTrainingContentRecordEligible,
  resolveActiveMobileTrainingContentMembershipOrgId,
  toMobileTrainingContentSummary,
  type MobileTrainingContentRequestContext,
} from "./trainingContentMobileService.js";
import { isTrainingPackAssignmentValidForUser } from "./trainingPackAssignments.js";
import { parseTrainingPackScenarioSelection } from "./trainingPackScenarioSelection.js";
import { compareOrgTrainingCompanyOrder } from "./orgTrainingWorkspace.js";

type MobileScenarioConfig = Pick<
  AppConfig,
  "industries" | "roleIndustries" | "segments" | "orgCustomScenarios" | "orgTrainings"
>;

export interface MobileFocusTopicCatalogContext {
  actingOrgId: string;
  organizationActive: boolean;
  user: UserProfile;
  users: readonly UserProfile[];
  topics: readonly OrgTrainingRecord[];
  packAttachments: readonly OrgTrainingPackAttachmentRecord[];
  scenarioAttachments: readonly OrgTrainingScenarioAttachmentRecord[];
  packAssignments: readonly TrainingPackAssignmentRecord[];
  scenarioConfig: MobileScenarioConfig;
  isTopicVisible(topic: OrgTrainingRecord): boolean;
  resolveScenario(
    scenarioId: string,
    trainingId?: string | null
  ): MobileFocusTopicScenarioSummary | null;
}

export interface MobileFocusTopicCatalogService {
  getCatalog(context: MobileFocusTopicCatalogContext): Promise<MobileFocusTopicCatalogResponse>;
  getDetail(
    context: MobileFocusTopicCatalogContext,
    topicId: string
  ): Promise<MobileFocusTopicDetailResponse | null>;
}

interface MobileFocusTopicCatalogDependencies {
  trainingPackStore: Pick<TrainingPackStore, "listTrainingPacksForOrg">;
  trainingContentStore: Pick<
    TrainingContentStore,
    "listPublishedContentForMobileFocusTopics"
  >;
  entitlementStore: Pick<OrgModuleEntitlementStore, "getOrgModuleEntitlement">;
}

interface ActionableTopicProjection {
  topic: OrgTrainingRecord;
  scenarios: MobileFocusTopicScenarioSummary[];
  resources: MobileTrainingContentSummary[];
}

const TOPIC_COLLATOR = new Intl.Collator("en-US", {
  sensitivity: "base",
  numeric: false,
  caseFirst: "false",
});

class DefaultMobileFocusTopicCatalogService implements MobileFocusTopicCatalogService {
  constructor(private readonly dependencies: MobileFocusTopicCatalogDependencies) {}

  async getCatalog(
    context: MobileFocusTopicCatalogContext
  ): Promise<MobileFocusTopicCatalogResponse> {
    const projections = await this.projectActionableTopics(context);
    return {
      topics: projections.map(({ topic, scenarios, resources }) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description,
        createdAt: topic.createdAt,
        scenarioCount: scenarios.length,
        resourceCount: resources.length,
      })),
    };
  }

  async getDetail(
    context: MobileFocusTopicCatalogContext,
    topicId: string
  ): Promise<MobileFocusTopicDetailResponse | null> {
    const normalizedTopicId = topicId.trim();
    if (!normalizedTopicId) {
      return null;
    }
    const projection = (
      await this.projectActionableTopics(context, normalizedTopicId)
    )[0] ?? null;
    if (!projection) {
      return null;
    }
    return {
      topic: {
        id: projection.topic.id,
        name: projection.topic.name,
        description: projection.topic.description,
      },
      scenarios: projection.scenarios,
      resources: projection.resources,
    };
  }

  private async projectActionableTopics(
    context: MobileFocusTopicCatalogContext,
    requestedTopicId?: string
  ): Promise<ActionableTopicProjection[]> {
    const topics = selectVisibleActiveTopics(context)
      .filter((topic) => requestedTopicId === undefined || topic.id === requestedTopicId);
    if (topics.length === 0) {
      return [];
    }

    const scenariosByTopicId = new Map(
      topics.map((topic) => [topic.id, new Map<string, MobileFocusTopicScenarioSummary>()] as const)
    );
    addDirectCustomScenarios(context, scenariosByTopicId);

    const packs = await this.dependencies.trainingPackStore.listTrainingPacksForOrg(
      context.actingOrgId
    );
    addAssignedPackStandardScenarios(context, packs, scenariosByTopicId);

    const resourcesByTopicId = new Map(
      topics.map((topic) => [topic.id, new Map<string, MobileTrainingContentSummary>()] as const)
    );
    await this.addEligibleResources(context, topics, resourcesByTopicId);

    return topics.flatMap((topic) => {
      const scenarios = [...(scenariosByTopicId.get(topic.id)?.values() ?? [])]
        .sort(compareScenarios);
      const resources = [...(resourcesByTopicId.get(topic.id)?.values() ?? [])];
      return scenarios.length === 0 && resources.length === 0
        ? []
        : [{ topic, scenarios, resources }];
    });
  }

  private async addEligibleResources(
    context: MobileFocusTopicCatalogContext,
    topics: readonly OrgTrainingRecord[],
    resourcesByTopicId: Map<string, Map<string, MobileTrainingContentSummary>>
  ): Promise<void> {
    const mobileContext: MobileTrainingContentRequestContext = {
      user: context.user,
      users: context.users,
      organizationActive: context.organizationActive,
      scenarioConfig: context.scenarioConfig,
    };
    const membershipOrgId = resolveActiveMobileTrainingContentMembershipOrgId(mobileContext);
    if (membershipOrgId !== context.actingOrgId) {
      return;
    }
    const entitlement = await this.dependencies.entitlementStore.getOrgModuleEntitlement(
      context.actingOrgId,
      "training_content"
    );
    if (!entitlement.enabled) {
      return;
    }

    const records = await this.dependencies.trainingContentStore
      .listPublishedContentForMobileFocusTopics(
        context.actingOrgId,
        topics.map((topic) => topic.id)
      );
    for (const record of records) {
      addEligibleResource(context, mobileContext, record, resourcesByTopicId);
    }
  }
}

function selectVisibleActiveTopics(
  context: MobileFocusTopicCatalogContext
): OrgTrainingRecord[] {
  const topicsById = new Map<string, OrgTrainingRecord>();
  for (const topic of context.topics) {
    if (
      topic.orgId !== context.actingOrgId
      || topic.status !== "active"
      || !context.isTopicVisible(topic)
      || topicsById.has(topic.id)
    ) {
      continue;
    }
    topicsById.set(topic.id, topic);
  }
  return Array.from(topicsById.values()).sort(compareOrgTrainingCompanyOrder);
}

function addDirectCustomScenarios(
  context: MobileFocusTopicCatalogContext,
  scenariosByTopicId: Map<string, Map<string, MobileFocusTopicScenarioSummary>>
): void {
  const sameOrgCustomScenarioIds = new Set(
    (context.scenarioConfig.orgCustomScenarios ?? [])
      .filter((scenario) => scenario.orgId === context.actingOrgId)
      .map((scenario) => scenario.id)
  );
  for (const attachment of context.scenarioAttachments) {
    const scenarios = scenariosByTopicId.get(attachment.trainingId);
    if (
      !scenarios
      || attachment.orgId !== context.actingOrgId
      || !sameOrgCustomScenarioIds.has(attachment.scenarioId)
    ) {
      continue;
    }
    const resolved = context.resolveScenario(attachment.scenarioId, attachment.trainingId);
    if (
      resolved?.source === "custom"
      && resolved.id === attachment.scenarioId
      && resolved.trainingId === attachment.trainingId
    ) {
      scenarios.set(resolved.id, resolved);
    }
  }
}

function addAssignedPackStandardScenarios(
  context: MobileFocusTopicCatalogContext,
  packs: Awaited<ReturnType<TrainingPackStore["listTrainingPacksForOrg"]>>,
  scenariosByTopicId: Map<string, Map<string, MobileFocusTopicScenarioSummary>>
): void {
  const activePacksById = new Map(
    packs
      .filter((pack) => pack.organizationId === context.actingOrgId && pack.active === true)
      .map((pack) => [pack.id, pack] as const)
  );
  const assignmentsByPackId = new Map<string, TrainingPackAssignmentRecord[]>();
  for (const assignment of context.packAssignments) {
    if (
      assignment.orgId !== context.actingOrgId
      || assignment.userId !== context.user.id
      || assignment.active !== true
      || !isTrainingPackAssignmentValidForUser(assignment, context.user)
    ) {
      continue;
    }
    const assignments = assignmentsByPackId.get(assignment.trainingPackId) ?? [];
    assignments.push(assignment);
    assignmentsByPackId.set(assignment.trainingPackId, assignments);
  }

  for (const attachment of context.packAttachments) {
    const scenarios = scenariosByTopicId.get(attachment.trainingId);
    const pack = activePacksById.get(attachment.trainingPackId);
    if (!scenarios || attachment.orgId !== context.actingOrgId || !pack) {
      continue;
    }
    const selection = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
    if (selection.mode !== "selected") {
      continue;
    }
    const assignedScenarioIds = new Set(
      (assignmentsByPackId.get(pack.id) ?? [])
        .flatMap((assignment) => assignment.requiredScenarioIds ?? [])
        .map((scenarioId) => scenarioId.trim())
        .filter(Boolean)
    );
    for (const scenarioId of selection.selectedScenarioIds) {
      if (!assignedScenarioIds.has(scenarioId)) {
        continue;
      }
      // Standard scenarios intentionally resolve without a Focus Topic trainingId.
      const resolved = context.resolveScenario(scenarioId, null);
      if (
        resolved?.source === "standard"
        && resolved.id === scenarioId
        && resolved.trainingId === null
      ) {
        scenarios.set(resolved.id, resolved);
      }
    }
  }
}

function addEligibleResource(
  context: MobileFocusTopicCatalogContext,
  mobileContext: MobileTrainingContentRequestContext,
  record: TrainingContentMobileReadRecord,
  resourcesByTopicId: Map<string, Map<string, MobileTrainingContentSummary>>
): void {
  const topicId = record.content.focusTopicId;
  const resources = topicId ? resourcesByTopicId.get(topicId) : undefined;
  if (
    !resources
    || record.content.orgId !== context.actingOrgId
    || record.category.orgId !== context.actingOrgId
    || !isMobileTrainingContentRecordEligible(record, mobileContext, context.actingOrgId)
  ) {
    return;
  }
  if (!resources.has(record.content.id)) {
    resources.set(record.content.id, toMobileTrainingContentSummary(record));
  }
}

function compareScenarios(
  left: MobileFocusTopicScenarioSummary,
  right: MobileFocusTopicScenarioSummary
): number {
  const titleOrder = TOPIC_COLLATOR.compare(left.title, right.title);
  return titleOrder !== 0 ? titleOrder : TOPIC_COLLATOR.compare(left.id, right.id);
}

export function createMobileFocusTopicCatalogService(
  dependencies: MobileFocusTopicCatalogDependencies
): MobileFocusTopicCatalogService {
  return new DefaultMobileFocusTopicCatalogService(dependencies);
}
