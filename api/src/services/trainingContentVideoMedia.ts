import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";

const MAX_PROBE_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROCESS_ERROR_BYTES = 64 * 1024;
const MAX_MP4_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_SENSIBLE_DIMENSION = 16_384;
const MAX_SENSIBLE_DURATION_SECONDS = 24 * 60 * 60;

export interface TrainingContentVideoStreamInspection {
  codecName: string;
  profile: string | null;
  level: number | null;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  sampleAspectRatio: string;
  displayAspectRatio: string;
  rotationDegrees: number;
  sideDataTypes: string[];
  colorRange: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  durationSeconds: number;
}

export interface TrainingContentVideoFrameInspection {
  width: number;
  height: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  sampleAspectRatio: string;
  sideDataTypes: string[];
}

export interface TrainingContentAudioStreamInspection {
  codecName: string;
  profile: string | null;
  durationSeconds: number | null;
}

export interface TrainingContentMp4Dimensions {
  trackWidth: number;
  trackHeight: number;
  sampleEntryType: string;
  sampleEntryWidth: number;
  sampleEntryHeight: number;
  cleanApertureWidth: number | null;
  cleanApertureHeight: number | null;
}

export interface TrainingContentVideoInspection {
  formatNames: string[];
  durationSeconds: number;
  video: TrainingContentVideoStreamInspection;
  firstFrame: TrainingContentVideoFrameInspection;
  audio: TrainingContentAudioStreamInspection[];
  container: TrainingContentMp4Dimensions;
}

export interface TrainingContentVideoDecision {
  normalizationRequired: boolean;
  reasons: Array<"sample_entry_dimensions" | "track_dimensions">;
}

export interface TrainingContentVideoMediaProcessor {
  verifyRuntime(): Promise<void>;
  inspect(filePath: string, signal?: AbortSignal): Promise<TrainingContentVideoInspection>;
  verifyReadable(filePath: string, signal?: AbortSignal): Promise<void>;
  normalizeLosslessly(
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal
  ): Promise<void>;
}

export class TrainingContentVideoProcessingError extends Error {
  constructor(
    readonly category: string,
    readonly transient: boolean,
    message: string
  ) {
    super(message);
    this.name = "TrainingContentVideoProcessingError";
  }
}

interface FfmpegVideoMediaProcessorOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  expectedVersionPrefix: string;
}

export class FfmpegTrainingContentVideoMediaProcessor
implements TrainingContentVideoMediaProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(private readonly options: FfmpegVideoMediaProcessorOptions) {
    this.ffmpegPath = options.ffmpegPath?.trim() || "ffmpeg";
    this.ffprobePath = options.ffprobePath?.trim() || "ffprobe";
  }

  async verifyRuntime(): Promise<void> {
    const [ffmpeg, ffprobe] = await Promise.all([
      runMediaProcess(this.ffmpegPath, ["-version"], {
        category: "ffmpeg_unavailable",
        maximumStdoutBytes: 64 * 1024,
      }),
      runMediaProcess(this.ffprobePath, ["-version"], {
        category: "ffprobe_unavailable",
        maximumStdoutBytes: 64 * 1024,
      }),
    ]);
    const expected = `version ${this.options.expectedVersionPrefix}`;
    if (
      !firstLine(ffmpeg.stdout).includes(expected)
      || !firstLine(ffprobe.stdout).includes(expected)
    ) {
      throw new TrainingContentVideoProcessingError(
        "media_tool_version_mismatch",
        false,
        "The installed FFmpeg and FFprobe versions do not match the required worker version."
      );
    }
  }

  async inspect(
    filePath: string,
    signal?: AbortSignal
  ): Promise<TrainingContentVideoInspection> {
    const probe = await runMediaProcess(
      this.ffprobePath,
      [
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-show_frames",
        "-read_intervals", "%+#1",
        "-of", "json",
        "--",
        filePath,
      ],
      {
        category: "media_probe_failed",
        maximumStdoutBytes: MAX_PROBE_OUTPUT_BYTES,
        signal,
      }
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(probe.stdout);
    } catch {
      throw invalidMedia("FFprobe returned unreadable media metadata.");
    }
    return parseProbeInspection(parsed, await inspectMp4Dimensions(filePath));
  }

  async verifyReadable(filePath: string, signal?: AbortSignal): Promise<void> {
    await runMediaProcess(
      this.ffmpegPath,
      [
        "-v", "error",
        "-xerror",
        "-i", filePath,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c", "copy",
        "-f", "null",
        "-",
      ],
      {
        category: "media_packet_validation_failed",
        maximumStdoutBytes: 1024,
        signal,
      }
    );
  }

  async normalizeLosslessly(
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal
  ): Promise<void> {
    await runMediaProcess(
      this.ffmpegPath,
      [
        "-v", "error",
        "-xerror",
        "-nostdin",
        "-i", sourcePath,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-map_metadata", "0",
        "-map_chapters", "0",
        "-c", "copy",
        "-movflags", "+faststart",
        "-f", "mp4",
        destinationPath,
      ],
      {
        category: "media_remux_failed",
        maximumStdoutBytes: 1024,
        signal,
      }
    );
  }
}

