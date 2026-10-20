import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { homeFocusTopicPreview, createFocusTopicCatalogController } from "./catalog";
import { buildScenarioSetupSelection, simulationTopicReturnOrigin } from "../trainingContent/scenarioSetupNavigation";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

// Execute the actual component and App callbacks with only native rendering and setters substituted.
function execute(source: string, name: string, context: Record<string, any>) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast).replace(/^export /, "");
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const init = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useCallback"
        ? node.initializer.arguments[0]! : node.initializer;
      expression = `const ${name} = ${init.getText(ast)};`;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, name);
  const js = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(context), `${js}; return ${name};`)(...Object.values(context));
}

function jsxCallback(tag: string, attribute: string, context: Record<string, any>) {
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === tag) {
      const prop = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(ast) === attribute);
      if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
        expression = `const handler = ${prop.initializer.expression!.getText(ast)};`;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, `${tag}.${attribute}`);
  const js = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${js}; return handler;`)(...Object.values(context));
}

type Element = { type: string; props: Record<string, any> };
const react = { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }) };
function elements(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !tree.props) return [];
  return [tree, ...elements(tree.props.children)];
}
const previewSource = readFileSync(new URL("./HomeFocusTopicPreview.tsx", import.meta.url), "utf8");
const renderPreview = execute(previewSource, "HomeFocusTopicPreview", {
  React: react, View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator",
  FocusTopicCard: "FocusTopicCard", homeFocusTopicPreview, styles: {},
});
const topics = Array.from({ length: 5 }, (_, i) => ({ id: `topic_${i}`, name: `Topic ${i}`, description: "Details",
  createdAt: "2026-01-01T00:00:00.000Z", scenarioCount: i, resourceCount: 5 - i }));

test("Home renders four existing Topic cards, card selection and View All use the actual callbacks", () => {
  const events: string[] = [];
  const tree = elements(renderPreview({ state: { topics, loading: false, error: null }, theme: {},
    onOpenTopic: (id: string) => events.push(id), onViewAll: () => events.push("all") }));
  const cards = tree.filter((node) => node.type === "FocusTopicCard");
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((node) => node.props.topic), topics.slice(0, 4));
  cards[2]!.props.onOpen();
  tree.find((node) => node.props.accessibilityLabel === "View all Focus Topics")!.props.onPress();
  assert.deepEqual(events, ["topic_2", "all"]);
});

test("Home renders distinct loading, failure/Retry and empty states without stale cards", () => {
  let retries = 0;
  for (const state of [{ topics, loading: true, error: null },
    { topics: null, loading: false, error: "Unable to load" }, { topics: [], loading: false, error: null }]) {
    const tree = elements(renderPreview({ state, theme: {}, onRetry: () => retries++ }));
    assert.equal(tree.filter((node) => node.type === "FocusTopicCard").length, 0);
    if (state.loading) assert.ok(tree.some((node) => node.props.accessibilityRole === "progressbar"));
    else if (state.error) tree.find((node) => node.props.accessibilityLabel === "Retry Focus Topics")!.props.onPress();
    else assert.match(JSON.stringify(tree), /No Focus Topics are currently assigned/);
  }
  assert.equal(retries, 1);
});

const scenario = { id: "scenario", title: "Practice", source: "custom" as const,
  trainingId: "topic", industryId: "sales", segmentId: "sales_representative" };
const selected = buildScenarioSetupSelection(scenario);
const applied = { scenarioCatalogTab: "custom" as const, trainingId: "topic", industryId: "sales",
  roleId: "sales_representative", scenarioId: "scenario" };

test("Topic-origin navigation is captured only for the selected practice, never unrelated or resource origins", () => {
  const origin = { type: "focus_topic" as const, topicId: "topic" };
  assert.deepEqual(simulationTopicReturnOrigin(origin, selected, applied), origin);
  assert.equal(simulationTopicReturnOrigin(origin, selected, { ...applied, scenarioId: "unrelated" }), null);
  assert.equal(simulationTopicReturnOrigin(origin, selected, { ...applied, trainingId: "other" }), null);
  assert.equal(simulationTopicReturnOrigin(null, selected, applied), null);
  assert.equal(simulationTopicReturnOrigin({ type: "learning_resource", contentId: "content" }, selected, applied), null);
  const standard = { ...scenario, source: "standard" as const, trainingId: null };
  assert.deepEqual(simulationTopicReturnOrigin(origin, buildScenarioSetupSelection(standard), {
    ...applied, scenarioCatalogTab: "standard", trainingId: null,
  }), origin);
});

test("actual Home navigation opens a Topic directly or the full catalog and clears old origins", () => {
  const events: Record<string, any> = {};
  const open = execute(app, "openHomeFocusTopics", Object.fromEntries([
    "setHomeFocusTopicId", "setTopicReturnNotice", "setSetupOrigin", "setSetupSelectionIntent", "setSetupSelectionFailure", "setNotificationTarget", "setScreen",
  ].map((name) => [name, (value: unknown) => { events[name] = value; }])));
  open("topic"); assert.equal(events.setHomeFocusTopicId, "topic"); assert.equal(events.setScreen, "focus_topics");
  assert.equal(events.setSetupOrigin, null); assert.equal(events.setNotificationTarget, null);
  open(); assert.equal(events.setHomeFocusTopicId, null);
});

test("actual simulation exit returns Topic-origin sessions directly and preserves other origins", () => {
  for (const topicOrigin of [true, false]) {
    const events: string[] = [];
    const onExit = jsxCallback("SimulationScreen", "onExit", {
      setSimulationConfig: () => events.push("clear simulation"), setRelatedTrainingContentItems: () => {},
      setSetupError: () => {}, simulationReturnOrigin: topicOrigin ? { type: "focus_topic", topicId: "topic" } : null,
      returnToSimulationTopic: (message: string) => { assert.equal(message, "Exit notice"); events.push("topic"); },
      setScreen: (screen: string) => events.push(screen),
    });
    onExit("Exit notice");
    assert.deepEqual(events, ["clear simulation", topicOrigin ? "topic" : "setup"]);
  }
});

test("actual scorecard return reaches the original Topic; Practice Again keeps existing Setup", () => {
  const events: Record<string, any> = {};
  const context = { simulationReturnOrigin: { type: "focus_topic", topicId: "original" },
    ...Object.fromEntries(["setTopicReturnNotice", "setSetupOrigin", "setSetupSelectionIntent", "setSetupSelectionFailure",
      "setNotificationTarget", "setLastTranscript", "setScreen"].map((name) => [name, (value: unknown) => { events[name] = value; }])) };
  execute(app, "returnToSimulationTopic", context)();
  assert.deepEqual(events.setSetupOrigin, { type: "focus_topic", topicId: "original" });
  assert.equal(events.setScreen, "focus_topics");
  assert.equal(events.setLastTranscript, null);
  jsxCallback("ScorecardView", "onBack", context)();
  assert.equal(events.setScreen, "setup");
  const linked = jsxCallback("ScorecardView", "onBackToTopic", { ...context, returnToSimulationTopic: () => "original" });
  assert.equal(linked(), "original");
  assert.equal(jsxCallback("ScorecardView", "onBackToTopic", { simulationReturnOrigin: null, returnToSimulationTopic: () => assert.fail() }), undefined);
});

test("actual catalog hook resets synchronously for account/organization changes and refreshes on foreground", async () => {
  const source = readFileSync(new URL("./useFocusTopicCatalog.ts", import.meta.url), "utf8");
  let memo: { deps: unknown[]; value: any } | undefined;
  const effects: Array<() => any> = [];
  let onAppState: (state: string) => void = () => {};
  let calls = 0;
  const hook = execute(source, "useFocusTopicCatalog", {
    createFocusTopicCatalogController,
    fetchFocusTopicCatalog: async (id: string) => { calls++; return { topics: [{ ...topics[0], id }] }; },
    useMemo: (factory: () => any, deps: unknown[]) => {
      if (!memo || deps.some((dep, index) => dep !== memo!.deps[index])) memo = { deps, value: factory() };
      return memo.value;
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => any) => snapshot(),
    useEffect: (effect: () => any) => effects.push(effect),
    AppState: { addEventListener: (_event: string, callback: typeof onAppState) => {
      onAppState = callback; return { remove() {} };
    } },
  });
  const context = { userId: "user_a", orgId: "org_a", authToken: "token", enabled: true, destination: "home" };
  const first = hook(context);
  assert.equal(first.state.topics, null);
  const cleanups = effects.splice(0).map((effect) => effect());
  await first.controller.refresh();
  assert.equal(first.controller.getSnapshot().topics[0].id, "user_a");
  onAppState("inactive"); assert.equal(first.controller.getSnapshot().topics, null);
  onAppState("active"); await first.controller.refresh(); assert.equal(calls, 2);
  const changedOrg = hook({ ...context, orgId: "org_b" });
  assert.notEqual(changedOrg.controller, first.controller);
  assert.equal(changedOrg.state.topics, null, "no old-org flash before effects");
  cleanups.forEach((cleanup) => cleanup?.());
  effects.splice(0).forEach((effect) => effect());
  await changedOrg.controller.refresh();
  const changedUser = hook({ ...context, userId: "user_b", orgId: "org_b" });
  assert.equal(changedUser.state.topics, null);
  effects.splice(0).forEach((effect) => effect()); await changedUser.controller.refresh();
  assert.equal(changedUser.controller.getSnapshot().topics[0].id, "user_b");
});

test("Topic detail presents learning before practice while retaining both independent empty states and revoked fallback", () => {
  const source = readFileSync(new URL("./FocusTopicDetailScreen.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf(">Learning Resources</Text>") < source.indexOf(">Practice</Text>"));
  assert.match(source, /No practice scenarios are available/);
  assert.match(source, /No learning resources are available/);
  assert.match(source, /isFocusTopicUnavailableError\(caught\)/);
  assert.match(source, /This Focus Topic is no longer available/);
});
