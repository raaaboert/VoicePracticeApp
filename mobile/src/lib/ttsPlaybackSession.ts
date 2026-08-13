import { subscribeToAbort } from "./abortSignal";

export interface TtsPlaybackStatusSnapshot {
  isLoaded: boolean;
  playing: boolean;
  didJustFinish: boolean;
}

export interface TtsPlaybackStatusState {
  audioLoaded: boolean;
  playbackStarted: boolean;
  playbackCompleted: boolean;
}

export const INITIAL_TTS_PLAYBACK_STATUS_STATE: TtsPlaybackStatusState = {
  audioLoaded: false,
  playbackStarted: false,
  playbackCompleted: false,
};

export function advanceTtsPlaybackStatus(
  state: TtsPlaybackStatusState,
  status: TtsPlaybackStatusSnapshot,
): TtsPlaybackStatusState {
  const audioLoaded = state.audioLoaded || status.isLoaded;
  const playbackStarted = state.playbackStarted || (status.isLoaded && status.playing);
  return {
    audioLoaded,
    playbackStarted,
    playbackCompleted:
      state.playbackCompleted || (status.isLoaded && state.playbackStarted && status.didJustFinish),
  };
}

export interface TtsPlaybackSession {
  playbackFinished: Promise<void>;
  isSettled(): boolean;
  settleCompleted(): void;
  settleFailed(error: unknown): void;
  startPlaybackTimeout(timeoutMs: number): void;
}

export function createPlaybackSession(params: {
  abortSignal?: AbortSignal;
  clearStatusListener: () => void;
  createCancellationError: () => Error;
  createTimeoutError: (timeoutMs: number) => Error;
  onTimeout?: (timeoutMs: number) => void;
}): TtsPlaybackSession {
  let playbackTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let unsubscribeFromAbort: () => void = () => undefined;
  let resolvePlayback!: () => void;
  let rejectPlayback!: (error: unknown) => void;
  const playbackFinished = new Promise<void>((resolve, reject) => {
    resolvePlayback = resolve;
    rejectPlayback = reject;
  });

  // Mark an early abort rejection as handled while loadAsync is still pending.
  // Awaiting the original promise later still observes the same rejection.
  void playbackFinished.catch(() => undefined);

  const clearPlaybackTimeout = () => {
    if (playbackTimeoutHandle) {
      clearTimeout(playbackTimeoutHandle);
      playbackTimeoutHandle = null;
    }
  };
  const settle = (kind: "resolve" | "reject", error?: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    clearPlaybackTimeout();
    params.clearStatusListener();
    unsubscribeFromAbort();
    if (kind === "resolve") {
      resolvePlayback();
    } else {
      rejectPlayback(error);
    }
  };
  const session: TtsPlaybackSession = {
    playbackFinished,
    isSettled: () => settled,
    settleCompleted: () => {
      settle("resolve");
    },
    settleFailed: (error) => {
      settle("reject", error);
    },
    startPlaybackTimeout: (timeoutMs) => {
      clearPlaybackTimeout();
      playbackTimeoutHandle = setTimeout(() => {
        params.onTimeout?.(timeoutMs);
        settle("reject", params.createTimeoutError(timeoutMs));
      }, timeoutMs);
    },
  };

  unsubscribeFromAbort = subscribeToAbort(params.abortSignal, () => {
    session.settleFailed(params.createCancellationError());
  });

  return session;
}