export function decideTrainingContentVideoProcessing(
  inspection: TrainingContentVideoInspection
): TrainingContentVideoDecision {
  assertCompatibleInspection(inspection);
  const reasons: TrainingContentVideoDecision["reasons"] = [];
  const presentation = decodedPresentationDimensions(inspection);
  const cleanApertureExplainsDimensions =
    inspection.container.cleanApertureWidth === presentation.width
    && inspection.container.cleanApertureHeight === presentation.height;
  if (
    (
      inspection.container.sampleEntryWidth !== presentation.width
      || inspection.container.sampleEntryHeight !== presentation.height
    )
    && !cleanApertureExplainsDimensions
  ) {
    reasons.push("sample_entry_dimensions");
  }
  if (!trackDimensionsMatchPresentation(inspection)) {
    reasons.push("track_dimensions");
  }
  return {
    normalizationRequired: reasons.length > 0,
    reasons,
  };
}

export function validateTrainingContentVideoCandidate(params: {
  source: TrainingContentVideoInspection;
  candidate: TrainingContentVideoInspection;
}): void {
  const decision = decideTrainingContentVideoProcessing(params.candidate);
  if (decision.normalizationRequired) {
    throw invalidMedia("The candidate MP4 still contains inconsistent presentation dimensions.");
  }
  if (
    params.candidate.video.codecName !== params.source.video.codecName
    || params.candidate.audio.length !== params.source.audio.length
    || params.candidate.audio.some(
      (audio, index) => audio.codecName !== params.source.audio[index]?.codecName
    )
  ) {
    throw invalidMedia("The candidate MP4 did not preserve the expected media streams.");
  }
  const durationTolerance = Math.max(0.1, params.source.durationSeconds * 0.001);
  if (Math.abs(params.candidate.durationSeconds - params.source.durationSeconds) > durationTolerance) {
    throw invalidMedia("The candidate MP4 duration changed unexpectedly.");
  }
}

export async function inspectMp4Dimensions(
  filePath: string
): Promise<TrainingContentMp4Dimensions> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw invalidMedia("The uploaded video is empty.");
  }
  const handle = await open(filePath, "r");
  try {
    let offset = 0;
    while (offset < fileStat.size) {
      const box = await readFileBoxHeader(handle, offset, fileStat.size);
      if (box.type === "moov") {
        const payloadSize = box.end - box.payloadStart;
        if (payloadSize <= 0 || payloadSize > MAX_MP4_METADATA_BYTES) {
          throw invalidMedia("The MP4 metadata is outside the supported bound.");
        }
        const buffer = Buffer.alloc(payloadSize);
        const read = await handle.read(buffer, 0, buffer.byteLength, box.payloadStart);
        if (read.bytesRead !== buffer.byteLength) {
          throw invalidMedia("The MP4 metadata is truncated.");
        }
        return parseMoovDimensions(buffer);
      }
      offset = box.end;
    }
  } finally {
    await handle.close();
  }
  throw invalidMedia("The uploaded video does not contain MP4 movie metadata.");
}

