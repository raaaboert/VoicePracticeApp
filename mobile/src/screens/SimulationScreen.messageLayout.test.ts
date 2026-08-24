import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "SimulationScreen.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function styleBlock(start: string, end: string): string {
  const startIndex = source.indexOf(`${start}: {`);
  const endIndex = source.indexOf(`${end}: {`, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Could not locate ${start} style block.`);
  return source.slice(startIndex, endIndex);
}

test("simulation bubbles apply viewport-derived pixel constraints to the bubble and Text", () => {
  const bubble = styleBlock("messageBubble", "messageBubbleCompact");
  const messageText = styleBlock("messageText", "messageTextCompact");

  assert.match(bubble, /maxWidth: "92%"/);
  assert.doesNotMatch(bubble, /minWidth|flexShrink/);
  assert.doesNotMatch(messageText, /minWidth|flexShrink|alignSelf/);
  assert.match(source, /setChatViewportWidth/);
  assert.match(source, /getSimulationMessageWidthConstraints/);
  assert.match(source, /maxWidth: messageWidthConstraints\.bubbleMaxWidth/);
  assert.match(source, /maxWidth: messageWidthConstraints\.textMaxWidth/);
  assert.match(source, /lineBreakStrategyIOS="standard"/);
});

test("user and AI bubbles retain their existing alignment and transcript normalization", () => {
  assert.match(styleBlock("userBubble", "aiBubble"), /alignSelf: "flex-end"/);
  assert.match(styleBlock("aiBubble", "messageRole"), /alignSelf: "flex-start"/);
  assert.match(source, /\{normalizeTranscriptText\(message\.content\)\}/);
});
