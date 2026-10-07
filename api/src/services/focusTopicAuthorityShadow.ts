export interface FocusTopicProjection {
  orgId: string;
  userId: string;
  topicId: string;
  topicOrgId: string;
  standardScenarioIds: string[];
  orgScenarioIds: string[];
  contentIds: string[];
}

export type FocusTopicShadowDifferenceKind =
  | "visibility_narrowing"
  | "visibility_widening"
  | "cross_org_exposure"
  | "missing_topic_relation"
  | "standard_children_broadened"
  | "content_projection_changed";

export interface FocusTopicShadowDifference {
  classification: "blocking" | "expected_signoff";
  kind: FocusTopicShadowDifferenceKind;
  orgId: string;
  userId: string;
  topicId: string;
  legacyIds: string[];
  futureIds: string[];
}

export function compareFocusTopicAuthorityProjections(params: {
  legacy: readonly FocusTopicProjection[];
  future: readonly FocusTopicProjection[];
}): {
  clean: boolean;
  blocking: FocusTopicShadowDifference[];
  expectedSignoff: FocusTopicShadowDifference[];
} {
  const legacy = index(params.legacy);
  const future = index(params.future);
  const differences: FocusTopicShadowDifference[] = [];
  const keys = [...new Set([...legacy.keys(), ...future.keys()])].sort();
  for (const key of keys) {
    const before = legacy.get(key);
    const after = future.get(key);
    const basis = before ?? after!;
    if (!after) {
      differences.push(diff("blocking", "visibility_narrowing", basis, [], []));
      continue;
    }
    if (after.topicOrgId !== after.orgId) {
      differences.push(diff("blocking", "cross_org_exposure", after, [], []));
    }
    if (!before) {
      differences.push(diff("blocking", "visibility_widening", basis, [], []));
      continue;
    }
    if (!after.topicId.trim()) {
      differences.push(diff("blocking", "missing_topic_relation", after, [], []));
    }
    const legacyStandard = unique(before.standardScenarioIds);
    const futureStandard = unique(after.standardScenarioIds);
    const removedStandard = legacyStandard.filter((id) => !futureStandard.includes(id));
    if (removedStandard.length > 0) {
      differences.push(diff("blocking", "missing_topic_relation", basis, legacyStandard, futureStandard));
    } else if (futureStandard.some((id) => !legacyStandard.includes(id))) {
      differences.push(diff("expected_signoff", "standard_children_broadened", basis, legacyStandard, futureStandard));
    }
    const legacyOrg = unique(before.orgScenarioIds);
    const futureOrg = unique(after.orgScenarioIds);
    if (!same(legacyOrg, futureOrg)) {
      differences.push(diff("blocking", "missing_topic_relation", basis, legacyOrg, futureOrg));
    }
    const legacyContent = unique(before.contentIds);
    const futureContent = unique(after.contentIds);
    if (!same(legacyContent, futureContent)) {
      differences.push(diff("expected_signoff", "content_projection_changed", basis, legacyContent, futureContent));
    }
  }
  const blocking = differences.filter((entry) => entry.classification === "blocking");
  return {
    clean: blocking.length === 0,
    blocking,
    expectedSignoff: differences.filter((entry) => entry.classification === "expected_signoff"),
  };
}

function index(rows: readonly FocusTopicProjection[]): Map<string, FocusTopicProjection> {
  return new Map(rows.map((row) => [`${row.orgId}:${row.userId}:${row.topicId}`, row]));
}

function diff(
  classification: FocusTopicShadowDifference["classification"],
  kind: FocusTopicShadowDifferenceKind,
  row: FocusTopicProjection,
  legacyIds: string[],
  futureIds: string[]
): FocusTopicShadowDifference {
  return { classification, kind, orgId: row.orgId, userId: row.userId, topicId: row.topicId, legacyIds, futureIds };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
