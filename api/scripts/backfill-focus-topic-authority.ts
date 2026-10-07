import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiDatabase, TrainingContentItem, TrainingPack } from "@voicepractice/shared";
import { Pool } from "pg";

import {
  assertProductionWriteAllowed,
  inferDatabaseTargetEnvironment,
  parseScriptTarget,
  PRODUCTION_WRITE_CONFIRMATION,
  resolveGuardedTargetEnvironment,
  type ScriptTargetEnvironment,
} from "../src/productionSafety.js";
import {
  buildFocusTopicAuthorityBackfillPlan,
  type FocusTopicAuthorityBackfillInput,
  type LegacyFocusTopicVisibility,
} from "../src/services/focusTopicAuthorityBackfill.js";
import { canFutureLearnerAccessFocusTopic } from "../src/services/focusTopicAuthority.js";
import {
  compareFocusTopicAuthorityProjections,
  projectPublishedFocusTopicContentIds,
  type FocusTopicProjection,
} from "../src/services/focusTopicAuthorityShadow.js";
import {
  isDivisionVisibleToUser,
  listOrgVisibleStandardScenarios,
  resolveStandardScenarioActiveDivisionId,
  resolveTrainingActiveDivisionId,
  resolveUserActiveDivisionId,
} from "../src/services/orgDivisions.js";
import { parseTrainingPackScenarioSelection } from "../src/services/trainingPackScenarioSelection.js";
import { resolveTrainingContentEligibility } from "../src/services/trainingContentEligibility.js";
import { createFocusTopicAuthorityStore } from "../src/storage/focusTopicAuthorityStore.js";
import type { FocusTopicAuthorityStore } from "../src/storage/focusTopicAuthorityStore.js";
import { createTrainingPackStore } from "../src/storage/trainingPackStore.js";

export interface FocusTopicBackfillCliOptions {
  apply: boolean;
  target: ScriptTargetEnvironment | null;
  confirmProduction: string | null;
  inventoryFile: string | null;
}

export function parseFocusTopicBackfillCliOptions(args: readonly string[]): FocusTopicBackfillCliOptions {
  return {
    apply: args.includes("--apply"),
    target: parseScriptTarget(arg(args, "target")),
    confirmProduction: arg(args, "confirm-production"),
    inventoryFile: arg(args, "inventory-file"),
  };
}

export function assertFocusTopicBackfillTargetSafety(params: {
  options: FocusTopicBackfillCliOptions;
  databaseUrl: string;
}): ScriptTargetEnvironment {
  if (!params.options.target) {
    throw new Error('--target development, --target staging, or --target production is required.');
  }
  const inferredTarget = inferDatabaseTargetEnvironment(params.databaseUrl);
  if (!params.options.apply) {
    return resolveGuardedTargetEnvironment({
      operationName: "backfill-focus-topic-authority",
      explicitTarget: params.options.target,
      inferredTarget,
    }) ?? params.options.target;
  }
  return assertProductionWriteAllowed({
    operationName: "backfill-focus-topic-authority",
    explicitTarget: params.options.target,
    inferredTarget,
    confirmProduction: params.options.confirmProduction,
  }) ?? params.options.target;
}

export async function executeFocusTopicBackfillMode(params: {
  apply: boolean;
  store: Pick<FocusTopicAuthorityStore, "applyBackfillPlan">;
  plan: ReturnType<typeof buildFocusTopicAuthorityBackfillPlan>;
  validTopicKeys: ReadonlySet<string>;
}) {
  if (!params.apply) return null;
  return params.store.applyBackfillPlan({ plan: params.plan, validTopicKeys: params.validTopicKeys });
}

