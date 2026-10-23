import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildScorecardViewModel } from "../lib/scorecardViewModel";
import type { SimulationScorecard } from "../types";

const source = readFileSync(new URL("./ScorecardView.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const themeStatement = ast.statements.filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((declaration) => declaration.name.getText(ast) === "APP_THEME_TOKENS")!;
const palettes = new Function(`return (${themeStatement.initializer!.getText(ast)});`)();

// Render the actual component with only React hooks and native primitives substituted.
// These checks inspect presentation and callbacks, not native text measurement or scrolling.
function harness(overrides: Record<string, any> = {}) {
  let cursor = 0;
  const slots: any[] = [];
  const props = {
    theme: palettes.soft_light,
    title: "A long scenario title that must wrap without hiding the learner's feedback",
    segmentLabel: "Sales", difficulty: "medium", personaStyle: "skeptical",
    scorecard: fixture(), scoringStatus: "scored", error: null,
    transcriptAvailable: true, onDownloadTranscript: async () => {},
    onSubmitSupport: async () => ({ caseId: "test", transcriptRetainedUntil: null }),
    onBack: () => {}, onBackToTopic: undefined,
    ...overrides,
  };
  const native = Object.fromEntries([
    "ActivityIndicator", "KeyboardAvoidingView", "Modal", "Pressable", "ScrollView", "Text", "TextInput", "View",
  ].map((name) => [name, name]));
  const exported: any = {};
  const require = createRequire(import.meta.url);
  const code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)((name: string) => {
    if (name === "react") return {
      useMemo: (factory: () => any) => factory(),
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
    };
    if (name === "react-native") return { ...native, Platform: { OS: "ios" }, StyleSheet: { create: (styles: any) => styles } };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "../data/prompts") return { DIFFICULTY_LABELS: { medium: "Medium" }, PERSONA_LABELS: { skeptical: "Skeptical" } };
    if (name === "../lib/scorecardViewModel") return { buildScorecardViewModel };
    return require(name);
  }, exported);
  return { props, render() { cursor = 0; return exported.ScorecardView(props); } };
}

function fixture(): SimulationScorecard {
  return { overallScore: 84.5, communicationScore: 91.3, outcomeScore: 72.8,
    completionLevel: "partial", objectiveAchieved: false,
    persuasion: 7.2, clarity: 8, empathy: 9.1, assertiveness: 6,
    strengths: ["Explain the benefit clearly.", "A second strength."],
    improvements: ["Ask a focused follow-up.\nThen confirm the next step."],
    summary: "A complete coaching summary that stays available at the end of a long scorecard." };
}

function nodes(tree: any, matches: (node: any) => boolean): any[] {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, matches));
  if (!tree || typeof tree !== "object") return [];
  return [...(matches(tree) ? [tree] : []), ...nodes(tree.props?.children, matches)];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
