import type { DialogueMessage } from "../types";

export interface PendingSubmittedTurnRecovery {
  correlationId: string;
  userMessage: DialogueMessage | null;
  assistantMessage: DialogueMessage | null;
}

export function getMissingSubmittedTurnMessages(
  history: readonly DialogueMessage[],
  pending: PendingSubmittedTurnRecovery,
): DialogueMessage[] {
  const committedIds = new Set(history.map((message) => message.id));
  const userMessage = pending.userMessage;
  if (!userMessage || userMessage.role !== "user" || !userMessage.content.trim()) {
    return [];
  }

  const missing: DialogueMessage[] = [];
  if (!committedIds.has(userMessage.id)) {
    missing.push(userMessage);
    committedIds.add(userMessage.id);
  }
  const assistantMessage = pending.assistantMessage;
  if (
    assistantMessage
    && assistantMessage.role === "assistant"
    && assistantMessage.content.trim()
    && !committedIds.has(assistantMessage.id)
  ) {
    missing.push(assistantMessage);
  }
  return missing;
}

export function mergeSubmittedTurnRecovery(
  history: readonly DialogueMessage[],
  pending: PendingSubmittedTurnRecovery,
): DialogueMessage[] {
  return [...history, ...getMissingSubmittedTurnMessages(history, pending)];
}

export function getPendingSubmittedTurnRecoveryAfterAwaitFailure<
  TPending extends PendingSubmittedTurnRecovery,
>(
  pending: TPending | null,
  terminal: boolean,
): TPending | null {
  return terminal ? null : pending;
}

export async function settleSimulationBeforeCompletion(params: {
  getActiveTurnSettlement: () => Promise<void> | null;
  getActiveRecoverySettlement: () => Promise<void> | null;
  hasPendingRecovery: () => boolean;
  recoverPending: () => Promise<void>;
}): Promise<void> {
  const activeTurnSettlement = params.getActiveTurnSettlement();
  if (activeTurnSettlement) {
    await activeTurnSettlement;
  }

  const activeRecoverySettlement = params.getActiveRecoverySettlement();
  if (activeRecoverySettlement) {
    await activeRecoverySettlement;
    return;
  }
  if (params.hasPendingRecovery()) {
    await params.recoverPending();
  }
}
