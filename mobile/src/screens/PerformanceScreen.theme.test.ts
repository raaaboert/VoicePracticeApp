import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getPerformanceTheme } from "./performanceTheme";

const screenDirectory = dirname(fileURLToPath(import.meta.url));
const performanceScreenSource = readFileSync(join(screenDirectory, "PerformanceScreen.tsx"), "utf8");
const appSource = readFileSync(join(screenDirectory, "..", "..", "App.tsx"), "utf8");

test("Performance goal detail resolves a light palette for soft_light", () => {
  const theme = getPerformanceTheme("soft_light");

  assert.equal(theme.background, "#f5f1e8");
  assert.equal(theme.text, "#1f2921");
  assert.equal(theme.card, "rgba(255, 255, 250, 0.98)");
  assert.notEqual(theme.background, "#101711");
});

test("Performance goal detail preserves the existing dark palette for classic_blue", () => {
  const theme = getPerformanceTheme("classic_blue");

  assert.equal(theme.background, "#101711");
  assert.equal(theme.text, "#f6f0df");
  assert.equal(theme.planCard, "rgba(15,24,18,0.92)");
  assert.equal(theme.input, "rgba(8,13,10,0.42)");
});

test("Performance screen derives goal-detail surfaces from its local palette", () => {
  assert.equal(performanceScreenSource.includes('backgroundColor: "#101711"'), false);
  assert.equal(performanceScreenSource.includes('placeholderTextColor="#7d877a"'), false);
  assert.doesNotMatch(performanceScreenSource, /#[0-9a-fA-F]{3,8}|rgba\(/);
  assert.match(performanceScreenSource, /const palette = useMemo\(\(\) => getPerformanceTheme\(colorScheme\)/);
  assert.match(performanceScreenSource, /backgroundColor: palette\.background/);
  assert.match(performanceScreenSource, /backgroundColor: palette\.card/);
  assert.match(performanceScreenSource, /color: palette\.text/);
  assert.match(appSource, /<PerformanceScreen\s+colorScheme=\{colorScheme\}/);
});
