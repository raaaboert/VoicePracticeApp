import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scorecardViewSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ScorecardView.tsx"),
  "utf8"
);

test("Feedback / Support modal lets Android resize while preserving iOS keyboard avoidance", () => {
  const modalIndex = scorecardViewSource.indexOf("<Modal transparent visible={supportOpen}");
  const keyboardIndex = scorecardViewSource.indexOf("<KeyboardAvoidingView", modalIndex);
  const safeAreaIndex = scorecardViewSource.indexOf("<SafeAreaView style={styles.modalRoot}", keyboardIndex);
  const cardIndex = scorecardViewSource.indexOf("styles.modalCard", safeAreaIndex);

  assert.notEqual(modalIndex, -1);
  assert.notEqual(keyboardIndex, -1);
  assert.notEqual(safeAreaIndex, -1);
  assert.notEqual(cardIndex, -1);
  assert.ok(modalIndex < keyboardIndex);
  assert.ok(keyboardIndex < safeAreaIndex);
  assert.ok(safeAreaIndex < cardIndex);
  assert.equal(scorecardViewSource.includes('behavior={Platform.OS === "ios" ? "padding" : undefined}'), true);
  assert.equal(scorecardViewSource.includes('behavior={Platform.OS === "ios" ? "padding" : "height"}'), false);
  assert.equal(scorecardViewSource.includes('{ maxHeight: supportModalMaxHeight }'), true);
  assert.equal(scorecardViewSource.includes('pointerEvents="box-none"'), true);
});

test("Feedback / Support modal has a stable bounded flex layout before input focus", () => {
  const modalRootStyle = scorecardViewSource.slice(
    scorecardViewSource.indexOf("modalRoot: {"),
    scorecardViewSource.indexOf("modalBackdrop: {"),
  );
  const modalCardStyle = scorecardViewSource.slice(
    scorecardViewSource.indexOf("modalCard: {"),
    scorecardViewSource.indexOf("modalHeaderRow: {"),
  );
  const modalBodyScrollStyle = scorecardViewSource.slice(
    scorecardViewSource.indexOf("modalBodyScroll: {"),
    scorecardViewSource.indexOf("modalBodyContent: {"),
  );

  assert.equal(modalRootStyle.includes('justifyContent: "center"'), true);
  assert.equal(modalCardStyle.includes("flex: 1"), true);
  assert.equal(modalBodyScrollStyle.includes("flex: 1"), true);
  assert.equal(modalBodyScrollStyle.includes("flexShrink"), false);
  assert.equal(scorecardViewSource.includes("{ maxHeight: supportModalMaxHeight }"), true);
});

test("Feedback / Support header remains fixed outside the scrolling body", () => {
  const headerIndex = scorecardViewSource.indexOf("<View style={styles.modalHeaderRow}>");
  const titleIndex = scorecardViewSource.indexOf("Feedback / Support", headerIndex);
  const closeIndex = scorecardViewSource.indexOf("styles.modalCloseButton", titleIndex);
  const scrollIndex = scorecardViewSource.indexOf("<ScrollView", closeIndex);
  const bodyIndex = scorecardViewSource.indexOf("Describe what went wrong", scrollIndex);
  const submitIndex = scorecardViewSource.indexOf("<Text style={styles.buttonText}>{supportBusy ? \"Submitting...\" : \"Submit\"}</Text>", scrollIndex);

  assert.notEqual(headerIndex, -1);
  assert.notEqual(titleIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(scrollIndex, -1);
  assert.notEqual(bodyIndex, -1);
  assert.notEqual(submitIndex, -1);
  assert.ok(headerIndex < scrollIndex);
  assert.ok(scrollIndex < bodyIndex);
  assert.ok(scrollIndex < submitIndex);
});

test("Feedback / Support scroll view keeps checkbox and submit tappable with keyboard open", () => {
  assert.equal(
    scorecardViewSource.includes("keyboardShouldPersistTaps={SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS}"),
    true
  );
  assert.equal(
    scorecardViewSource.includes("keyboardDismissMode={getSupportModalKeyboardDismissMode(Platform.OS)}"),
    true
  );
  assert.equal(scorecardViewSource.includes("style={styles.modalBodyScroll}"), true);
  assert.equal(scorecardViewSource.includes("contentContainerStyle={styles.modalBodyContent}"), true);
});

test("Feedback / Support submission and consent wiring remain unchanged", () => {
  const submitCallIndex = scorecardViewSource.indexOf("const result = await onSubmitSupport({");
  const messageIndex = scorecardViewSource.indexOf("message: supportMessage", submitCallIndex);
  const consentIndex = scorecardViewSource.indexOf("includeTranscript: supportConsent", submitCallIndex);

  assert.notEqual(submitCallIndex, -1);
  assert.notEqual(messageIndex, -1);
  assert.notEqual(consentIndex, -1);
  assert.ok(submitCallIndex < messageIndex);
  assert.ok(messageIndex < consentIndex);
  assert.equal(scorecardViewSource.includes("setSupportConsent((prev) => !prev)"), true);
  assert.equal(scorecardViewSource.includes("retained up to 10 days"), true);
});
