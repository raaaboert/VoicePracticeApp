import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { getSimulationMessageWidthConstraints } from "../lib/simulationMessageLayout";
import { normalizeTranscriptText } from "../lib/transcriptText";

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

test("simulation bubbles give native text measurement an explicit viewport-derived width", () => {
  const bubble = styleBlock("messageBubble", "messageBubbleCompact");
  const messageText = styleBlock("messageText", "messageTextCompact");

  assert.match(bubble, /width: "92%"/);
  assert.doesNotMatch(bubble, /maxWidth/);
  assert.doesNotMatch(bubble, /minWidth|flexShrink/);
  assert.doesNotMatch(messageText, /minWidth|flexShrink|alignSelf/);
  assert.match(source, /setChatViewportWidth/);
  assert.match(source, /getSimulationMessageWidthConstraints/);
  assert.match(source, /\{ width: messageWidthConstraints\.bubbleMaxWidth \}/);
  assert.match(source, /\{ width: messageWidthConstraints\.textMaxWidth \}/);
  assert.match(source, /lineBreakStrategyIOS="standard"/);
});

const ast = ts.createSourceFile("SimulationScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const paletteStatement = ast.statements.find((statement) => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === "SIMULATION_PALETTES"));
const stylesFunction = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "createStyles");
assert.ok(paletteStatement); assert.ok(stylesFunction);
const styleCode = ts.transpileModule(`${paletteStatement.getText(ast)}\n${stylesFunction.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadStyles(platform: "ios" | "android") {
  return new Function("StyleSheet", "Platform", `${styleCode}; return { palettes: SIMULATION_PALETTES, createStyles };`)(
    { create: (styles: unknown) => styles }, { OS: platform },
  );
}
const { palettes } = loadStyles("ios");

let messageMap: ts.CallExpression | undefined;
function findMessageMap(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "messages.map"
    && node.getText(ast).includes("styles.messageBubble")) messageMap = node;
  ts.forEachChild(node, findMessageMap);
}
findMessageMap(ast);
assert.ok(messageMap);
const renderCode = ts.transpileModule(`const render = () => (${messageMap.getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const require = createRequire(import.meta.url);

// Execute the real message JSX and styles. Native line measurement is not simulated.
function renderMessages(params: { viewportWidth: number; compact: boolean; theme: "light" | "dark"; content: string; platform?: "ios" | "android" }) {
  const messages = Object.freeze([
    Object.freeze({ id: "user-turn", role: "user", content: params.content }),
    Object.freeze({ id: "ai-turn", role: "assistant", content: params.content }),
  ]);
  const constraints = getSimulationMessageWidthConstraints(params);
  const { createStyles } = loadStyles(params.platform ?? "ios");
  const render = new Function("require", "exports", "View", "Text", "messages", "styles", "useCompactTranscript",
    "messageWidthConstraints", "normalizeTranscriptText", "liveDiagnostics", `${renderCode}; return render;`)(
    require, {}, "View", "Text", messages, createStyles(palettes[params.theme]), params.compact, constraints, normalizeTranscriptText, { enabled: false },
  );
  return { bubbles: render(), messages, constraints };
}
function flatten(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};
}

test("YOU and AI receive definite inner widths across phone/tablet sizes, compact layouts and both themes", () => {
  const content = "Absolutely. If anything comes up between now and our next conversation, I will let you know. ".repeat(8);
  for (const viewportWidth of [280, 320, 390, 430, 768, 1024]) {
    for (const compact of [false, true]) for (const theme of ["light", "dark"] as const) {
      const { bubbles, constraints } = renderMessages({ viewportWidth, compact, theme, content });
      assert.ok(constraints);
      for (const [index, bubble] of bubbles.entries()) {
        const bubbleStyle = flatten(bubble.props.style);
        const [role, body] = bubble.props.children;
        const bodyStyle = flatten(body.props.style);
        assert.equal(body.props.onLayout, undefined, "disabled diagnostics add no native layout listener");
        assert.equal(body.props.onTextLayout, undefined, "disabled diagnostics add no text layout listener");
        assert.equal(body.props.ref, undefined, "disabled diagnostics attach no Text ref");
        assert.equal(bodyStyle.lineHeight, compact ? 19.001 : 21.001, "iOS live body receives the height safeguard");
        assert.equal(role.props.children, index === 0 ? "You" : "AI");
        assert.equal(bubbleStyle.alignSelf, index === 0 ? "flex-end" : "flex-start");
        assert.equal(bubbleStyle.width, constraints.bubbleMaxWidth);
        assert.equal(bodyStyle.width, constraints.textMaxWidth);
        assert.equal(bodyStyle.width + 2 * (bubbleStyle.paddingHorizontal + bubbleStyle.borderWidth), bubbleStyle.width);
        assert.ok(bubbleStyle.width <= (viewportWidth - (compact ? 26 : 32)) * 0.92);
        assert.equal(bubbleStyle.backgroundColor, index === 0 ? palettes[theme].userBubble : palettes[theme].aiBubble);
      }
    }
  }
});

test("actual transcript JSX selects iOS-only body line heights across roles, layouts and themes", () => {
  for (const platform of ["ios", "android"] as const) {
    for (const compact of [false, true]) for (const theme of ["light", "dark"] as const) {
      const { bubbles } = renderMessages({ platform, compact, theme, viewportWidth: 390, content: "First line.\nSecond line." });
      const expectedHeight = platform === "ios" ? (compact ? 19.001 : 21.001) : (compact ? 19 : 21);
      for (const bubble of bubbles) {
        const [role, body] = bubble.props.children;
        const bodyStyle = flatten(body.props.style);
        assert.equal(bodyStyle.lineHeight, expectedHeight);
        assert.equal(bodyStyle.fontSize, compact ? 13.5 : 14.5);
        assert.equal(flatten(role.props.style).lineHeight, undefined, "role labels receive no safeguard");
      }
    }
  }
});

test("both transcript roles preserve short, multiline, punctuated and long unbroken content without line limits", () => {
  for (const content of ["Yes.", "First line.\nSecond line.\nThird line.",
    "Absolutely. If anything comes up between now and then, I’ll ask: ‘What’s changed?’",
    "AReallyLongUnbrokenWord".repeat(30)]) {
    const { bubbles, messages } = renderMessages({ viewportWidth: 320, compact: true, theme: "light", content });
    assert.deepEqual(bubbles.map((bubble: any) => bubble.key), ["user-turn", "ai-turn"]);
    for (const bubble of bubbles) {
      const body = bubble.props.children[1];
      assert.equal(body.props.children, content);
      assert.equal(body.props.lineBreakStrategyIOS, "standard");
      for (const node of [bubble, body]) {
        assert.equal(node.props.numberOfLines, undefined);
        assert.equal(node.props.ellipsizeMode, undefined);
        assert.equal(node.props.allowFontScaling, undefined);
        assert.equal(node.props.maxFontSizeMultiplier, undefined);
        assert.equal(node.props.adjustsFontSizeToFit, undefined);
        for (const property of ["height", "maxHeight", "overflow"]) assert.equal(flatten(node.props.style)[property], undefined);
      }
    }
    assert.equal(messages[0].content, content);
    assert.equal(messages[1].content, content);
  }
});

test("first render is width-bounded before viewport measurement and updates to new viewport widths", () => {
  const before = renderMessages({ viewportWidth: 0, compact: false, theme: "dark", content: "Short" });
  assert.equal(before.constraints, null);
  for (const bubble of before.bubbles) assert.equal(flatten(bubble.props.style).width, "92%");
  const phone = renderMessages({ viewportWidth: 320, compact: true, theme: "dark", content: "Short" });
  const tablet = renderMessages({ viewportWidth: 768, compact: false, theme: "dark", content: "Short" });
  for (let index = 0; index < 2; index++) {
    assert.ok(flatten(tablet.bubbles[index].props.style).width > flatten(phone.bubbles[index].props.style).width);
  }
  assert.match(source, /\[chatViewportWidth, useCompactTranscript\]/);
});

test("user and AI bubbles retain their existing alignment and transcript normalization", () => {
  assert.match(styleBlock("userBubble", "aiBubble"), /alignSelf: "flex-end"/);
  assert.match(styleBlock("aiBubble", "messageRole"), /alignSelf: "flex-start"/);
  assert.match(source, /\{normalizeTranscriptText\(message\.content\)\}/);
});
