import type { OrgTrainingSummary } from "@voicepractice/shared";

export function activeFocusTopicIds(trainings: readonly OrgTrainingSummary[]): string[] {
  return trainings.filter((training) => training.status === "active").map((training) => training.id);
}

export function focusTopicOrderChanged(
  trainings: readonly OrgTrainingSummary[],
  savedActiveIds: readonly string[],
): boolean {
  const current = activeFocusTopicIds(trainings);
  return current.length !== savedActiveIds.length
    || current.some((trainingId, index) => trainingId !== savedActiveIds[index]);
}

export function moveActiveFocusTopic(
  trainings: readonly OrgTrainingSummary[],
  trainingId: string,
  direction: -1 | 1,
): OrgTrainingSummary[] {
  const active = trainings.filter((training) => training.status === "active");
  const inactive = trainings.filter((training) => training.status !== "active");
  const currentIndex = active.findIndex((training) => training.id === trainingId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= active.length) {
    return [...trainings];
  }
  const reordered = [...active];
  [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex]!, reordered[currentIndex]!];
  return [...reordered, ...inactive];
}
