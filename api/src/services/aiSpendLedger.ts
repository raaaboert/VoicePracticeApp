import type { AiUsageEvent } from "@voicepractice/shared";
import { AiSpendLedgerStore, AiSpendLedgerError, LegacyAiSpendLimitError, type SpendUnits } from "../storage/aiSpendLedgerStore.js";
import type { AiUsageBudgetLimits } from "../storage/aiUsageEventStore.js";
import { AiBudgetLimitError, SafeAiRouteError, safeErrorDiagnostics } from "./safeErrors.js";
import { isOpenAiRequestNotDispatched } from "./aiProviderDispatch.js";

/** Recording only: existing limits remain authoritative; no new ceilings here. */
export async function invokeWithAiSpendLedger<T>(input: {
  store: AiSpendLedgerStore; event: AiUsageEvent; userTimeZone: string; legacyLimits: AiUsageBudgetLimits;
  requestMaterial: unknown; units?: SpendUnits; registeredSessionId?: string | null;
  invoke: () => Promise<T>; resolveUsage?: (value: T) => { inputTokens: number; outputTokens: number; totalTokens: number };
  budgetMessage: (code: LegacyAiSpendLimitError["limitCode"]) => string;
}): Promise<{ value: T; usageEventId: string }> {
  let attempt;
  try {
    attempt = await input.store.reserve({ event: input.event, userTimeZone: input.userTimeZone, legacyLimits: input.legacyLimits,
      idempotencyKey: input.event.id, requestMaterial: input.requestMaterial, sessionId: input.registeredSessionId,
      policyVersion: "foundation-record-v1", leaseMs: 120_000, units: input.units });
  } catch (error) {
    if (error instanceof LegacyAiSpendLimitError) throw new AiBudgetLimitError(input.budgetMessage(error.limitCode));
    throw error; // Never fall back to unaccounted provider dispatch.
  }
  if (attempt.duplicate) throw new SafeAiRouteError({ status: 409, code: "ai_operation_in_progress", error: "This AI operation has already been accepted. Recover its existing result." });
  const identity = { id: attempt.attempt.id, actorId: input.event.userId, orgId: input.event.orgId };
  try {
    await input.store.dispatch(identity.id, identity.actorId, identity.orgId);
  } catch (error) {
    // A lost dispatch commit response is ambiguous too. Settlement refuses to
    // release a dispatched attempt; its reservation is retained/reconciled.
    try { await input.store.settle({ ...identity, outcome: "failed" }); } catch { /* Fail closed. */ }
    throw error;
  }
  let value: T;
  try { value = await input.invoke(); }
  catch (error) {
    try { await input.store.settle({ ...identity,
      ...(isOpenAiRequestNotDispatched(error) ? { outcome: "failed" as const, notDispatchedError: error } : { outcome: "unknown" as const }) }); }
    catch (settlementError) { logSettlementFailure(settlementError); }
    throw error;
  }
  try {
    await input.store.settle({ ...identity, outcome: "succeeded", units: input.units,
      usage: input.resolveUsage?.(value) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
  } catch (error) {
    // Do not discard a successful provider result or regenerate it. The atomic
    // conservative reservation survives until reconciliation can be retried.
    logSettlementFailure(error);
  }
  return { value, usageEventId: attempt.attempt.usage_event_id };
}

function logSettlementFailure(error: unknown) {
  console.warn("[ai-spend]", { event: "settlement_pending", ...safeErrorDiagnostics(error),
    ...(error instanceof AiSpendLedgerError ? { reason: error.code } : {}) });
}