async function main(): Promise<void> {
  const options = parseFocusTopicBackfillCliOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const target = assertFocusTopicBackfillTargetSafety({ options, databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000, keepAlive: true });
  try {
    const inventory = options.inventoryFile
      ? JSON.parse(await readFile(path.resolve(options.inventoryFile), "utf8")) as FocusTopicAuthorityBackfillInput
      : await buildDatabaseInventory(pool, databaseUrl);
    const plan = buildFocusTopicAuthorityBackfillPlan(inventory);
    const shadow = buildShadowReport(inventory, plan);
    if (!options.apply) {
      console.log(JSON.stringify({ mode: "plan", target, plan, shadow }, null, 2));
      return;
    }
    const store = createFocusTopicAuthorityStore({
      provider: "postgres", databaseUrl, pgPoolMax: 2,
      pgConnectTimeoutMs: 15_000, pgIdleTimeoutMs: 10_000, queryPool: pool,
    });
    const validTopicKeys = new Set(inventory.topics.map((topic) => `${topic.orgId}:${topic.id}`));
    const run = await executeFocusTopicBackfillMode({ apply: true, store, plan, validTopicKeys });
    console.log(JSON.stringify({ mode: "apply", target, run, plan: plan.summary, shadow }, null, 2));
  } finally {
    await pool.end();
  }
}

async function buildDatabaseInventory(pool: Pool, databaseUrl: string): Promise<FocusTopicAuthorityBackfillInput> {
  const appStateResult = await pool.query<{ state_json: ApiDatabase }>(
    "SELECT state_json FROM app_state WHERE id = 'primary' LIMIT 1"
  );
  const db = appStateResult.rows[0]?.state_json;
  if (!db) throw new Error("app_state primary row was not found.");
  const contentResult = await pool.query<{
    id:string; org_id:string; focus_topic_id:string|null; publication_state:string; archived_at:string|null; category_archived_at:string|null;
  }>(`SELECT content.id, content.org_id, content.focus_topic_id, content.publication_state,
            content.archived_at, category.archived_at AS category_archived_at
     FROM org_content_items AS content
     JOIN org_content_categories AS category
       ON category.org_id = content.org_id AND category.id = content.category_id
     ORDER BY content.org_id, content.id`);
  const grantResult = await pool.query<{
    org_id:string; content_id:string; assignment_type:string; subject_user_id:string|null;
  }>("SELECT org_id, content_id, assignment_type, subject_user_id FROM org_content_assignments WHERE revoked_at IS NULL ORDER BY org_id, content_id, id");
  const grantsByContent = new Map<string, typeof grantResult.rows>();
  for (const grant of grantResult.rows) {
    const key = `${grant.org_id}:${grant.content_id}`;
    grantsByContent.set(key, [...(grantsByContent.get(key) ?? []), grant]);
  }
  const moduleResult = await pool.query<{org_id:string;enabled:boolean}>(
    "SELECT org_id, enabled FROM org_module_entitlements WHERE module_key = 'training_content'"
  );
  const contentModuleEnabledByOrg = new Map(moduleResult.rows.map((row)=>[row.org_id,row.enabled]));
  const contentItems = contentResult.rows.map((row) => ({
    id: row.id, orgId: row.org_id, focusTopicId: row.focus_topic_id,
    publicationState: row.publication_state,
    archivedAt: row.archived_at,
  })) as TrainingContentItem[];
  const trainingPackStore = createTrainingPackStore({
    provider: "postgres", dbPath: "", databaseUrl,
    pgPoolMax: 2, pgConnectTimeoutMs: 15_000, pgIdleTimeoutMs: 10_000,
    queryPool: pool,
  });
  const trainingPacks: TrainingPack[] = [];
  for (const org of [...db.orgs].sort((a,b) => a.id.localeCompare(b.id))) {
    trainingPacks.push(...await trainingPackStore.listTrainingPacksForOrg(org.id));
  }
  const applicableStandardScenarioIdsByOrg: Record<string,string[]> = {};
  for (const org of db.orgs) {
    const enabledSegments = new Set(db.config.segments.filter((segment)=>segment.enabled).map((segment)=>segment.id));
    applicableStandardScenarioIdsByOrg[org.id] = listOrgVisibleStandardScenarios({ config: db.config, org })
      .filter((row) => row.enabled && enabledSegments.has(row.segmentId)).map((row) => row.scenarioId).sort();
  }
  const customScenarios = db.orgs.flatMap((org) => org.customScenarios ?? []);
  const legacyVisibility = buildLegacyVisibility({
    db, trainingPacks, contentRows: contentResult.rows, grantsByContent, contentModuleEnabledByOrg,
    applicableStandardScenarioIdsByOrg,
  });
  return {
    organizations: db.orgs, users: db.users, topics: db.orgTrainings,
    contentItems, scenarioAttachments: db.orgTrainingScenarioAttachments,
    customScenarios, packAttachments: db.orgTrainingPackAttachments,
    trainingPacks, applicableStandardScenarioIdsByOrg, legacyVisibility,
    capturedAt: new Date().toISOString(),
  };
}

