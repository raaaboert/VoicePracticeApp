import assert from "node:assert/strict";
import test from "node:test";

import { getSimulationScreenLayout } from "./simulationScreenLayout";

test("standard layout stays roomy on larger screens", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 412,
    windowHeight: 915,
    bottomInset: 0,
  });

  assert.equal(layout.compactVerticalLayout, false);
  assert.equal(layout.tightVerticalLayout, false);
  assert.equal(layout.useCompactScenarioCard, false);
  assert.equal(layout.useCompactEngineStatus, false);
  assert.equal(layout.useCompactTimerSummary, false);
  assert.equal(layout.showResponseModeCard, true);
  assert.equal(layout.showScenarioDescription, true);
  assert.equal(layout.showExtendedScenarioMeta, true);
  assert.equal(layout.useCompactTranscript, false);
  assert.equal(layout.chatCardHeight, 320);
  assert.equal(layout.fallbackScrollDockPadding, 160);
});

test("narrow tall screens still switch to the compact stack", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 360,
    windowHeight: 800,
    bottomInset: 0,
  });

  assert.equal(layout.compactVerticalLayout, true);
  assert.equal(layout.tightVerticalLayout, false);
  assert.equal(layout.useCompactScenarioCard, true);
  assert.equal(layout.useCompactEngineStatus, true);
  assert.equal(layout.useCompactTimerSummary, true);
  assert.equal(layout.showResponseModeCard, false);
  assert.equal(layout.showScenarioDescription, false);
  assert.equal(layout.showExtendedScenarioMeta, false);
  assert.equal(layout.useCompactTranscript, true);
  assert.equal(layout.chatCardHeight, 356);
  assert.equal(layout.actionDockBottomPadding, 4);
  assert.equal(layout.fallbackScrollDockPadding, 136);
});

test("short screens honor bottom insets in the sticky dock padding", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 360,
    windowHeight: 700,
    bottomInset: 20,
  });

  assert.equal(layout.compactVerticalLayout, true);
  assert.equal(layout.tightVerticalLayout, true);
  assert.equal(layout.showResponseModeCard, false);
  assert.equal(layout.actionDockBottomPadding, 24);
  assert.equal(layout.actionDockHorizontalPadding, 14);
  assert.equal(layout.chatCardHeight, 321);
});

test("larger compact-adjacent screens do not switch too aggressively", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 393,
    windowHeight: 780,
    bottomInset: 0,
  });

  assert.equal(layout.compactVerticalLayout, false);
  assert.equal(layout.tightVerticalLayout, false);
  assert.equal(layout.useCompactEnginePresentation, false);
  assert.equal(layout.showResponseModeCard, true);
});

test("very narrow screens still stay in compact mode with transcript priority", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 332,
    windowHeight: 760,
    bottomInset: 0,
  });

  assert.equal(layout.compactVerticalLayout, true);
  assert.equal(layout.showResponseModeCard, false);
  assert(layout.chatCardHeight >= 340);
});

test("dock compensation keeps a safety gap above the measured dock height", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 360,
    windowHeight: 800,
    bottomInset: 0,
  });

  const measuredDockHeight = 112;
  assert.equal(layout.scrollDockSafetyGap, 24);
  assert(layout.fallbackScrollDockPadding >= measuredDockHeight + layout.scrollDockSafetyGap);
});
