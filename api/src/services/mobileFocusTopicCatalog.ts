import type {
  AppConfig,
  MobileFocusTopicCatalogResponse,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  TrainingPackAssignmentRecord,
  UserProfile,
} from "@voicepractice/shared";

import type { OrgModuleEntitlementStore } from "../storage/orgModuleEntitlementStore.js";
import type { TrainingContentStore } from "../storage/trainingContentStore.js";
import type { TrainingPackStore } from "../storage/trainingPackStore.js";
import {
  isMobileTrainingContentRecordEligible,
  resolveActiveMobileTrainingContentMembershipOrgId,
  type MobileTrainingContentRequestContext,
} from "./trainingContentMobileService.js";
import { isTrainingPackAssignmentValidForUser } from "./trainingPackAssignments.js";
import { parseTrainingPackScenarioSelection } from "./trainingPackScenarioSelection.js";

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
  ): { source: "standard" | "custom" } | null;
}

export interface MobileFocusTopicCatalogService {
  getCatalog(context: MobileFocusTopicCatalogContext): Promise<MobileFocusTopicCatalogResponse>;
}

interface MobileFocusTopicCatalogDependencies {
  trainingPackStore: Pick<TrainingPackStore, "listTrainingPacksForOrg">;
  trainingContentStore: Pick<
    TrainingContentStore,
    "listPublishedContentForMobileFocusTopics"
  >;
  entitlementStore: Pick<OrgModuleEntitlementStore, "getOrgModuleEntitlement">;
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
    const topics = selectVisibleActiveTopics(context);
    if (topics.length === 0) {
      return { topics: [] };
    }

    const scenarioIdsByTopicId = new Map(
      topics.map((topic) => [topic.id, new Set<string>()] as const)
    );
    addDirectCustomScenarios(context, scenarioIdsByTopicId);

    const packs = await this.dependencies.trainingPackStore.listTrainingPacksForOrg(
      context.actingOrgId
    );
    addAssignedPackStandardScenarios(context, packs, scenarioIdsByTopicId);

    const resourceIdsByTopicId = new Map(
      topics.map((topic) => [topic.id, new Set<string>()] as const)
    );
    await this.addEligibleResources(context, topics, resourceIdsByTopicId);

    return {
      topics: topics.flatMap((topic) => {
        const scenarioCount = scenarioIdsByTopicId.get(topic.id)?.size ?? 0;
        const resourceCount = resourceIdsByTopicId.get(topic.id)?.size ?? 0;
        return scenarioCount === 0 && resourceCount === 0
          ? []
          : [{
              id: topic.id,
              name: topic.name,
              description: topic.description,
              scenarioCount,
              resourceCount,
            }];
      }),
    };
  }

  private async addEligibleResources(
    context: MobileFocusTopicCatalogContext,
    topics: readonly OrgTrainingRecord[],
    resourceIdsByTopicId: Map<string, Set<string>>
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
      const topicId = record.content.focusTopicId;
      const resourceIds = topicId ? resourceIdsByTopicId.get(topicId) : undefined;
      if (
        !resourceIds
        || record.content.orgId !== context.actingOrgId
        || record.category.orgId !== context.actingOrgId
        || !isMobileTrainingContentRecordEligible(
          record,
          mobileContext,
          context.actingOrgId
        )
      ) {
        continue;
      }
      resourceIds.add(record.content.id);
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
  return Array.from(topicsById.values()).sort((left, right) => {
    const nameOrder = TOPIC_COLLATOR.compare(left.name, right.name);
    return nameOrder !== 0 ? nameOrder : TOPIC_COLLATOR.compare(left.id, right.id);
  });
}

function addDirectCustomScenarios(
  context: MobileFocusTopicCatalogContext,
  scenarioIdsByTopicId: Map<string, Set<string>>
): void {
  const sameOrgCustomScenarioIds = new Set(
    (context.scenarioConfig.orgCustomScenarios ?? [])
      .filter((scenario) => scenario.orgId === context.actingOrgId)
      .map((scenario) => scenario.id)
  );
  for (const attachment of context.scenarioAttachments) {
    const scenarioIds = scenarioIdsByTopicId.get(attachment.trainingId);
    if (
      !scenarioIds
      || attachment.orgId !== context.actingOrgId
      || !sameOrgCustomScenarioIds.has(attachment.scenarioId)
    ) {
      continue;
    }
    const resolved = context.resolveScenario(attachment.scenarioId, attachment.trainingId);
    if (resolved?.source === "custom") {
      scenarioIds.add(attachment.scenarioId);
    }
  }
}

function addAssignedPackStandardScenarios(
  context: MobileFocusTopicCatalogContext,
  packs: Awaited<ReturnType<TrainingPackStore["listTrainingPacksForOrg"]>>,
  scenarioIdsByTopicId: Map<string, Set<string>>
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
    const scenarioIds = scenarioIdsByTopicId.get(attachment.trainingId);
    const pack = activePacksById.get(attachment.trainingPackId);
    if (!scenarioIds || attachment.orgId !== context.actingOrgId || !pack) {
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
      if (resolved?.source === "standard") {
        scenarioIds.add(scenarioId);
      }
    }
  }
}

export function createMobileFocusTopicCatalogService(
  dependencies: MobileFocusTopicCatalogDependencies
): MobileFocusTopicCatalogService {
  return new DefaultMobileFocusTopicCatalogService(dependencies);
}
