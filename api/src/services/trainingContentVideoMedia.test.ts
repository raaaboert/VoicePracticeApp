import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  decideTrainingContentVideoProcessing,
  FfmpegTrainingContentVideoMediaProcessor,
  TrainingContentVideoInspection,
  validateTrainingContentVideoCandidate,
} from "./trainingContentVideoMedia.js";

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.TRAINING_CONTENT_FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE_PATH = process.env.TRAINING_CONTENT_FFPROBE_PATH?.trim() || "ffprobe";
const MEDIA_TOOLS_AVAILABLE = commandAvailable(FFMPEG_PATH) && commandAvailable(FFPROBE_PATH);

function inspection(
  overrides: Partial<TrainingContentVideoInspection> = {}
): TrainingContentVideoInspection {
  return {
    formatNames: ["mov", "mp4"],
    durationSeconds: 30,
    video: {
      codecName: "h264",
      profile: "Main",
      level: 40,
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      sampleAspectRatio: "1:1",
      displayAspectRatio: "16:9",
      rotationDegrees: 0,
      sideDataTypes: [],
      colorRange: "tv",
      colorSpace: "bt709",
      colorTransfer: "bt709",
      colorPrimaries: "bt709",
      durationSeconds: 30,
    },
    firstFrame: {
      width: 1920,
      height: 1080,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
      sampleAspectRatio: "1:1",
      sideDataTypes: [],
    },
    audio: [{
      codecName: "aac",
      profile: "LC",
      durationSeconds: 30,
    }],
    container: {
      trackWidth: 1920,
      trackHeight: 1080,
      sampleEntryType: "avc1",
      sampleEntryWidth: 1920,
      sampleEntryHeight: 1080,
      cleanApertureWidth: null,
      cleanApertureHeight: null,
    },
    ...overrides,
  };
}

test("healthy compatible MP4 dimensions bypass normalization", () => {
  assert.deepEqual(decideTrainingContentVideoProcessing(inspection()), {
    normalizationRequired: false,
    reasons: [],
  });
});

test("container/sample-entry disagreement requires lossless normalization", () => {
  const malformed = inspection({
    container: {
      trackWidth: 2560,
      trackHeight: 1440,
      sampleEntryType: "avc1",
      sampleEntryWidth: 2560,
      sampleEntryHeight: 1440,
      cleanApertureWidth: null,
      cleanApertureHeight: null,
    },
  });
  assert.deepEqual(decideTrainingContentVideoProcessing(malformed), {
    normalizationRequired: true,
    reasons: ["sample_entry_dimensions", "track_dimensions"],
  });
});

test("legitimate anamorphic display dimensions account for sample aspect ratio", () => {
  const base = inspection();
  const anamorphic = inspection({
    video: {
      ...base.video,
      width: 1440,
      height: 1080,
      codedWidth: 1440,
      codedHeight: 1080,
      sampleAspectRatio: "4:3",
      displayAspectRatio: "16:9",
    },
    firstFrame: {
      ...base.firstFrame,
      width: 1440,
      height: 1080,
      sampleAspectRatio: "4:3",
    },
    container: {
      ...base.container,
      trackWidth: 1920,
      trackHeight: 1080,
      sampleEntryWidth: 1440,
      sampleEntryHeight: 1080,
    },
  });

  assert.deepEqual(decideTrainingContentVideoProcessing(anamorphic), {
    normalizationRequired: false,
    reasons: [],
  });
});

test("legitimate rotated track dimensions remain healthy", () => {
  const base = inspection();
  const rotated = inspection({
    video: {
      ...base.video,
      rotationDegrees: 90,
    },
    container: {
      ...base.container,
      trackWidth: 1080,
      trackHeight: 1920,
    },
  });

  assert.deepEqual(decideTrainingContentVideoProcessing(rotated), {
    normalizationRequired: false,
    reasons: [],
  });
});

test("clean aperture continues to explain larger raster and track dimensions", () => {
  const base = inspection();
  const cleanAperture = inspection({
    container: {
      ...base.container,
      trackWidth: 2560,
      trackHeight: 1440,
      sampleEntryWidth: 2560,
      sampleEntryHeight: 1440,
      cleanApertureWidth: 1920,
      cleanApertureHeight: 1080,
    },
  });

  assert.deepEqual(decideTrainingContentVideoProcessing(cleanAperture), {
    normalizationRequired: false,
    reasons: [],
  });
});

test("candidate validation requires consistent dimensions, retained audio, and stable duration", () => {
  const source = inspection({
    container: {
      trackWidth: 2560,
      trackHeight: 1440,
      sampleEntryType: "avc1",
      sampleEntryWidth: 2560,
      sampleEntryHeight: 1440,
      cleanApertureWidth: null,
      cleanApertureHeight: null,
    },
  });
  assert.doesNotThrow(() => validateTrainingContentVideoCandidate({
    source,
    candidate: inspection(),
  }));
  assert.throws(
    () => validateTrainingContentVideoCandidate({
      source,
      candidate: inspection({ audio: [] }),
    }),
    /preserve the expected media streams/
  );
});

