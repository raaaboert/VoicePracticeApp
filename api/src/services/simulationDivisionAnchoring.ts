import type { SimulationSessionRecord } from "@voicepractice/shared";

export function doesRecognizedSimulationSessionMatchContext(
  session: SimulationSessionRecord | null,
  params: {
    userId: string;
    orgId: string | null;
    scenarioId: string;
    trainingId: string | null;
  }
): boolean {
  if (!session) {
    return false;
  }

  return (
    session.userId === params.userId &&
    session.orgId === params.orgId &&
    session.scenarioId === params.scenarioId &&
    (session.trainingId ?? null) === params.trainingId
  );
}

export function resolvePreferredSimulationDivisionId(params: {
  recognizedSession: SimulationSessionRecord | null;
  userId: string;
  orgId: string | null;
  scenarioId: string;
  trainingId: string | null;
  fallbackDivisionId: string | null;
}): string | null {
  if (
    doesRecognizedSimulationSessionMatchContext(params.recognizedSession, {
      userId: params.userId,
      orgId: params.orgId,
      scenarioId: params.scenarioId,
      trainingId: params.trainingId,
    })
  ) {
    return params.recognizedSession?.divisionId ?? null;
  }

  return params.fallbackDivisionId ?? null;
}
