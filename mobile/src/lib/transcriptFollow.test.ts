import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isTranscriptNearBottom,
  shouldFollowTranscriptAfterMessage,
} from "./transcriptFollow";

test("transcript follows new content only while the reader is near the bottom", () => {
  assert.equal(
    isTranscriptNearBottom({ contentHeight: 800, viewportHeight: 300, offsetY: 470 }),
    true,
  );
  assert.equal(
    isTranscriptNearBottom({ contentHeight: 800, viewportHeight: 300, offsetY: 300 }),
    false,
  );
  assert.equal(shouldFollowTranscriptAfterMessage(true), true);
  assert.equal(shouldFollowTranscriptAfterMessage(false), false);
});

test("simulation transcript uses content-size follow without a fixed-delay race", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../screens/SimulationScreen.tsx"),
    "utf8",
  );
  const transcriptRef = source.indexOf("ref={scrollRef}");
  const transcriptStart = source.lastIndexOf("<ScrollView", transcriptRef);
  const transcriptEnd = source.indexOf("</ScrollView>", transcriptStart);
  const transcriptSource = source.slice(transcriptStart, transcriptEnd);

  assert.match(transcriptSource, /onContentSizeChange=/);
  assert.match(transcriptSource, /onScrollBeginDrag=/);
  assert.match(transcriptSource, /onScroll=/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*scrollRef\.current\?\.scrollToEnd/);
});
