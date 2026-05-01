export type VoiceOrbLayoutMode = "idle" | "recording" | "thinking" | "speaking";
export type VoiceOrbLayoutDensity = "regular" | "compact";

export interface VoiceOrbLayout {
  haloDiameter: number;
  displayedHaloDiameter: number;
  haloPeakScale: number;
  haloMaxOpacity: number;
  stageVisualHeight: number;
  connectorWidth: number;
  connectorInset: number;
  coreSize: number;
  coreBorderRadius: number;
  coreGridLength: number;
  outerRingSize: number;
  innerRingSize: number;
  dotSize: number;
  highlightSize: number;
  highlightTop: number;
  highlightRight: number;
  shadowRadius: number;
  shadowOffsetY: number;
}

const BASE_HALO_DIAMETERS: Record<VoiceOrbLayoutMode, number> = {
  idle: 152,
  recording: 152,
  thinking: 166,
  speaking: 184,
};

const HALO_PEAK_SCALES: Record<VoiceOrbLayoutMode, number> = {
  idle: 1.11,
  recording: 1.11,
  thinking: 1.14,
  speaking: 1.18,
};

const HALO_MAX_OPACITIES: Record<VoiceOrbLayoutMode, number> = {
  idle: 0.26,
  recording: 0.26,
  thinking: 0.3,
  speaking: 0.34,
};

const DENSITY_SCALE: Record<VoiceOrbLayoutDensity, number> = {
  regular: 1,
  compact: 0.82,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeVoiceOrbLayout(params: {
  availableWidth: number;
  mode: VoiceOrbLayoutMode;
  density?: VoiceOrbLayoutDensity;
}): VoiceOrbLayout {
  const availableWidth = Number.isFinite(params.availableWidth) ? params.availableWidth : 0;
  const density = params.density ?? "regular";
  const boundedWidth = clamp(Math.round(availableWidth), 208, 356);
  const baseHaloDiameter = BASE_HALO_DIAMETERS[params.mode];
  const haloPeakScale = HALO_PEAK_SCALES[params.mode];
  const haloMaxOpacity = HALO_MAX_OPACITIES[params.mode];
  const widthScale = clamp(boundedWidth / 320, 0.84, 1);
  const densityScale = DENSITY_SCALE[density];
  const idealHaloDiameter = Math.round(baseHaloDiameter * widthScale * densityScale);
  const laneInset = density === "compact" ? 8 : 12;
  const minHaloDiameter = density === "compact" ? 116 : 132;
  const maxHaloDiameter = density === "compact" ? Math.round(baseHaloDiameter * 0.88) : baseHaloDiameter;
  const maxContainedHaloDiameter = Math.floor((boundedWidth - laneInset) / haloPeakScale);
  const haloDiameter = clamp(Math.min(idealHaloDiameter, maxContainedHaloDiameter), minHaloDiameter, maxHaloDiameter);
  const displayedHaloDiameter = Math.round(haloDiameter * haloPeakScale);
  const coreSize = clamp(
    Math.round(haloDiameter * (density === "compact" ? 0.58 : 0.6)),
    density === "compact" ? 74 : 86,
    density === "compact" ? 92 : 104,
  );

  return {
    haloDiameter,
    displayedHaloDiameter,
    haloPeakScale,
    haloMaxOpacity,
    stageVisualHeight: Math.max(density === "compact" ? 102 : 132, displayedHaloDiameter + (density === "compact" ? 8 : 18)),
    connectorWidth: clamp(Math.round(boundedWidth * 0.24), 52, 84),
    connectorInset: boundedWidth < 250 ? 4 : boundedWidth < 300 ? 6 : 8,
    coreSize,
    coreBorderRadius: Math.round(coreSize * 0.292),
    coreGridLength: clamp(Math.round(coreSize * 0.46), 38, 46),
    outerRingSize: clamp(Math.round(coreSize * 0.604), 52, 64),
    innerRingSize: clamp(Math.round(coreSize * 0.375), 32, 40),
    dotSize: clamp(Math.round(coreSize * 0.167), 14, 18),
    highlightSize: clamp(Math.round(coreSize * 0.105), 8, 12),
    highlightTop: Math.round(coreSize * 0.24),
    highlightRight: Math.round(coreSize * 0.25),
    shadowRadius: clamp(Math.round(coreSize * 0.145), 12, 16),
    shadowOffsetY: clamp(Math.round(coreSize * 0.083), 7, 9),
  };
}