interface FileBox {
  type: string;
  payloadStart: number;
  end: number;
}

async function readFileBoxHeader(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  fileSize: number
): Promise<FileBox> {
  const header = Buffer.alloc(16);
  const read = await handle.read(header, 0, header.byteLength, offset);
  if (read.bytesRead < 8) {
    throw invalidMedia("The MP4 box header is truncated.");
  }
  const size32 = header.readUInt32BE(0);
  const type = header.toString("ascii", 4, 8);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (read.bytesRead < 16) {
      throw invalidMedia("The MP4 extended box header is truncated.");
    }
    const size64 = header.readBigUInt64BE(8);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidMedia("The MP4 box is too large to inspect safely.");
    }
    size = Number(size64);
    headerSize = 16;
  } else if (size32 === 0) {
    size = fileSize - offset;
  }
  if (size < headerSize || offset + size > fileSize) {
    throw invalidMedia("The MP4 box size is invalid.");
  }
  return {
    type,
    payloadStart: offset + headerSize,
    end: offset + size,
  };
}

interface BufferBox {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
}

function listChildBoxes(buffer: Buffer, start = 0, end = buffer.length): BufferBox[] {
  const boxes: BufferBox[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) {
      throw invalidMedia("The MP4 metadata contains a truncated child box.");
    }
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) {
        throw invalidMedia("The MP4 metadata contains a truncated extended child box.");
      }
      const size64 = buffer.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw invalidMedia("The MP4 metadata child box is too large.");
      }
      size = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      throw invalidMedia("The MP4 metadata child box size is invalid.");
    }
    boxes.push({
      type,
      start: offset,
      payloadStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }
  return boxes;
}

function parseMoovDimensions(buffer: Buffer): TrainingContentMp4Dimensions {
  for (const track of listChildBoxes(buffer).filter((box) => box.type === "trak")) {
    const trackChildren = listChildBoxes(buffer, track.payloadStart, track.end);
    const media = trackChildren.find((box) => box.type === "mdia");
    const trackHeader = trackChildren.find((box) => box.type === "tkhd");
    if (!media || !trackHeader) {
      continue;
    }
    const mediaChildren = listChildBoxes(buffer, media.payloadStart, media.end);
    const handler = mediaChildren.find((box) => box.type === "hdlr");
    if (
      !handler
      || handler.end - handler.payloadStart < 12
      || buffer.toString("ascii", handler.payloadStart + 8, handler.payloadStart + 12) !== "vide"
    ) {
      continue;
    }
    const mediaInfo = mediaChildren.find((box) => box.type === "minf");
    if (!mediaInfo) {
      throw invalidMedia("The MP4 video track is missing media information.");
    }
    const sampleTable = listChildBoxes(buffer, mediaInfo.payloadStart, mediaInfo.end)
      .find((box) => box.type === "stbl");
    if (!sampleTable) {
      throw invalidMedia("The MP4 video track is missing a sample table.");
    }
    const sampleDescription = listChildBoxes(
      buffer,
      sampleTable.payloadStart,
      sampleTable.end
    ).find((box) => box.type === "stsd");
    if (!sampleDescription || sampleDescription.end - sampleDescription.payloadStart < 16) {
      throw invalidMedia("The MP4 video track is missing a sample description.");
    }
    const entries = listChildBoxes(
      buffer,
      sampleDescription.payloadStart + 8,
      sampleDescription.end
    );
    const entry = entries[0];
    if (!entry || entry.end - entry.payloadStart < 28) {
      throw invalidMedia("The MP4 video sample entry is invalid.");
    }
    const trackWidth = fixedPointDimension(buffer.readUInt32BE(trackHeader.end - 8));
    const trackHeight = fixedPointDimension(buffer.readUInt32BE(trackHeader.end - 4));
    const sampleEntryWidth = buffer.readUInt16BE(entry.payloadStart + 24);
    const sampleEntryHeight = buffer.readUInt16BE(entry.payloadStart + 26);
    assertDimensions(trackWidth, trackHeight, "MP4 track");
    assertDimensions(sampleEntryWidth, sampleEntryHeight, "MP4 sample entry");
    return {
      trackWidth,
      trackHeight,
      sampleEntryType: entry.type,
      sampleEntryWidth,
      sampleEntryHeight,
      ...parseCleanAperture(buffer, entry),
    };
  }
  throw invalidMedia("The MP4 does not contain one inspectable video track.");
}

