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
  const createSource = performanceScreenSource.slice(scrollIndex, formIndex);
  assert.match(createSource, /keyboardShouldPersistTaps="handled"/);
  assert.match(
    createSource,
    /keyboardDismissMode=\{Platform\.OS === "ios" \? "interactive" : "none"\}/
  );
});

test("Performance goal detail uses one padding-based keyboard shell and one scroll owner", () => {
  const detailStart = performanceScreenSource.indexOf("function PlanDetailModal(");
  const detailEnd = performanceScreenSource.indexOf("function PerformanceCreateForm(", detailStart);
  const detailSource = performanceScreenSource.slice(detailStart, detailEnd);
  const contentStart = detailSource.indexOf("function PlanDetailModalContent(");
  const keyboardIndex = detailSource.indexOf('<KeyboardAvoidingView style={styles.modalScreen} behavior="padding">', contentStart);
  const headerIndex = detailSource.indexOf("<View style={styles.topRow}>", contentStart);
  const scrollIndex = detailSource.indexOf("<ScrollView", contentStart);
  const scrollEndIndex = detailSource.indexOf("</ScrollView>", scrollIndex);
  const inputIndex = detailSource.indexOf("styles.multilineInput", scrollIndex);
  const postButtonIndex = detailSource.indexOf('"Post Update"', inputIndex);
  const emptyUpdatesIndex = detailSource.indexOf("No updates yet.", postButtonIndex);

  assert.notEqual(detailStart, -1);
  assert.notEqual(detailEnd, -1);
  assert.notEqual(contentStart, -1);
  assert.equal(detailSource.includes('<SafeAreaProvider style={styles.fill}>'), true);
  assert.equal(detailSource.includes('presentationStyle="fullScreen"'), true);
  assert.equal(detailSource.includes("const insets = useSafeAreaInsets();"), true);
  assert.equal(detailSource.includes("paddingTop: insets.top"), true);
  assert.equal(detailSource.includes("paddingBottom: bottomInsetPadding"), true);
  assert.notEqual(keyboardIndex, -1);
  assert.equal(detailSource.includes('behavior={Platform.OS === "ios" ? "padding" : "height"}'), false);
  assert.equal(detailSource.includes('<View style={styles.modalScreen}>'), false);
  assert.equal(
    detailSource.includes('keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}'),
    true
  );
  assert.equal(detailSource.includes('keyboardShouldPersistTaps="handled"'), true);
  assert.ok(keyboardIndex < headerIndex);
  assert.ok(headerIndex < scrollIndex);
  assert.ok(scrollIndex < inputIndex);
  assert.ok(inputIndex < postButtonIndex);
  assert.ok(postButtonIndex < emptyUpdatesIndex);
  assert.ok(emptyUpdatesIndex < scrollEndIndex);
});
