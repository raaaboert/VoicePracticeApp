import type { VoiceOrbLayoutMode } from "./voiceOrbLayout";

export type VoiceOrbStageKey = "capture" | "process" | "deliver";
export type VoiceOrbStageState = "standby" | "ready" | "complete" | "active";

export interface VoiceOrbStage {
  key: VoiceOrbStageKey;
  label: string;
  state: VoiceOrbStageState;
  status: string;
}

const VOICE_ORB_STAGES: Record<VoiceOrbStageKey, { key: VoiceOrbStageKey; label: string }> = {
  capture: { key: "capture", label: "Capture" },
  process: { key: "process", label: "Process" },
  deliver: { key: "deliver", label: "Deliver" },
};

function buildStage(
  key: VoiceOrbStageKey,
  state: VoiceOrbStageState,
  status: string,
): VoiceOrbStage {
  return {
    ...VOICE_ORB_STAGES[key],
    state,
    status,
  };
}

export function getVoiceOrbStages(mode: VoiceOrbLayoutMode): VoiceOrbStage[] {
  if (mode === "recording") {
    return [
      buildStage("capture", "active", "Active"),
      buildStage("process", "standby", "Standby"),
      buildStage("deliver", "standby", "Standby"),
    ];
  }

  if (mode === "thinking") {
    return [
      buildStage("capture", "complete", "Complete"),
      buildStage("process", "active", "Active"),
      buildStage("deliver", "standby", "Standby"),
    ];
  }

  if (mode === "speaking") {
    return [
      buildStage("capture", "complete", "Complete"),
      buildStage("process", "complete", "Complete"),
      buildStage("deliver", "active", "Active"),
    ];
  }

  return [
    buildStage("capture", "ready", "Ready"),
    buildStage("process", "standby", "Standby"),
    buildStage("deliver", "standby", "Standby"),
  ];
}