test("FFmpeg stream-copy remux corrects synthetic mismatched MP4 metadata and retains audio packets", {
  skip: !MEDIA_TOOLS_AVAILABLE,
}, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "peritio-media-test-"));
  try {
    const healthyPath = path.join(workspace, "healthy.mp4");
    const malformedPath = path.join(workspace, "malformed.mp4");
    const normalizedPath = path.join(workspace, "normalized.mp4");
    await execFileAsync(FFMPEG_PATH, [
      "-v", "error",
      "-f", "lavfi",
      "-i", "testsrc=size=64x36:rate=10:duration=1",
      "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=44100:duration=1",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      healthyPath,
    ], { windowsHide: true });
    const malformedBytes = await readFile(healthyPath);
    patchVideoContainerDimensions(malformedBytes, 96, 54);
    await writeFile(malformedPath, malformedBytes, { flag: "wx" });

    const processor = new FfmpegTrainingContentVideoMediaProcessor({
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
      expectedVersionPrefix: detectedVersionPrefix(),
    });
    await processor.verifyRuntime();
    const malformed = await processor.inspect(malformedPath);
    assert.equal(malformed.video.width, 64);
    assert.equal(malformed.video.height, 36);
    assert.equal(malformed.container.sampleEntryWidth, 96);
    assert.equal(malformed.container.sampleEntryHeight, 54);
    assert.equal(decideTrainingContentVideoProcessing(malformed).normalizationRequired, true);

    await processor.normalizeLosslessly(malformedPath, normalizedPath);
    const normalized = await processor.inspect(normalizedPath);
    validateTrainingContentVideoCandidate({ source: malformed, candidate: normalized });
    await processor.verifyReadable(normalizedPath);
    assert.equal(normalized.video.codecName, "h264");
    assert.equal(normalized.audio.length, 1);
    assert.equal(normalized.audio[0]?.codecName, "aac");
    assert.deepEqual(normalized.container, {
      trackWidth: 64,
      trackHeight: 36,
      sampleEntryType: "avc1",
      sampleEntryWidth: 64,
      sampleEntryHeight: 36,
      cleanApertureWidth: null,
      cleanApertureHeight: null,
    });
    assert.deepEqual(
      await packetHashes(normalizedPath),
      await packetHashes(malformedPath)
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function commandAvailable(command: string): boolean {
  return spawnSync(command, ["-version"], {
    windowsHide: true,
    stdio: "ignore",
  }).status === 0;
}

function detectedVersionPrefix(): string {
  const output = spawnSync(FFMPEG_PATH, ["-version"], {
    windowsHide: true,
    encoding: "utf8",
  }).stdout;
  const match = String(output).match(/^ffmpeg version ([^\s-]+)/i);
  if (!match?.[1]) {
    throw new Error("Could not determine the local FFmpeg version.");
  }
  return match[1];
}

function patchVideoContainerDimensions(
  bytes: Buffer,
  width: number,
  height: number
): void {
  const sampleDescriptionOffset = bytes.indexOf(Buffer.from("stsd", "ascii"));
  const avc1TypeOffset = sampleDescriptionOffset < 0
    ? -1
    : bytes.indexOf(Buffer.from("avc1", "ascii"), sampleDescriptionOffset + 4);
  if (avc1TypeOffset < 4) {
    throw new Error("Synthetic fixture is missing avc1.");
  }
  bytes.writeUInt16BE(width, avc1TypeOffset + 28);
  bytes.writeUInt16BE(height, avc1TypeOffset + 30);

  const tkhdOffsets: number[] = [];
  let offset = 0;
  while ((offset = bytes.indexOf(Buffer.from("tkhd", "ascii"), offset)) >= 0) {
    if (offset < avc1TypeOffset) {
      tkhdOffsets.push(offset);
    }
    offset += 4;
  }
  const tkhdTypeOffset = tkhdOffsets.at(-1);
  if (tkhdTypeOffset === undefined || tkhdTypeOffset < 4) {
    throw new Error("Synthetic fixture is missing the video tkhd box.");
  }
  const boxStart = tkhdTypeOffset - 4;
  const boxSize = bytes.readUInt32BE(boxStart);
  const boxEnd = boxStart + boxSize;
  bytes.writeUInt32BE(width * 65_536, boxEnd - 8);
  bytes.writeUInt32BE(height * 65_536, boxEnd - 4);
}

async function packetHashes(filePath: string): Promise<string[]> {
  const result = await execFileAsync(FFPROBE_PATH, [
    "-v", "error",
    "-show_packets",
    "-show_entries", "packet=stream_index,data_hash",
    "-show_data_hash", "sha256",
    "-of", "compact=p=0:nk=1",
    "--",
    filePath,
  ], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
}
