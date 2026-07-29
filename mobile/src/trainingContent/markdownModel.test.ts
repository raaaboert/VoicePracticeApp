import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeTrainingContentLink } from "./externalUrlPolicy";
import { parseSafeMarkdown } from "./markdownModel";

test("native Markdown parser supports constrained presentation blocks", () => {
  const blocks = parseSafeMarkdown(
    "# Heading\n\nA **bold** and *useful* paragraph.\n\n- First\n- Second\n\n1. One\n2. Two"
  );
  assert.deepEqual(blocks.map((block) => block.type), [
    "heading",
    "paragraph",
    "list",
    "list",
  ]);
  assert.equal(blocks[2]?.type === "list" && blocks[2].ordered, false);
  assert.equal(blocks[3]?.type === "list" && blocks[3].ordered, true);
});

test("native Markdown never executes HTML or external images", () => {
  const blocks = parseSafeMarkdown(
    "<script>alert('no')</script>\n\n![remote](https://tracking.example/image.png)"
  );
  assert.equal(JSON.stringify(blocks).includes("<script>"), true);
  assert.equal(JSON.stringify(blocks).includes("tracking.example"), false);
  assert.equal(JSON.stringify(blocks).includes('"type":"link"'), false);
});

test("Markdown and resource URLs reject executable and credentialed protocols", () => {
  assert.equal(sanitizeTrainingContentLink("https://example.com/resource"), "https://example.com/resource");
  assert.equal(sanitizeTrainingContentLink("mailto:help@example.com", { allowMailto: true }), "mailto:help@example.com");
  assert.equal(sanitizeTrainingContentLink("javascript:alert(1)"), null);
  assert.equal(sanitizeTrainingContentLink("data:text/html,hello"), null);
  assert.equal(sanitizeTrainingContentLink("file:///private/file"), null);
  assert.equal(sanitizeTrainingContentLink("https://user:pass@example.com/private"), null);
});