function parseCleanAperture(
  buffer: Buffer,
  sampleEntry: BufferBox
): Pick<
  TrainingContentMp4Dimensions,
  "cleanApertureWidth" | "cleanApertureHeight"
> {
  const childStart = sampleEntry.payloadStart + 78;
  if (childStart >= sampleEntry.end) {
    return { cleanApertureWidth: null, cleanApertureHeight: null };
  }
  const cleanAperture = listChildBoxes(buffer, childStart, sampleEntry.end)
    .find((box) => box.type === "clap");
  if (!cleanAperture) {
    return { cleanApertureWidth: null, cleanApertureHeight: null };
  }
  if (cleanAperture.end - cleanAperture.payloadStart < 32) {
    throw invalidMedia("The MP4 clean-aperture metadata is truncated.");
  }
  const widthDenominator = buffer.readUInt32BE(cleanAperture.payloadStart + 4);
  const heightDenominator = buffer.readUInt32BE(cleanAperture.payloadStart + 12);
  if (widthDenominator === 0 || heightDenominator === 0) {
    throw invalidMedia("The MP4 clean-aperture metadata is invalid.");
  }
  const width = buffer.readUInt32BE(cleanAperture.payloadStart) / widthDenominator;
  const height = buffer.readUInt32BE(cleanAperture.payloadStart + 8) / heightDenominator;
  assertDimensions(width, height, "MP4 clean aperture");
  return {
    cleanApertureWidth: width,
    cleanApertureHeight: height,
  };
}

function fixedPointDimension(value: number): number {
  const dimension = value / 65_536;
  return Number.isInteger(dimension) ? dimension : Number(dimension.toFixed(4));
}

function parseProbeInspection(
  raw: unknown,
  container: TrainingContentMp4Dimensions
): TrainingContentVideoInspection {
  const root = requiredRecord(raw, "FFprobe result");
  const format = requiredRecord(root.format, "FFprobe format");
  const streams = Array.isArray(root.streams) ? root.streams : [];
  const videoStreams = streams
    .map((stream) => requiredRecord(stream, "FFprobe stream"))
    .filter((stream) => stream.codec_type === "video");
  if (videoStreams.length !== 1) {
    throw invalidMedia("Training Content videos must contain exactly one video stream.");
  }
  const video = videoStreams[0]!;
  const frames = Array.isArray(root.frames) ? root.frames : [];
  const firstFrame = frames
    .map((frame) => requiredRecord(frame, "FFprobe frame"))
    .find((frame) => frame.media_type === "video");
  if (!firstFrame) {
    throw invalidMedia("FFprobe could not decode an initial video frame.");
  }
  const audio = streams
    .map((stream) => requiredRecord(stream, "FFprobe stream"))
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => ({
      codecName: requiredString(stream.codec_name, "Audio codec"),
      profile: optionalString(stream.profile),
      durationSeconds: optionalPositiveNumber(stream.duration),
    }));
  const durationSeconds = requiredPositiveNumber(format.duration, "Container duration");
  const inspection: TrainingContentVideoInspection = {
    formatNames: requiredString(format.format_name, "Container format")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    durationSeconds,
    video: {
      codecName: requiredString(video.codec_name, "Video codec"),
      profile: optionalString(video.profile),
      level: optionalInteger(video.level),
      width: requiredPositiveInteger(video.width, "Video width"),
      height: requiredPositiveInteger(video.height, "Video height"),
      codedWidth: requiredPositiveInteger(video.coded_width, "Coded video width"),
      codedHeight: requiredPositiveInteger(video.coded_height, "Coded video height"),
      sampleAspectRatio: requiredRatio(video.sample_aspect_ratio, "Sample aspect ratio"),
      displayAspectRatio: requiredRatio(video.display_aspect_ratio, "Display aspect ratio"),
      rotationDegrees: parseRotation(video.side_data_list),
      sideDataTypes: parseSideDataTypes(video.side_data_list),
      colorRange: optionalString(video.color_range),
      colorSpace: optionalString(video.color_space),
      colorTransfer: optionalString(video.color_transfer),
      colorPrimaries: optionalString(video.color_primaries),
      durationSeconds: optionalPositiveNumber(video.duration) ?? durationSeconds,
    },
    firstFrame: {
      width: requiredPositiveInteger(firstFrame.width, "Decoded frame width"),
      height: requiredPositiveInteger(firstFrame.height, "Decoded frame height"),
      cropLeft: optionalNonNegativeInteger(firstFrame.crop_left),
      cropRight: optionalNonNegativeInteger(firstFrame.crop_right),
      cropTop: optionalNonNegativeInteger(firstFrame.crop_top),
      cropBottom: optionalNonNegativeInteger(firstFrame.crop_bottom),
      sampleAspectRatio: requiredRatio(
        firstFrame.sample_aspect_ratio ?? video.sample_aspect_ratio,
        "Frame sample aspect ratio"
      ),
      sideDataTypes: parseSideDataTypes(firstFrame.side_data_list),
    },
    audio,
    container,
  };
  return inspection;
}

