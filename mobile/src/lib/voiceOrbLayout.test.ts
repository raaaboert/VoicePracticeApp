import {
  computeVoiceOrbLayout,
  type VoiceOrbLayoutMode,
} from "./voiceOrbLayout";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[voice-orb-layout.test] PASS ${name}`);
}

const MODES: VoiceOrbLayoutMode[] = ["idle", "recording", "thinking", "speaking"];

runTest("keeps the animated halo contained within the measured visual width", () => {
  for (const mode of MODES) {
    for (const availableWidth of [208, 224, 260, 300, 332, 356]) {
      const layout = computeVoiceOrbLayout({ availableWidth, mode });
      assert(
        layout.displayedHaloDiameter <= Math.max(208, Math.round(availableWidth)) - 12,
        `${mode} halo overflowed width ${availableWidth}`,
      );
    }
  }
});

runTest("gives the visual lane enough height to contain the halo with breathing room", () => {
  for (const mode of MODES) {
    const layout = computeVoiceOrbLayout({ availableWidth: 240, mode });
    assert(
      layout.stageVisualHeight >= layout.displayedHaloDiameter + 18,
      `${mode} stage height did not contain the halo`,
    );
  }
});

runTest("scales the halo and core down on tighter widths while preserving a strong center visual", () => {
  const compact = computeVoiceOrbLayout({ availableWidth: 220, mode: "speaking" });
  const roomy = computeVoiceOrbLayout({ availableWidth: 356, mode: "speaking" });

  assert(compact.haloDiameter < roomy.haloDiameter, "compact halo should be smaller than roomy halo");
  assert(compact.coreSize < roomy.coreSize, "compact core should be smaller than roomy core");
  assert(compact.haloDiameter >= 132, "compact halo should not collapse into a tiny fallback");
  assert(compact.coreSize >= 86, "compact core should stay visually substantial");
});
