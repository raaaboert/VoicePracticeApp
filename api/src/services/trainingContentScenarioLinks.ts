import type { AppConfig, EnterpriseOrg } from "@voicepractice/shared";

import type {
  ReplaceTrainingContentScenarioLinksInput,
  TrainingContentScenarioLink,
  TrainingContentStore,
} from "../storage/trainingContentStore.js";
import {
  listOrgVisibleStandardScenarios,
  type OrgVisibleStandardScenarioRow,
} from "./orgDivisions.js";

export type TrainingContentScenarioLinkTargetSource = "standard" | "custom";

export interface TrainingContentScenarioLinkTarget {
  scenarioId: string;
  segmentId: string;
  title: string;
  source: TrainingContentScenarioLinkTargetSource;
}

export class TrainingContentScenarioLinkServiceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_scenario_link_target"
  ) {
    super(message);
    this.name = "TrainingContentScenarioLinkServiceError";
  }
}

type ScenarioLinkStore = Pick<
  TrainingContentStore,
  | "listActiveScenarioLinksForContent"
  | "listActiveScenarioLinksForScenario"
  | "replaceActiveScenarioLinksForContent"
>;

export interface TrainingContentScenarioLinkService {
  listRawScenarioLinkCandidatesForContent(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentScenarioLink[]>;
  listRawContentLinkCandidateIdsForScenario(
    orgId: string,
    scenarioId: string
  ): Promise<string[]>;
  replaceScenarioLinksForContent(params: {
    config: Pick<AppConfig, "segments" | "industries" | "roleIndustries">;
    org: Pick<EnterpriseOrg, "id" | "activeIndustries" | "customScenarios">;
    contentId: string;
    scenarioIds: readonly string[];
    actor: ReplaceTrainingContentScenarioLinksInput["actor"];
    now?: Date;
  }): Promise<TrainingContentScenarioLink[]>;
}

export function listValidTrainingContentScenarioLinkTargets(params: {
  config: Pick<AppConfig, "segments" | "industries" | "roleIndustries">;
  org: Pick<EnterpriseOrg, "id" | "activeIndustries" | "customScenarios">;
}): TrainingContentScenarioLinkTarget[] {
  const targets = new Map<string, TrainingContentScenarioLinkTarget>();
  for (const scenario of listOrgVisibleStandardScenarios(params).filter((row) => row.enabled)) {
    targets.set(scenario.scenarioId, mapStandardTarget(scenario));
  }
  for (const scenario of params.org.customScenarios ?? []) {
    if (scenario.orgId !== params.org.id || scenario.enabled === false) {
      continue;
    }
    const scenarioId = scenario.id.trim();
    if (!scenarioId) {
      continue;
    }
    targets.set(scenarioId, {
      scenarioId,
      segmentId: scenario.segmentId,
      title: scenario.title,
      source: "custom",
    });
  }
  return [...targets.values()].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
}

class DefaultTrainingContentScenarioLinkService implements TrainingContentScenarioLinkService {
  constructor(private readonly store: ScenarioLinkStore) {}

  async listRawScenarioLinkCandidatesForContent(
    orgId: string,
    contentId: string
  ): Promise<TrainingContentScenarioLink[]> {
    return this.store.listActiveScenarioLinksForContent(
      requiredId(orgId, "Organization id"),
      requiredId(contentId, "Content id")
    );
  }

  async listRawContentLinkCandidateIdsForScenario(
    orgId: string,
    scenarioId: string
  ): Promise<string[]> {
    const links = await this.store.listActiveScenarioLinksForScenario(
      requiredId(orgId, "Organization id"),
      requiredId(scenarioId, "Scenario id")
    );
    return [...new Set(links.map((link) => link.contentId))];
  }

  async replaceScenarioLinksForContent(params: {
    config: Pick<AppConfig, "segments" | "industries" | "roleIndustries">;
    org: Pick<EnterpriseOrg, "id" | "activeIndustries" | "customScenarios">;
    contentId: string;
    scenarioIds: readonly string[];
    actor: ReplaceTrainingContentScenarioLinksInput["actor"];
    now?: Date;
  }): Promise<TrainingContentScenarioLink[]> {
    const scenarioIds = normalizeScenarioIds(params.scenarioIds);
    const validTargets = new Set(
      listValidTrainingContentScenarioLinkTargets(params).map((target) => target.scenarioId)
    );
    const invalidScenarioId = scenarioIds.find((scenarioId) => !validTargets.has(scenarioId));
    if (invalidScenarioId) {
      throw new TrainingContentScenarioLinkServiceError(
        `Scenario is not available to this organization: ${invalidScenarioId}`,
        "invalid_scenario_link_target"
      );
    }
    return this.store.replaceActiveScenarioLinksForContent({
      orgId: requiredId(params.org.id, "Organization id"),
      contentId: requiredId(params.contentId, "Content id"),
      scenarioIds,
      actor: params.actor,
      now: params.now,
    });
  }
}

function mapStandardTarget(
  scenario: OrgVisibleStandardScenarioRow
): TrainingContentScenarioLinkTarget {
  return {
    scenarioId: scenario.scenarioId,
    segmentId: scenario.segmentId,
    title: scenario.title,
    source: "standard",
  };
}

function normalizeScenarioIds(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const scenarioId = requiredId(value, "Scenario id");
    unique.add(scenarioId);
  }
  return [...unique];
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TrainingContentScenarioLinkServiceError(
      `${label} is required.`,
      "invalid_scenario_link_target"
    );
  }
  return normalized;
}

export function createTrainingContentScenarioLinkService(
  store: ScenarioLinkStore
): TrainingContentScenarioLinkService {
  return new DefaultTrainingContentScenarioLinkService(store);
}