function assertCompatibleInspection(inspection: TrainingContentVideoInspection): void {
  if (!inspection.formatNames.includes("mp4") && !inspection.formatNames.includes("mov")) {
    throw invalidMedia("The uploaded video is not a supported MP4 container.");
  }
  if (inspection.video.codecName !== "h264") {
    throw invalidMedia("Training Content MP4 videos must use H.264 video.");
  }
  if (!["avc1", "avc3"].includes(inspection.container.sampleEntryType)) {
    throw invalidMedia("The MP4 video sample entry is not H.264.");
  }
  if (inspection.audio.some((stream) => stream.codecName !== "aac")) {
    throw invalidMedia("Training Content MP4 audio streams must use AAC.");
  }
  assertDimensions(inspection.video.width, inspection.video.height, "Decoded video");
  assertDimensions(inspection.video.codedWidth, inspection.video.codedHeight, "Coded video");
  const presentation = decodedPresentationDimensions(inspection);
  assertDimensions(presentation.width, presentation.height, "Decoded presentation");
  if (
    !Number.isFinite(inspection.durationSeconds)
    || inspection.durationSeconds <= 0
    || inspection.durationSeconds > MAX_SENSIBLE_DURATION_SECONDS
  ) {
    throw invalidMedia("The uploaded video duration is outside the supported range.");
  }
}

function trackDimensionsMatchPresentation(inspection: TrainingContentVideoInspection): boolean {
  const presentation = decodedPresentationDimensions(inspection);
  const sampleAspectRatio = parseRatio(inspection.firstFrame.sampleAspectRatio);
  const display = {
    width: presentation.width * sampleAspectRatio.numerator / sampleAspectRatio.denominator,
    height: presentation.height,
  };
  const rotation = normalizeRotation(inspection.video.rotationDegrees);
  const rotated = rotation === 90 || rotation === 270;
  const expectedWidth = rotated ? display.height : display.width;
  const expectedHeight = rotated ? display.width : display.height;
  return (
    integerDisplayDimensionsMatch(inspection.container.trackWidth, expectedWidth)
    && integerDisplayDimensionsMatch(inspection.container.trackHeight, expectedHeight)
  ) || (
    inspection.container.cleanApertureWidth === presentation.width
    && inspection.container.cleanApertureHeight === presentation.height
    && inspection.container.trackWidth === inspection.container.sampleEntryWidth
    && inspection.container.trackHeight === inspection.container.sampleEntryHeight
  );
}

