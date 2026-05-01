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
  assert.equal(layout.stackStatusPanels, false);
  assert.equal(layout.chatCardHeight, 311);
  assert.equal(layout.fallbackScrollDockPadding, 116);
});

test("narrow tall screens still switch to the compact stack", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 360,
    windowHeight: 800,
    bottomInset: 0,
  });

  assert.equal(layout.compactVerticalLayout, true);
  assert.equal(layout.tightVerticalLayout, true);
  assert.equal(layout.stackStatusPanels, true);
  assert.equal(layout.chatCardHeight, 252);
  assert.equal(layout.fallbackScrollDockPadding, 132);
});

test("short screens honor bottom insets in the sticky dock padding", () => {
  const layout = getSimulationScreenLayout({
    windowWidth: 393,
    windowHeight: 740,
    bottomInset: 20,
  });

  assert.equal(layout.compactVerticalLayout, true);
  assert.equal(layout.tightVerticalLayout, false);
  assert.equal(layout.actionDockBottomPadding, 26);
  assert.equal(layout.actionDockHorizontalPadding, 14);
});
