// Local, in-memory diagnostics only. Never accept or retain learner transcript bodies here.
export const STAGING_TRANSCRIPT_API = "https://voicepractice-api-dev.onrender.com";
export const SHORTFALL_EPSILON = 0.0000001;
export const MAX_SWEEP_PROBES = 64;
export const MAX_DIAGNOSTIC_RESULTS = 64;
export type DiagnosticMode = "baseline" | "comparison";
export type Frame = { x: number; y: number; width: number; height: number };
export type ProbeMeasurement = { configuration: string; position?: number; frame?: Frame; windowY?: number; logicalY?: number; measuredHeight?: number; lines?: number; bubbleY?: number };

export function transcriptDiagnosticsAllowed(buildApi: string | undefined, resolvedApi: string): boolean {
  const normalize = (value: string | undefined) => value?.trim().replace(/\/+$/, "");
  return normalize(buildApi) === STAGING_TRANSCRIPT_API && normalize(resolvedApi) === STAGING_TRANSCRIPT_API;
}

export function diagnosticLineHeight(compact: boolean, mode: DiagnosticMode): number {
  return (compact ? 19 : 21) + (mode === "comparison" ? 0.001 : 0);
}

export function compareTranscriptFrames(actual?: ProbeMeasurement, reference?: ProbeMeasurement): {
  status: "SHORT" | "FITS" | "INCONCLUSIVE"; shortfall: number | null; reason: string;
} {
  const a = actual?.frame, r = reference?.frame;
  if (!actual?.configuration || actual.configuration !== reference?.configuration) {
    return { status: "INCONCLUSIVE", shortfall: null, reason: "Missing or stale reference configuration" };
  }
  if (!a || !r || ![a.width, a.height, r.width, r.height].every(Number.isFinite)
    || Math.min(a.width, a.height, r.width, r.height) <= 0) {
    return { status: "INCONCLUSIVE", shortfall: null, reason: "Waiting for valid native frames" };
  }
  if (Math.abs(a.width - r.width) > 0.0001) {
    return { status: "INCONCLUSIVE", shortfall: null, reason: "Reference width differs" };
  }
  if (!Number.isFinite(reference?.windowY) || reference!.windowY! < 0 || reference!.windowY! + r.height >= 512
    || !reference?.lines || reference.lines < 1) {
    return { status: "INCONCLUSIVE", shortfall: null, reason: "Reference is not confirmed near origin" };
  }
  const shortfall = r.height - a.height;
  return { status: shortfall > SHORTFALL_EPSILON ? "SHORT" : "FITS", shortfall,
    reason: "Frame comparison only; inspect native drawing" };
}

// A timeout advances an inconclusive probe too: no waiting indefinitely for native events.
export function nextTranscriptSweepStep(current: number, total: number): number | null {
  const next = current + 1;
  return next < Math.min(total, MAX_SWEEP_PROBES) ? next : null;
}

export function formatDiagnosticNumber(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(9) : "pending";
}

// Calibrate against the measured second (long YOU) bubble. Both modes reuse this exact plan.
export function makeTranscriptSweep(anchorOrigin: number, referenceHeight: number): number[] {
  if (![anchorOrigin, referenceHeight].every(Number.isFinite) || referenceHeight <= 0) return [];
  const positions: number[] = [];
  for (const boundary of [512, 1024, 2048, 4096]) {
    for (let third = -3; third <= 3; third++) {
      const position = boundary - referenceHeight / 2 - anchorOrigin + third / 3;
      if (position >= 0 && position <= 4600) positions.push(position);
    }
  }
  return positions.slice(0, MAX_SWEEP_PROBES / 2);
}

export const TRANSCRIPT_PROBES = Object.freeze([
  { id: "short-you", role: "user", content: "Yes, let’s agree on the next step." },
  { id: "long-you", role: "user", content: "Absolutely. If anything comes up between now and our next conversation, I will let you know. We can review the options together and agree on a clear next step." },
  { id: "long-ai", role: "assistant", content: "I will send the missed update and explain what is holding it up, rather than letting frustration build. I’m still skeptical, but willing to see how this follow-up goes." },
  { id: "short-ai", role: "assistant", content: "What would you do next?" },
  { id: "multiline-you", role: "user", content: "First synthetic line.\nSecond synthetic line.\nThird synthetic line." },
  { id: "long-word-ai", role: "assistant", content: "A synthetic long token: " + "ConversationPractice".repeat(10) },
] as const);