function parseRatio(value: string): { numerator: number; denominator: number } {
  const match = value.match(/^(\d+):(\d+)$/);
  const numerator = Number(match?.[1]);
  const denominator = Number(match?.[2]);
  if (
    !Number.isSafeInteger(numerator)
    || numerator <= 0
    || !Number.isSafeInteger(denominator)
    || denominator <= 0
  ) {
    throw invalidMedia("Sample aspect ratio is invalid.");
  }
  return { numerator, denominator };
}

function integerDisplayDimensionsMatch(actual: number, expected: number): boolean {
  return Math.round(actual) === Math.round(expected);
}

function parseRotation(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  for (const entry of value) {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const rotation = record ? Number(record.rotation) : Number.NaN;
    if (Number.isFinite(rotation)) {
      return rotation;
    }
  }
  return 0;
}

function parseSideDataTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = entry && typeof entry === "object"
      ? entry as Record<string, unknown>
      : null;
    const type = record ? optionalString(record.side_data_type) : null;
    return type ? [type] : [];
  });
}

function decodedPresentationDimensions(
  inspection: TrainingContentVideoInspection
): { width: number; height: number } {
  return {
    width: inspection.firstFrame.width
      - inspection.firstFrame.cropLeft
      - inspection.firstFrame.cropRight,
    height: inspection.firstFrame.height
      - inspection.firstFrame.cropTop
      - inspection.firstFrame.cropBottom,
  };
}

function normalizeRotation(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function assertDimensions(width: number, height: number, label: string): void {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > MAX_SENSIBLE_DIMENSION
    || height > MAX_SENSIBLE_DIMENSION
  ) {
    throw invalidMedia(`${label} dimensions are outside the supported range.`);
  }
}

function requiredRatio(value: unknown, label: string): string {
  const ratio = requiredString(value, label);
  const match = ratio.match(/^(\d+):(\d+)$/);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw invalidMedia(`${label} is invalid.`);
  }
  return ratio;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidMedia(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidMedia(`${label} is missing.`);
  }
  return value.trim().toLowerCase();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalidMedia(`${label} is invalid.`);
  }
  return parsed;
}

function optionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalNonNegativeInteger(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw invalidMedia("Decoded frame crop metadata is invalid.");
  }
  return parsed;
}

function requiredPositiveNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidMedia(`${label} is invalid.`);
  }
  return parsed;
}

function optionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function invalidMedia(message: string): TrainingContentVideoProcessingError {
  return new TrainingContentVideoProcessingError("invalid_media", false, message);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim().toLowerCase() ?? "";
}

async function runMediaProcess(
  executable: string,
  args: string[],
  options: {
    category: string;
    maximumStdoutBytes: number;
    signal?: AbortSignal;
  }
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new TrainingContentVideoProcessingError("processing_cancelled", true, "Media processing was cancelled."));
      return;
    }
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const settleError = (error: TrainingContentVideoProcessingError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      child.kill("SIGKILL");
      settleError(new TrainingContentVideoProcessingError(
        "processing_cancelled",
        true,
        "Media processing was cancelled."
      ));
    };
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maximumStdoutBytes) {
        child.kill("SIGKILL");
        settleError(new TrainingContentVideoProcessingError(
          options.category,
          false,
          "Media inspection output exceeded its safety bound."
        ));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_PROCESS_ERROR_BYTES) {
        stderr.push(chunk.subarray(0, MAX_PROCESS_ERROR_BYTES - stderrBytes));
        stderrBytes += chunk.byteLength;
      }
    });
    child.once("error", () => {
      settleError(new TrainingContentVideoProcessingError(
        options.category,
        options.category.endsWith("_unavailable"),
        "The required media tool could not be started."
      ));
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(new TrainingContentVideoProcessingError(
          options.category,
          false,
          "The media tool rejected the uploaded video."
        ));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout).toString("utf8") });
    });
  });
}
