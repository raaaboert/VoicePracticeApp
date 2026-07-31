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
  classifyTrainingContentVideoWorkerFailure,
  loadTrainingContentVideoWorkerConfig,
  type TrainingContentVideoWorkerFailureStage,
} from "./trainingContentVideoWorkerConfig.js";
import {
  waitForTrainingContentVideoPoll,
} from "./trainingContentVideoWorkerPolling.js";

dotenv.config();

let failureStage: TrainingContentVideoWorkerFailureStage = "config";

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
  failureStage = "database";
  await assetStore.initialize();
  failureStage = "r2";
  await objectStorage.verifyReadiness();
  failureStage = "media";
  await mediaProcessor.verifyRuntime();

  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  console.log("[training-content-video-worker] ready; concurrency=1");
  failureStage = "polling";

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
    await waitForTrainingContentVideoPoll(config.pollIntervalMs, shutdown.signal);
  }
  console.log("[training-content-video-worker] stopped");
}

run().catch((error: unknown) => {
  const category = classifyTrainingContentVideoWorkerFailure(failureStage, error);
  console.error(
    `[training-content-video-worker] fatal startup/runtime failure category=${category}`
  );
  process.exitCode = 1;
});
