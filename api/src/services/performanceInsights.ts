import { PerformanceInsight, PerformanceProgress } from "@voicepractice/shared";

export function buildPerformanceInsights(progress: PerformanceProgress): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  if (progress.performance.enabled && progress.performance.notEnoughData) {
    insights.push({
      status: "not_enough_data",
      message: "There is not enough scored practice in this goal window yet.",
      recommendedNextStep: "Complete at least three scored sessions in the selected scope.",
      metadata: { eligibleScoreCount: progress.performance.eligibleScoreCount }
    });
  }

  if (progress.performance.enabled && !progress.performance.notEnoughData && progress.performance.targetScore !== null) {
    const current = progress.performance.currentAverage ?? 0;
    const remaining = progress.performance.targetScore - current;
    if (remaining <= 0) {
      insights.push({
        status: "goal_met",
        message: `Current average is ${Math.abs(remaining).toFixed(1)} points above target.`,
        recommendedNextStep: "Keep practicing in the selected scope to maintain the result.",
        metadata: { pointsAboveTarget: Math.abs(remaining) }
      });
    } else {
      insights.push({
        status: remaining <= 5 ? "on_track" : "needs_attention",
        message: `Current average is ${remaining.toFixed(1)} points away from target.`,
        recommendedNextStep: remaining <= 5
          ? "Use the next session to reinforce the behaviors that already improved."
          : "Schedule another practice session in one of the selected scenarios.",
        metadata: { pointsRemaining: remaining }
      });
    }
  }

  if (progress.activity.enabled) {
    const remaining = progress.activity.cumulativeTargetValue - progress.activity.actualValue;
    if (remaining <= 0) {
      insights.push({
        status: "ahead_of_goal",
        message: "Practice activity is meeting the cumulative target.",
        recommendedNextStep: "Keep the same practice rhythm through the rest of the plan.",
        metadata: {
          actualValue: progress.activity.actualValue,
          cumulativeTargetValue: progress.activity.cumulativeTargetValue
        }
      });
    } else {
      insights.push({
        status: "needs_attention",
        message: "Practice activity is behind the cumulative target.",
        recommendedNextStep: "Complete another in-scope practice session before the next plan week closes.",
        metadata: {
          remaining,
          actualValue: progress.activity.actualValue,
          cumulativeTargetValue: progress.activity.cumulativeTargetValue
        }
      });
    }
  }

  if (progress.activity.weeklyConsistency) {
    insights.push({
      status:
        progress.activity.weeklyConsistency.completedWeeks >= progress.activity.weeklyConsistency.totalWeeks
          ? "ahead_of_goal"
          : "on_track",
      message: `${progress.activity.weeklyConsistency.completedWeeks} of ${progress.activity.weeklyConsistency.totalWeeks} plan weeks met the activity target.`,
      recommendedNextStep: "Use weekly consistency as the pacing check, not a final all-or-nothing rule.",
      metadata: progress.activity.weeklyConsistency
    });
  }

  if (insights.length === 0) {
    insights.push({
      status: "on_track",
      message: "Performance progress is available.",
      recommendedNextStep: "Review current practice activity and score evidence before changing the plan."
    });
  }

  return insights;
}
