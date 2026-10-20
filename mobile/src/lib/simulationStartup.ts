import type { PrefetchedRemoteSpeechChunk } from "./api";
import type { DialogueMessage } from "../types";
import { MobileApiError, isSimulationSessionEndedError } from "./apiError";
import { createSimulationServiceRecovery } from "./simulationServiceRecovery";

export const SIMULATION_DEADLINE_MARGIN_MS = 5_000;

export function getSimulationRemainingSeconds(params: {
  maxSessionSeconds: number | null;
  elapsedSeconds: number;
  absoluteDeadlineMs: number | null;
  nowMs: number;
}): number | null {
  const active = params.maxSessionSeconds === null ? Infinity : Math.max(0, params.maxSessionSeconds - params.elapsedSeconds);
  const absolute = params.absoluteDeadlineMs === null ? Infinity
    : Math.max(0, Math.floor((params.absoluteDeadlineMs - SIMULATION_DEADLINE_MARGIN_MS - params.nowMs) / 1_000));
  const remaining = Math.min(active, absolute);
  return Number.isFinite(remaining) ? remaining : null;
}

export interface SimulationOpeningPayload {
  assistantText: string;
  trainingPackId: string | null;
  speechPrefetch: PrefetchedRemoteSpeechChunk | null;
  speechAuthorization?: string;
}

/** Ephemeral state owned by App for one authenticated session, across screen remounts. */
export function createSimulationStartupCoordinator(now: () => number = Date.now) {
  let registration: Promise<void> | null = null;
  let openingRequest: Promise<SimulationOpeningPayload> | null = null;
  let completion: Promise<void> | null = null;
  let durationMs: number | null = null;
  const startup = {
    serviceRecovery: createSimulationServiceRecovery(),
    registered: false,
    registrationRequestedAtMs: null as number | null,
    absoluteDeadlineMs: null as number | null,
    conversationClosed: false,
    completionRequested: false,
    completionDelivered: false,
    opening: null as SimulationOpeningPayload | null,
    openingDelivered: false,
    openingMessageCommitted: false,
    messages: [] as DialogueMessage[],
    // Session-owned memory survives screen remounts, never enters transcripts or storage.
    speechAuthorizations: new Map<string, string>(),
    startedAt: null as Date | null,
    assertConversationAvailable(): void {
      const deadline = startup.absoluteDeadlineMs
        ?? (startup.registrationRequestedAtMs !== null && durationMs !== null ? startup.registrationRequestedAtMs + durationMs : null);
      if (startup.conversationClosed) {
        throw new MobileApiError("Simulation conversation is already completed.", 409, "session_completed");
      }
      if (deadline !== null && now() >= deadline - SIMULATION_DEADLINE_MARGIN_MS) {
        throw new MobileApiError("Simulation session has expired.", 409, "session_expired");
      }
    },
    register(register: () => Promise<unknown>, options?: { maxSimulationMinutes?: number | null }): Promise<void> {
      try { startup.assertConversationAvailable(); } catch (error) { return Promise.reject(error); }
      if (startup.registered) return Promise.resolve();
      if (!registration) {
        registration = Promise.resolve().then(() => {
          startup.assertConversationAvailable();
          // Keep the first attempt even after a lost response: retry must not
          // extend a deadline that the server may already have established.
          startup.registrationRequestedAtMs ??= now();
          const minutes = options?.maxSimulationMinutes;
          if (durationMs === null && typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
            durationMs = minutes * 60_000;
          }
          return register();
        }).then(() => {
          startup.registered = true;
          if (startup.registrationRequestedAtMs !== null && durationMs !== null) {
            startup.absoluteDeadlineMs ??= startup.registrationRequestedAtMs + durationMs;
          }
          startup.assertConversationAvailable();
        }).catch((error: unknown) => {
          if (isSimulationSessionEndedError(error)) {
            startup.conversationClosed = true;
            startup.completionRequested = startup.registered;
          }
          registration = null;
          throw error;
        });
      }
      return registration;
    },
    prepareOpening(create: () => Promise<SimulationOpeningPayload>): Promise<SimulationOpeningPayload> {
      try { startup.assertConversationAvailable(); } catch (error) { return Promise.reject(error); }
      if (!startup.registered) {
        return Promise.reject(new Error("Simulation session must be registered before preparing its opening."));
      }
      if (startup.opening) return Promise.resolve(startup.opening);
      if (!openingRequest) {
        openingRequest = Promise.resolve().then(create).then((payload) => {
          startup.assertConversationAvailable();
          startup.opening = payload;
          return payload;
        }).catch((error: unknown) => {
          if (isSimulationSessionEndedError(error)) {
            startup.conversationClosed = true;
            startup.completionRequested = true;
          }
          openingRequest = null;
          throw error;
        });
      }
      return openingRequest;
    },
    complete(complete: () => Promise<void>): Promise<void> {
      startup.conversationClosed = true;
      startup.completionRequested = true;
      if (startup.completionDelivered) return Promise.resolve();
      if (!completion) completion = Promise.resolve().then(complete).finally(() => { completion = null; });
      return completion;
    },
    deliverCompletion(deliver: () => void): void {
      if (startup.completionDelivered) return;
      startup.completionDelivered = true;
      deliver();
    },
  };
  return startup;
}

export type SimulationStartupCoordinator = ReturnType<typeof createSimulationStartupCoordinator>;