function buildLegacyVisibility(params: {
  db: ApiDatabase;
  trainingPacks: readonly TrainingPack[];
  contentRows: readonly {id:string;org_id:string;focus_topic_id:string|null;publication_state:string;archived_at:string|null;category_archived_at:string|null}[];
  grantsByContent: ReadonlyMap<string, readonly {org_id:string;content_id:string;assignment_type:string;subject_user_id:string|null}[]>;
  contentModuleEnabledByOrg: ReadonlyMap<string,boolean>;
  applicableStandardScenarioIdsByOrg: Readonly<Record<string,readonly string[]>>;
}): LegacyFocusTopicVisibility[] {
  const result: LegacyFocusTopicVisibility[] = [];
  for (const user of params.db.users) {
    if (user.accountType !== "enterprise" || user.status !== "active" || !user.orgId || !user.emailVerifiedAt) continue;
    const org = params.db.orgs.find((candidate) => candidate.id === user.orgId && candidate.status === "active");
    if (!org) continue;
    const userDivisionId = resolveUserActiveDivisionId(params.db, org.id, user);
    for (const topic of params.db.orgTrainings.filter((candidate) => candidate.orgId === org.id && candidate.status === "active")) {
      if (!isDivisionVisibleToUser({ divisionsEnabled: org.divisionsEnabled === true, userDivisionId, contentDivisionId: resolveTrainingActiveDivisionId(params.db,org.id,topic.id) })) continue;
      const enabledIndustryIds = new Set(params.db.config.industries.filter((industry)=>industry.enabled).map((industry)=>industry.id));
      const configuredOrgIndustries = org.activeIndustries.filter((id)=>enabledIndustryIds.has(id));
      const orgIndustryIds = new Set(configuredOrgIndustries.length > 0 ? configuredOrgIndustries : enabledIndustryIds);
      const orgScenarioIds = params.db.orgTrainingScenarioAttachments
        .filter((row) => row.orgId === org.id && row.trainingId === topic.id)
        .map((row) => row.scenarioId)
        .filter((id) => (org.customScenarios ?? []).some((scenario) => scenario.id === id
          && scenario.enabled === true
          && params.db.config.segments.some((segment)=>segment.id===scenario.segmentId&&segment.enabled)
          && scenario.applicableIndustryIds.some((industryId)=>orgIndustryIds.has(industryId))));
      const standardScenarioIds = new Set<string>();
      for (const attachment of params.db.orgTrainingPackAttachments.filter((row) => row.orgId === org.id && row.trainingId === topic.id)) {
        const pack = params.trainingPacks.find((candidate) => candidate.id === attachment.trainingPackId && candidate.organizationId === org.id && candidate.active);
        if (!pack) continue;
        const assignment = params.db.trainingPackAssignments.find((candidate) => candidate.orgId === org.id && candidate.trainingPackId === pack.id && candidate.userId === user.id && candidate.active);
        if (!assignment) continue;
        const selected = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
        if (selected.mode !== "selected") continue;
        const packIds = selected.selectedScenarioIds;
        for (const id of packIds) {
          if (!assignment.requiredScenarioIds.includes(id)) continue;
          if (!(params.applicableStandardScenarioIdsByOrg[org.id] ?? []).includes(id)) continue;
          if (!isDivisionVisibleToUser({ divisionsEnabled: org.divisionsEnabled === true, userDivisionId, contentDivisionId: resolveStandardScenarioActiveDivisionId(params.db,org.id,id) })) continue;
          standardScenarioIds.add(id);
        }
      }
      const contentIds = params.contentRows.filter((content) => {
        if (content.org_id !== org.id || content.focus_topic_id !== topic.id || content.archived_at || content.category_archived_at) return false;
        const assignments=(params.grantsByContent.get(`${org.id}:${content.id}`) ?? []).map((grant)=>({
          id:`inventory:${grant.content_id}:${grant.assignment_type}:${grant.subject_user_id??""}`,orgId:grant.org_id,contentId:grant.content_id,
          assignmentType:grant.assignment_type as "organization"|"user"|"manager"|"manager_team",subjectUserId:grant.subject_user_id,
          createdByActorId:"inventory",createdAt:"1970-01-01T00:00:00.000Z",revokedByActorId:null,revokedAt:null,
        }));
        return resolveTrainingContentEligibility({
          orgId:org.id,userId:user.id,moduleEnabled:params.contentModuleEnabledByOrg.get(org.id)===true,
          content:{id:content.id,orgId:content.org_id,publicationState:content.publication_state} as any,
          assignments,users:params.db.users,
        }).eligible;
      }).map((content) => content.id);
      if (standardScenarioIds.size || orgScenarioIds.length || contentIds.length) {
        result.push({ orgId:org.id,userId:user.id,topicId:topic.id,standardScenarioIds:[...standardScenarioIds].sort(),orgScenarioIds:[...new Set(orgScenarioIds)].sort(),contentIds:[...new Set(contentIds)].sort() });
      }
    }
  }
  return result.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function buildShadowReport(
  inventory: FocusTopicAuthorityBackfillInput,
  plan: ReturnType<typeof buildFocusTopicAuthorityBackfillPlan>
) {
  const legacy: FocusTopicProjection[] = inventory.legacyVisibility.map((row) => ({ ...row, topicOrgId: inventory.topics.find((topic) => topic.id === row.topicId && topic.orgId === row.orgId)?.orgId ?? "" }));
  const future: FocusTopicProjection[] = [];
  for (const user of inventory.users) {
    const organization = inventory.organizations.find((org) => org.id === user.orgId);
    if (!organization) continue;
    for (const topic of inventory.topics.filter((candidate) => candidate.orgId === organization.id)) {
      if (!canFutureLearnerAccessFocusTopic({ user, users: inventory.users, organization, topic, assignments: plan.assignments })) continue;
      future.push({
        orgId:organization.id,userId:user.id,topicId:topic.id,topicOrgId:topic.orgId,
        standardScenarioIds:plan.scenarioAttachments.filter((row)=>row.orgId===organization.id&&row.topicId===topic.id&&row.scenarioKind==="standard").map((row)=>row.scenarioId),
        orgScenarioIds:plan.scenarioAttachments.filter((row)=>row.orgId===organization.id&&row.topicId===topic.id&&row.scenarioKind==="org").map((row)=>row.scenarioId),
        contentIds:projectPublishedFocusTopicContentIds({
          orgId:organization.id,
          topicId:topic.id,
          contentItems:inventory.contentItems,
          attachments:plan.contentAttachments,
        }),
      });
    }
  }
  return compareFocusTopicAuthorityProjections({ legacy, future });
}

function arg(args: readonly string[], name: string): string | null {
  const index=args.indexOf(`--${name}`); const value=index>=0?args[index+1]:null;
  return value && !value.startsWith("--") ? value : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (process.env.NODE_ENV !== "test") console.error(`Production writes require --target production --confirm-production "${PRODUCTION_WRITE_CONFIRMATION}".`);
    process.exitCode=1;
  });
}