function flatten(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};
}
function textNode(tree: any, value: string) {
  const matches = nodes(tree, (node) => node.type === "Text" && text(node) === value);
  assert.equal(matches.length, 1, value);
  return matches[0];
}
function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map((pair) => parseInt(pair, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("Scorecard title follows the selected app theme and has readable contrast on both gradient endpoints", () => {
  const h = harness();
  for (const theme of Object.values(palettes) as any[]) {
    h.props.theme = theme;
    const tree = h.render();
    const heading = textNode(tree, "Scorecard");
    assert.equal(heading.props.accessibilityRole, "header");
    assert.equal(flatten(heading.props.style).color, theme.text);
    assert.ok(contrast(theme.text, theme.bgTop) >= 4.5);
    assert.ok(contrast(theme.text, theme.bgBottom) >= 4.5);
    assert.equal(flatten(textNode(tree, h.props.title).props.style).color, theme.text);
    const overall = nodes(tree, (node) => node.type === "View" && flatten(node.props.style).backgroundColor === theme.selectedCardBg)[0];
    assert.ok(overall);
    assert.equal(flatten(textNode(tree, "Back to Scenarios").props.style).color, theme.primaryButtonText);
  }
  assert.match(app, /<ScorecardView\s+theme=\{theme\}/);
  assert.doesNotMatch(source, /const COLORS|#[0-9a-fA-F]{3,8}|rgba\(/);
});

test("overall and component scores retain precision and are separate from completion and objective status", () => {
  const scorecard = Object.freeze(fixture());
  const h = harness({ scorecard });
  let tree = h.render();
  assert.ok(flatten(textNode(tree, "84.5").props.style).fontSize > flatten(textNode(tree, "91.3 / 100").props.style).fontSize);
  for (const [label, value] of [["Communication", 91.3], ["Outcome", 72.8]]) {
    assert.equal(nodes(tree, (node) => node.props?.accessibilityLabel === `${label} score: ${value} out of 100`).length, 1);
  }
  assert.ok(text(tree).includes("CompletionPartial"));
  assert.ok(text(tree).includes("Objective achievedNo"));
  for (const completionLevel of ["complete", "partial", "inconclusive"] as const) {
    h.props.scorecard = { ...scorecard, completionLevel, objectiveAchieved: true };
    tree = h.render();
    assert.ok(text(tree).includes(`Completion${{ complete: "Complete", partial: "Partial", inconclusive: "Inconclusive" }[completionLevel]}`));
    assert.ok(text(tree).includes("Objective achievedYes"));
  }
  assert.equal(scorecard.overallScore, 84.5);
  assert.equal(scorecard.objectiveAchieved, false);
});

test("Skill Breakdown preserves all four supplied ratings in compact noninteractive wrapping rows", () => {
  const h = harness();
  const tree = h.render();
  assert.ok(text(tree).includes("Skill Breakdown"));
  assert.ok(text(tree).includes("See how you performed across key communication skills. Ratings are out of 10."));
  assert.doesNotMatch(text(tree), /legacy|compatibility|rubric weights/i);
  const rows = nodes(tree, (node) => node.type === "View" && flatten(node.props.style).paddingVertical === 6);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(text), ["Persuasion7.2/10", "Clarity8/10", "Empathy9.1/10", "Assertiveness6/10"]);
  for (const row of rows) {
    assert.equal(flatten(row.props.style).height, undefined);
    assert.equal(flatten(row.props.style).flexWrap, "wrap");
  }
});

test("long feedback stays untruncated inside the main scroll area and the footer occupies its own layout space", () => {
  const h = harness({ onBackToTopic: () => {} });
  const tree = h.render();
  const children = tree.props.children;
  const scroll = children.find((child: any) => child?.type === "ScrollView");
  const footer = children[children.indexOf(scroll) + 1];
  assert.equal(flatten(scroll.props.style).flex, 1);
  assert.equal(flatten(scroll.props.style).minHeight, 0);
  assert.ok(flatten(scroll.props.contentContainerStyle).paddingBottom >= 14);
  assert.equal(flatten(footer.props.style).flexShrink, 0);
  assert.notEqual(flatten(footer.props.style).position, "absolute");
  assert.ok(text(footer).includes("Back to Topic"));
  assert.ok(text(footer).includes("Practice Again"));
  for (const copy of [...h.props.scorecard.strengths, ...h.props.scorecard.improvements, h.props.scorecard.summary]) {
    const node = textNode(scroll, copy.includes("summary") ? copy : `\u2022 ${copy}`);
    assert.equal(node.props.numberOfLines, undefined);
    assert.equal(node.props.allowFontScaling, undefined);
    assert.equal(node.props.maxFontSizeMultiplier, undefined);
    assert.equal(flatten(node.props.style).height, undefined);
  }
  const wrappingGroups = nodes(scroll, (node) => node.type === "View" && flatten(node.props.style).alignSelf === "stretch");
  assert.equal(wrappingGroups.length, 2);
  for (const group of wrappingGroups) assert.equal(flatten(group.props.style).flexWrap, "wrap");
  const safeArea = app.slice(app.lastIndexOf("<GestureHandlerRootView"));
  assert.match(safeArea, /<SafeAreaView style=\{styles.safeArea\}>\{renderContent\(\)\}<\/SafeAreaView>/);
});

test("loading, failed and insufficient-evidence states never invent scores or expose Skill Breakdown", () => {
  for (const scoringStatus of ["scoring_in_progress", "score_unavailable", "not_scored"]) {
    const h = harness({ scoringStatus, scorecard: null });
    const tree = h.render();
    assert.ok(!text(tree).includes("Skill Breakdown"));
    assert.ok(!text(tree).includes("Overall Score"));
    assert.equal(nodes(tree, (node) => node.type === "Pressable" && text(node) === "Back to Scenarios").length,
      scoringStatus === "scoring_in_progress" ? 0 : 1);
    if (scoringStatus === "scoring_in_progress") assert.equal(nodes(tree, (node) => node.props?.accessibilityState?.busy).length, 1);
  }
});

test("footer navigation remains accessible and preserves Topic return and Practice Again callbacks", () => {
  const calls: string[] = [];
  const h = harness({ onBackToTopic: () => calls.push("topic"), onBack: () => calls.push("practice") });
  const tree = h.render();
  for (const label of ["Back to Topic", "Practice Again"]) {
    const button = nodes(tree, (node) => node.type === "Pressable" && text(node) === label)[0];
    assert.equal(button.props.accessibilityRole, "button");
    assert.ok(flatten(button.props.style).minHeight >= 44);
    button.props.onPress();
  }
  assert.deepEqual(calls, ["topic", "practice"]);
});
