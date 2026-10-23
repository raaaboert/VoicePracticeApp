import type { AppConfig, EnterpriseOrg } from "@voicepractice/shared";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import { listOrgVisibleStandardScenarios, resolveEffectiveOrgIndustryIds } from "./orgDivisions.js";

export interface TopicScenarioOption {
  id: string;
  kind: "standard" | "org";
  title: string;
  role: string;
  industries: string[];
  available: boolean;
  availability: string;
  lifecycleManaged: boolean;
  isHomeTopic: boolean;
}

/** Management metadata only: no prompts, scoring instructions or internal generation receipts. */
export function topicScenarioOptions(config: AppConfig, org: EnterpriseOrg, topicId?: string): TopicScenarioOption[] {
  const effective = new Set(resolveEffectiveOrgIndustryIds(config, org));
  const visibleStandard = new Set(listOrgVisibleStandardScenarios({ config, org }).map(row => row.scenarioId));
  const industriesForRole = (roleId: string) => config.roleIndustries
    .filter(link => link.active && link.roleId === roleId && effective.has(link.industryId))
    .map(link => link.industryId);
  const option = (id: string, kind: TopicScenarioOption["kind"], title: string, roleId: string,
    enabled: boolean, industryIds: string[], lifecycleManaged = false, homeTopicId?: string | null): TopicScenarioOption => {
    const role = config.segments.find(row => row.id === roleId);
    const eligible = industriesForRole(roleId).filter(id => industryIds.includes(id));
    const available = enabled && role?.enabled === true && eligible.length > 0
      && (kind !== "standard" || visibleStandard.has(id));
    return { id, kind, title, role: role?.label ?? roleId,
      industries: eligible.map(id => config.industries.find(row => row.id === id)?.label ?? id),
      lifecycleManaged, isHomeTopic: lifecycleManaged && Boolean(topicId && homeTopicId === topicId),
      available, availability: !enabled ? "Unavailable: disabled or archived"
        : !role?.enabled ? "Unavailable: Role is inactive"
        : !available ? "Unavailable: no active applicable industry for this Role" : "Eligible for learners with this Role and industry" };
  };
  return [
    ...config.segments.flatMap(role => role.scenarios.map(scenario => option(
      scenario.id, "standard", scenario.title, role.id, scenario.enabled !== false,
      config.roleIndustries.filter(link => link.active && link.roleId === role.id).map(link => link.industryId),
    ))),
    ...(org.customScenarios ?? []).filter(scenario => scenario.orgId === org.id).map(scenario => option(
      scenario.id, "org", scenario.title, scenario.segmentId, scenario.enabled === true, scenario.applicableIndustryIds ?? [],
      Boolean(scenario.customerScenarioVersionId?.trim()), scenario.homeFocusTopicId,
    )),
  ].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" })
    || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function listTopicScenarioManagement(input: {
  config: AppConfig; org: EnterpriseOrg; topicId: string; topicActive: boolean;
  topicStatus?: "draft" | "active" | "archived";
  authority: FocusTopicAuthoritySnapshot; search: string; page: number; canManage: boolean;
}) {
  const options = topicScenarioOptions(input.config, input.org, input.topicId);
  const relationships = input.authority.scenarioAttachments.filter(row => row.orgId === input.org.id && row.topicId === input.topicId);
  const describe = (row: typeof relationships[number]) => ({ ...row,
    scenario: options.find(option => option.id === row.scenarioId && option.kind === row.scenarioKind)
      ?? { id: row.scenarioId, kind: row.scenarioKind, title: "Unavailable scenario", role: "Unknown Role",
        industries: [], available: false, lifecycleManaged: false, isHomeTopic: false,
        availability: "Unavailable: definition no longer belongs to this organization or catalog" },
  });
  const attached = relationships.filter(row => row.detachedAt === null).map(describe);
  const needle = input.search.trim().toLocaleLowerCase();
  const matches = options.filter(row => input.canManage && row.available
    && [row.title, row.role, ...row.industries].join(" ").toLocaleLowerCase().includes(needle));
  const pageSize = 10;
  const page = Math.min(input.page, Math.max(1, Math.ceil(matches.length / pageSize)));
  return { topicId: input.topicId, attached, history: relationships.filter(row => row.detachedAt !== null).map(describe),
    items: matches.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row,
      attached: attached.some(attachment => attachment.scenarioId === row.id && attachment.scenarioKind === row.kind) })),
    page, pageSize, total: matches.length, canManage: input.canManage, topicActive: input.topicActive,
    topicStatus: input.topicStatus ?? (input.topicActive ? "active" : "draft") };
}
