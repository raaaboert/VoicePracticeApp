import { createHash } from "node:crypto";

import type {
  EnterpriseOrg,
  OrgCustomScenario,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  TrainingContentItem,
  TrainingPack,
  UserProfile,
} from "@voicepractice/shared";

import { parseTrainingPackScenarioSelection } from "./trainingPackScenarioSelection.js";
import type { FocusTopicAssignment } from "./focusTopicAuthority.js";

export const FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION = "focus-topic-authority-v1";
export const FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION = "2026-10-06-v1";
export const FOCUS_TOPIC_BACKFILL_ACTOR = "focus-topic-authority-backfill";

export interface FocusTopicScenarioAttachment {
  id: string;
  orgId: string;
  topicId: string;
  scenarioKind: "standard" | "org";
  scenarioId: string;
  attachedBy: string;
  attachedAt: string;
  detachedBy: string | null;
  detachedAt: string | null;
}

export interface FocusTopicContentAttachment {
  id: string;
  orgId: string;
  contentId: string;
  topicId: string;
  attachedBy: string;
  attachedAt: string;
  detachedBy: string | null;
  detachedAt: string | null;
}

export interface LegacyFocusTopicVisibility {
  orgId: string;
  userId: string;
  topicId: string;
  standardScenarioIds: string[];
  orgScenarioIds: string[];
  contentIds: string[];
}

export interface FocusTopicAuthorityBackfillInput {
  organizations: readonly EnterpriseOrg[];
  users: readonly UserProfile[];
  topics: readonly OrgTrainingRecord[];
  contentItems: readonly TrainingContentItem[];
  scenarioAttachments: readonly OrgTrainingScenarioAttachmentRecord[];
  customScenarios: readonly OrgCustomScenario[];
  packAttachments: readonly OrgTrainingPackAttachmentRecord[];
  trainingPacks: readonly TrainingPack[];
  applicableStandardScenarioIdsByOrg: Readonly<Record<string, readonly string[]>>;
  legacyVisibility: readonly LegacyFocusTopicVisibility[];
  capturedAt: string;
}

export type BackfillIssueCode =
  | "missing_topic"
  | "cross_org_topic"
  | "missing_scenario"
  | "cross_org_scenario"
  | "missing_pack"
  | "cross_org_pack"
  | "duplicate_relationship";

export interface FocusTopicBackfillIssue {
  code: BackfillIssueCode;
  source: "content" | "org_scenario" | "standard_scenario";
  orgId: string;
  topicId: string;
  relationId: string;
}

export interface RequiredScenarioSubsetDifference {
  orgId: string;
  topicId: string;
  userId: string;
  legacyStandardScenarioIds: string[];
  futureStandardScenarioIds: string[];
  broadenedScenarioIds: string[];
}

export interface FocusTopicAuthorityBackfillPlan {
  version: string;
  schemaGeneration: string;
  capturedAt: string;
  inputFingerprint: string;
  assignments: FocusTopicAssignment[];
  scenarioAttachments: FocusTopicScenarioAttachment[];
  contentAttachments: FocusTopicContentAttachment[];
  issues: FocusTopicBackfillIssue[];
  requiredScenarioSubsetDifferences: RequiredScenarioSubsetDifference[];
  summary: {
    assignmentCount: number;
    scenarioAttachmentCount: number;
    contentAttachmentCount: number;
    issueCount: number;
    requiredScenarioSubsetDifferenceCount: number;
  };
}

