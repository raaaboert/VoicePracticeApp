import {
  PerformanceInsight,
  PerformancePlan,
  PerformanceProgress,
  SimulationScoreRecord,
  UsageSessionRecord
} from "@voicepractice/shared";

import {
  PerformancePlanStore,
  PerformancePlanWithRelations
} from "../storage/performancePlanStore.js";
import { finalizePerformancePlanIfEnded } from "./performanceFinalization.js";
import {
  calculatePerformanceProgress,
  PerformanceProgressCalculation
} from "./performanceProgress.js";
import { buildPerformanceInsights } from "./performanceInsights.js";

export type MobilePerformanceCurrentDisplayState =
  | {
      state: "no_active_plan";
      planId: null;
      planStatus: "none";
      overallCurrentlyMeetingTarget: null;
    }
  | {
      state: "active_collecting_evidence" | "active_on_track" | "active_needs_attention";
      planId: string;
      planStatus: "active";
      overallCurrentlyMeetingTarget: boolean;
    };

export interface MobilePerformanceCurrentResponse {
  generatedAt: string;
  plan: PerformancePlan | null;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
  displayState: MobilePerformanceCurrentDisplayState;
}

export interface BuildMobilePerformanceCurrentResponseParams {
  store: PerformancePlanStore;
  orgId: string | null;
  userId: string;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  now: Date;
  calculateProgress?: typeof calculatePerformanceProgress;
  buildInsights?: typeof buildPerformanceInsights;
  finalizeEndedPlan?: typeof finalizePerformancePlanIfEnded;
}

export async function buildMobilePerformanceCurrentResponse(
  params: BuildMobilePerformanceCurrentResponseParams
): Promise<MobilePerformanceCurrentResponse> {
  const generatedAt = params.now.toISOString();
  if (!params.orgId) {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const openPlan = await params.store.getOpenPlanForUser(params.orgId, params.userId);
  if (!openPlan) {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const finalizeEndedPlan = params.finalizeEndedPlan ?? finalizePerformancePlanIfEnded;
  const currentPlan = await finalizeEndedPlan({
    store: params.store,
    plan: openPlan.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });

  if (!currentPlan || currentPlan.plan.status !== "active") {
    return buildEmptyMobilePerformanceCurrentResponse(generatedAt);
  }

  const calculateProgress = params.calculateProgress ?? calculatePerformanceProgress;
  const buildInsights = params.buildInsights ?? buildPerformanceInsights;
  const progress = calculateProgress({
    plan: currentPlan.plan,
    usageSessions: params.usageSessions,
    scoreRecords: params.scoreRecords,
    now: params.now
  });

  return {
    generatedAt,
    plan: currentPlan.plan,
    progress: progress.progress,
    insights: buildInsights(progress.progress),
    displayState: deriveMobilePerformanceDisplayState(currentPlan, progress)
  };
}

export function buildEmptyMobilePerformanceCurrentResponse(generatedAt: string): MobilePerformanceCurrentResponse {
  return {
    generatedAt,
    plan: null,
    progress: null,
    insights: [],
    displayState: {
      state: "no_active_plan",
      planId: null,
      planStatus: "none",
      overallCurrentlyMeetingTarget: null
    }
  };
}

function deriveMobilePerformanceDisplayState(
  currentPlan: PerformancePlanWithRelations,
  progress: PerformanceProgressCalculation
): MobilePerformanceCurrentDisplayState {
  if (progress.progress.performance.enabled && progress.progress.performance.notEnoughData) {
    return {
      state: "active_collecting_evidence",
      planId: currentPlan.plan.id,
      planStatus: "active",
      overallCurrentlyMeetingTarget: progress.progress.overallCurrentlyMeetingTarget
    };
  }

  return {
    state: progress.progress.overallCurrentlyMeetingTarget ? "active_on_track" : "active_needs_attention",
    planId: currentPlan.plan.id,
    planStatus: "active",
    overallCurrentlyMeetingTarget: progress.progress.overallCurrentlyMeetingTarget
  };
}
