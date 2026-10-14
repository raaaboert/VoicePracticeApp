import type { PrefetchedRemoteSpeechChunk } from "./api";
import type { DialogueMessage } from "../types";

export interface SimulationOpeningPayload {
  assistantText: string;
  trainingPackId: string | null;
  speechPrefetch: PrefetchedRemoteSpeechChunk | null;
}

/** Ephemeral state owned by App for one authenticated session, across screen remounts. */
export function createSimulationStartupCoordinator() {
  let registration: Promise<void> | null = null;
  let openingRequest: Promise<SimulationOpeningPayload> | null = null;
  const startup = {
    registered: false,
    opening: null as SimulationOpeningPayload | null,
    openingDelivered: false,
    openingMessageCommitted: false,
    messages: [] as DialogueMessage[],
    startedAt: null as Date | null,
    register(register: () => Promise<unknown>): Promise<void> {
      if (startup.registered) return Promise.resolve();
      if (!registration) {
        registration = Promise.resolve().then(register).then(() => {
          startup.registered = true;
        }).catch((error: unknown) => {
          registration = null;
          throw error;
        });
      }
      return registration;
    },
    prepareOpening(create: () => Promise<SimulationOpeningPayload>): Promise<SimulationOpeningPayload> {
      if (!startup.registered) {
        return Promise.reject(new Error("Simulation session must be registered before preparing its opening."));
      }
      if (startup.opening) return Promise.resolve(startup.opening);
      if (!openingRequest) {
        openingRequest = Promise.resolve().then(create).then((payload) => {
          startup.opening = payload;
          return payload;
        }).catch((error: unknown) => {
          openingRequest = null;
          throw error;
        });
      }
      return openingRequest;
    },
  };
  return startup;
}

export type SimulationStartupCoordinator = ReturnType<typeof createSimulationStartupCoordinator>;