export function buildFocusTopicAuthorityBackfillPlan(
  input: FocusTopicAuthorityBackfillInput
): FocusTopicAuthorityBackfillPlan {
  const topicsByKey = new Map(input.topics.map((topic) => [`${topic.orgId}:${topic.id}`, topic]));
  const topicsById = new Map<string, OrgTrainingRecord[]>();
  for (const topic of input.topics) topicsById.set(topic.id, [...(topicsById.get(topic.id) ?? []), topic]);
  const packsById = new Map(input.trainingPacks.map((pack) => [pack.id, pack]));
  const customById = new Map(input.customScenarios.map((scenario) => [scenario.id, scenario]));
  const issues: FocusTopicBackfillIssue[] = [];
  const contentAttachments: FocusTopicContentAttachment[] = [];
  const scenarioAttachments: FocusTopicScenarioAttachment[] = [];
  const seenContent = new Set<string>();
  const seenScenarios = new Set<string>();

  for (const content of stable(input.contentItems)) {
    if (!content.focusTopicId) continue;
    const topic = topicsByKey.get(`${content.orgId}:${content.focusTopicId}`);
    if (!topic) {
      const sameId = topicsById.get(content.focusTopicId) ?? [];
      issues.push(issue("missing_topic", "content", content.orgId, content.focusTopicId, content.id));
      if (sameId.length > 0) issues[issues.length - 1]!.code = "cross_org_topic";
      continue;
    }
    const key = `${content.orgId}:${content.id}:${topic.id}`;
    if (seenContent.has(key)) {
      issues.push(issue("duplicate_relationship", "content", content.orgId, topic.id, content.id));
      continue;
    }
    seenContent.add(key);
    contentAttachments.push({
      id: deterministicId("fcta", key), orgId: content.orgId, contentId: content.id,
      topicId: topic.id, attachedBy: FOCUS_TOPIC_BACKFILL_ACTOR,
      attachedAt: input.capturedAt, detachedBy: null, detachedAt: null,
    });
  }

  for (const attachment of stable(input.scenarioAttachments)) {
    const topic = topicsByKey.get(`${attachment.orgId}:${attachment.trainingId}`);
    if (!topic) {
      issues.push(issue((topicsById.get(attachment.trainingId)?.length ?? 0) > 0 ? "cross_org_topic" : "missing_topic", "org_scenario", attachment.orgId, attachment.trainingId, attachment.scenarioId));
      continue;
    }
    const scenario = customById.get(attachment.scenarioId);
    if (!scenario) {
      issues.push(issue("missing_scenario", "org_scenario", attachment.orgId, topic.id, attachment.scenarioId));
      continue;
    }
    if (scenario.orgId !== attachment.orgId) {
      issues.push(issue("cross_org_scenario", "org_scenario", attachment.orgId, topic.id, attachment.scenarioId));
      continue;
    }
    addScenario(scenarioAttachments, seenScenarios, issues, {
      orgId: attachment.orgId, topicId: topic.id, scenarioKind: "org",
      scenarioId: scenario.id, attachedAt: attachment.createdAt,
    });
  }

  for (const attachment of stable(input.packAttachments)) {
    const topic = topicsByKey.get(`${attachment.orgId}:${attachment.trainingId}`);
    if (!topic) {
      issues.push(issue((topicsById.get(attachment.trainingId)?.length ?? 0) > 0 ? "cross_org_topic" : "missing_topic", "standard_scenario", attachment.orgId, attachment.trainingId, attachment.trainingPackId));
      continue;
    }
    const pack = packsById.get(attachment.trainingPackId);
    if (!pack) {
      issues.push(issue("missing_pack", "standard_scenario", attachment.orgId, topic.id, attachment.trainingPackId));
      continue;
    }
    if (pack.organizationId !== attachment.orgId) {
      issues.push(issue("cross_org_pack", "standard_scenario", attachment.orgId, topic.id, pack.id));
      continue;
    }
    const selection = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
    const ids = selection.mode === "all"
      ? [...(input.applicableStandardScenarioIdsByOrg[attachment.orgId] ?? [])]
      : selection.selectedScenarioIds;
    const applicableIds = new Set(input.applicableStandardScenarioIdsByOrg[attachment.orgId] ?? []);
    for (const scenarioId of [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort()) {
      if (!applicableIds.has(scenarioId)) {
        issues.push(issue("missing_scenario", "standard_scenario", attachment.orgId, topic.id, scenarioId));
        continue;
      }
      addScenario(scenarioAttachments, seenScenarios, issues, {
        orgId: attachment.orgId, topicId: topic.id, scenarioKind: "standard",
        scenarioId, attachedAt: attachment.createdAt,
      }, false);
    }
  }

  const assignments = fitAssignments(input, topicsByKey);
  const futureStandards = groupFutureStandards(scenarioAttachments);
  const requiredScenarioSubsetDifferences = stable(input.legacyVisibility).flatMap((legacy) => {
    const future = futureStandards.get(`${legacy.orgId}:${legacy.topicId}`) ?? [];
    const legacyIds = [...new Set(legacy.standardScenarioIds)].sort();
    const broadened = future.filter((id) => !legacyIds.includes(id));
    return broadened.length === 0 ? [] : [{
      orgId: legacy.orgId,
      topicId: legacy.topicId,
      userId: legacy.userId,
      legacyStandardScenarioIds: legacyIds,
      futureStandardScenarioIds: future,
      broadenedScenarioIds: broadened,
    }];
  });

  assignments.sort(sortRows);
  scenarioAttachments.sort(sortRows);
  contentAttachments.sort(sortRows);
  issues.sort(sortRows);
  requiredScenarioSubsetDifferences.sort(sortRows);
  const canonicalInput = canonicalize({
    ...input,
    capturedAt: undefined,
  });
  const inputFingerprint = createHash("sha256").update(canonicalInput).digest("hex");
  return {
    version: FOCUS_TOPIC_AUTHORITY_BACKFILL_VERSION,
    schemaGeneration: FOCUS_TOPIC_AUTHORITY_SCHEMA_GENERATION,
    capturedAt: input.capturedAt,
    inputFingerprint,
    assignments,
    scenarioAttachments,
    contentAttachments,
    issues,
    requiredScenarioSubsetDifferences,
    summary: {
      assignmentCount: assignments.length,
      scenarioAttachmentCount: scenarioAttachments.length,
      contentAttachmentCount: contentAttachments.length,
      issueCount: issues.length,
      requiredScenarioSubsetDifferenceCount: requiredScenarioSubsetDifferences.length,
    },
  };
}

function fitAssignments(
  input: FocusTopicAuthorityBackfillInput,
  topicsByKey: ReadonlyMap<string, OrgTrainingRecord>
): FocusTopicAssignment[] {
  const rows: FocusTopicAssignment[] = [];
  for (const org of stable(input.organizations).filter((candidate) => candidate.status === "active")) {
    const eligible = stable(input.users).filter((user) =>
      user.accountType === "enterprise" && user.orgId === org.id
      && user.status === "active" && Boolean(user.emailVerifiedAt)
    );
    for (const topic of stable(input.topics).filter((candidate) => candidate.orgId === org.id && candidate.status === "active")) {
      if (!topicsByKey.has(`${org.id}:${topic.id}`)) continue;
      const visible = eligible.filter((user) => input.legacyVisibility.some((entry) =>
        entry.orgId === org.id && entry.userId === user.id && entry.topicId === topic.id
      ));
      if (visible.length === 0) continue;
      if (visible.length === eligible.length) {
        rows.push(assignment(org.id, topic.id, "organization", null, input.capturedAt));
      } else {
        rows.push(...visible.map((user) => assignment(
          org.id, topic.id, "individual", user.id, input.capturedAt
        )));
      }
    }
  }
  return rows;
}

function assignment(
  orgId: string,
  topicId: string,
  audience: "organization" | "individual",
  subjectUserId: string | null,
  createdAt: string
): FocusTopicAssignment {
  const key = `${orgId}:${topicId}:${audience}:${subjectUserId ?? ""}`;
  return {
    id: deterministicId("fta", key), orgId, topicId, audience, subjectUserId,
    grantsManagement: false, createdBy: FOCUS_TOPIC_BACKFILL_ACTOR, createdAt,
    revokedBy: null, revokedAt: null,
  };
}

function addScenario(
  rows: FocusTopicScenarioAttachment[],
  seen: Set<string>,
  issues: FocusTopicBackfillIssue[],
  input: Pick<FocusTopicScenarioAttachment, "orgId" | "topicId" | "scenarioKind" | "scenarioId" | "attachedAt">,
  reportDuplicate = true
): void {
  const key = `${input.orgId}:${input.topicId}:${input.scenarioKind}:${input.scenarioId}`;
  if (seen.has(key)) {
    if (reportDuplicate) {
      issues.push(issue("duplicate_relationship", input.scenarioKind === "org" ? "org_scenario" : "standard_scenario", input.orgId, input.topicId, input.scenarioId));
    }
    return;
  }
  seen.add(key);
  rows.push({
    id: deterministicId("ftsa", key), ...input,
    attachedBy: FOCUS_TOPIC_BACKFILL_ACTOR, detachedBy: null, detachedAt: null,
  });
}

function groupFutureStandards(rows: readonly FocusTopicScenarioAttachment[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (row.scenarioKind !== "standard") continue;
    const key = `${row.orgId}:${row.topicId}`;
    result.set(key, [...(result.get(key) ?? []), row.scenarioId].sort());
  }
  return result;
}

function issue(
  code: BackfillIssueCode,
  source: FocusTopicBackfillIssue["source"],
  orgId: string,
  topicId: string,
  relationId: string
): FocusTopicBackfillIssue {
  return { code, source, orgId, topicId, relationId };
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function stable<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
}

function sortRows(left: unknown, right: unknown): number {
  return canonicalize(left).localeCompare(canonicalize(right));
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
