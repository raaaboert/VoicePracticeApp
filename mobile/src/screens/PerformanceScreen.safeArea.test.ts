import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const performanceScreenSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "PerformanceScreen.tsx"),
  "utf8"
);

test("Performance create goal modal has its own dynamic safe-area shell", () => {
  assert.equal(performanceScreenSource.includes("<SafeAreaProvider style={styles.fill}>"), true);
  assert.equal(performanceScreenSource.includes("const insets = useSafeAreaInsets();"), true);
  assert.equal(performanceScreenSource.includes('presentationStyle="fullScreen"'), true);
  assert.equal(performanceScreenSource.includes("paddingTop: insets.top"), true);
  assert.equal(performanceScreenSource.includes("paddingBottom: bottomInsetPadding"), true);
  assert.equal(performanceScreenSource.includes("onRequestClose={onClose}"), true);
});

test("Performance create goal header is fixed outside the form ScrollView", () => {
  const headerIndex = performanceScreenSource.indexOf("<View style={styles.createModalHeader}>");
  const scrollIndex = performanceScreenSource.indexOf("<ScrollView", headerIndex);
  const formIndex = performanceScreenSource.indexOf("<PerformanceCreateForm", scrollIndex);

  assert.notEqual(headerIndex, -1);
  assert.notEqual(scrollIndex, -1);
  assert.notEqual(formIndex, -1);
  assert.ok(headerIndex < scrollIndex);
  assert.ok(scrollIndex < formIndex);
  assert.equal(performanceScreenSource.includes("styles.createModalCancelButton"), true);
});
