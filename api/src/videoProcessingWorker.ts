import dotenv from "dotenv";

import {
  FfmpegTrainingContentVideoMediaProcessor,
} from "./services/trainingContentVideoMedia.js";
import {
  processNextTrainingContentVideo,
} from "./services/trainingContentVideoWorker.js";
import { createTrainingContentAssetStore } from "./storage/trainingContentAssetStore.js";
import { createTrainingContentObjectStorage } from "./storage/trainingContentObjectStorage.js";
import {
  loadTrainingContentVideoWorkerConfig,
} from "./trainingContentVideoWorkerConfig.js";

dotenv.config();

async function run(): Promise<void> {
  const config = loadTrainingContentVideoWorkerConfig();
  const assetStore = createTrainingContentAssetStore({
    provider: "postgres",
    databaseUrl: config.databaseUrl,
    pgPoolMax: config.pgPoolMax,
    pgConnectTimeoutMs: config.pgConnectTimeoutMs,
    pgIdleTimeoutMs: config.pgIdleTimeoutMs,
  });
  const objectStorage = createTrainingContentObjectStorage(config.storage);
  const mediaProcessor = new FfmpegTrainingContentVideoMediaProcessor({
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    expectedVersionPrefix: config.mediaToolVersionPrefix,
  });
  await assetStore.initialize();
  await objectStorage.verifyReadiness();
  await mediaProcessor.verifyRuntime();

  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  console.log("[training-content-video-worker] ready; concurrency=1");

  while (!shutdown.signal.aborted) {
    const result = await processNextTrainingContentVideo({
      config: config.worker,
      assetStore,
      objectStorage,
      mediaProcessor,
      shutdownSignal: shutdown.signal,
    });
    if (result !== "idle") {
      console.log(`[training-content-video-worker] job outcome=${result}`);
      continue;
    }
    await waitForPoll(config.pollIntervalMs, shutdown.signal);
  }
  console.log("[training-content-video-worker] stopped");
}

async function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

run().catch(() => {
  console.error("[training-content-video-worker] fatal startup/runtime failure");
  process.exitCode = 1;
});
