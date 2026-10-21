import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { homeFocusTopicPreview, createFocusTopicCatalogController } from "./catalog";
import { buildScenarioSetupSelection, simulationTopicReturnOrigin, simulationTopicAttributionId } from "../trainingContent/scenarioSetupNavigation";
import { getTrainingContentTheme } from "../trainingContent/theme";

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
const previewStyles = execute(previewSource, "styles", { StyleSheet: { create: (styles: unknown) => styles } });
const renderPreview = execute(previewSource, "HomeFocusTopicPreview", {
  React: react, View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator",
  MaterialCommunityIcons: "Icon", homeFocusTopicPreview, styles: previewStyles,
});
const topics = Array.from({ length: 5 }, (_, i) => ({ id: `topic_${i}`, name: `Topic ${i}`, description: "Details",
  createdAt: "2026-01-01T00:00:00.000Z", scenarioCount: i, resourceCount: 5 - i }));

test("Home renders at most two compact Topic rows with counts, selection and View All callbacks", () => {
  const events: string[] = [];
  const tree = elements(renderPreview({ state: { topics, loading: false, error: null }, theme: {},
    onOpenTopic: (id: string) => events.push(id), onViewAll: () => events.push("all") }));
  const rows = tree.filter((node) => node.props.accessibilityLabel?.startsWith("Open Focus Topic "));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((node) => node.props.accessibilityLabel), [
    "Open Focus Topic Topic 0. 0 scenarios, 5 resources available",
    "Open Focus Topic Topic 1. 1 scenario, 4 resources available",
  ]);
  assert.ok(tree.some((node) => node.type === "Text" && node.props.children[0] === "0 scenarios · 5 resources"));
  assert.ok(tree.some((node) => node.type === "Text" && node.props.children[0] === "1 scenario · 4 resources"));
  assert.doesNotMatch(JSON.stringify(tree), /Details|FocusTopicCard/);
  assert.ok(tree.some((node) => node.type === "Icon" && node.props.name === "target"));
  assert.ok(tree.some((node) => node.type === "Icon" && node.props.name === "chevron-right"));
  rows[1]!.props.onPress();
  tree.find((node) => node.props.accessibilityLabel === "View all Focus Topics")!.props.onPress();
  assert.deepEqual(events, ["topic_1", "all"]);
});

test("compact Home rows retain readable theme tokens, accessible counts and width-safe touch targets", () => {
  for (const scheme of ["classic_blue", "soft_light"] as const) {
    const theme = getTrainingContentTheme(scheme);
    const tree = elements(renderPreview({ state: { topics: [{ ...topics[0], scenarioCount: 0, resourceCount: 0 }],
      loading: false, error: null }, theme }));
    const row = tree.find((node) => node.props.accessibilityLabel?.startsWith("Open Focus Topic "))!;
    assert.equal(row.props.accessibilityRole, "button");
    assert.equal(row.props.accessibilityLabel, "Open Focus Topic Topic 0. 0 scenarios, 0 resources available");
    assert.equal(row.props.accessibilityHint, "Opens this Focus Topic");
    assert.equal(row.props.style({ pressed: false })[1].backgroundColor, theme.surface);
    assert.equal(row.props.style({ pressed: true })[1].backgroundColor, theme.surfaceStrong);
    assert.equal(row.props.style({ pressed: false })[1].borderColor, theme.border);
    assert.ok(row.props.style({ pressed: false })[0].minHeight >= 44);
    const name = tree.find((node) => node.props.numberOfLines === 2)!;
    assert.equal(name.props.style[1].color, theme.text);
    assert.equal(previewStyles.copy.minWidth, 0);
    assert.equal(previewStyles.copy.flex, 1);
    assert.ok(tree.filter((node) => node.type === "Icon").every((node) => node.props.accessible === false));
    assert.ok(tree.some((node) => node.type === "Text" && node.props.style?.[1]?.color === theme.muted));
  }
});

test("Home renders distinct loading, failure/Retry and empty states without stale rows", () => {
  let retries = 0;
  for (const state of [{ topics, loading: true, error: null },
    { topics: null, loading: false, error: "Unable to load" }, { topics: [], loading: false, error: null }]) {
    const tree = elements(renderPreview({ state, theme: {}, onRetry: () => retries++ }));
    assert.equal(tree.filter((node) => node.props.accessibilityLabel?.startsWith("Open Focus Topic ")).length, 0);
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

test("actual simulation setup captures standard/custom Topic origins without changing runtime trainingId; Browse stays unknown", async () => {
  let delivered: any;
  const register = execute(readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8"), "startSimulationSession", {
    requestJson: async (_path: string, init: { body: string }) => { delivered = JSON.parse(init.body); },
  });
  for (const source of ["standard", "custom"] as const) {
    const chosen = { ...scenario, source, trainingId: source === "custom" ? "topic" : null };
    const context = { simulationTopicReturnOrigin, setupOrigin: { type: "focus_topic", topicId: "topic" },
      simulationTopicAttributionId, industryOptions: [{ id: "sales", roles: [{ id: chosen.segmentId, scenarios: [chosen] }] }],
      originScenarioSelection: buildScenarioSetupSelection(chosen), scenarioCatalogTab: source,
      activeTraining: { id: "topic" }, industryId: "sales", activeSegment: { id: "sales_representative" }, scenario: chosen };
    const captured = execute(app, "topicOrigin", context);
    assert.deepEqual(captured, { type: "focus_topic", topicId: "topic" });
    const attribution = execute(app, "originTopicId", context);
    assert.equal(attribution, "topic");
    await register("learner", { simulationSessionId: "session", scenarioId: chosen.id, segmentId: chosen.segmentId,
      trainingId: chosen.trainingId, originTopicId: attribution }, "token");
    assert.equal(delivered.originTopicId, "topic");
    assert.equal(delivered.trainingId, chosen.trainingId);
    assert.equal(execute(app, "topicOrigin", { ...context, setupOrigin: null }), null);
    assert.equal(execute(app, "topicOrigin", { ...context, scenario: { ...chosen, id: "other" } }), null);
    assert.equal(execute(app, "originTopicId", { ...context, setupOrigin: null }), null);
    assert.equal(execute(app, "originTopicId", { ...context, scenario: { ...chosen, id: "other" } }), null);
  }
  assert.match(app, /originTopicId,\s+simulationSessionId:/);
  const simulation = readFileSync(new URL("../screens/SimulationScreen.tsx", import.meta.url), "utf8");
  assert.match(simulation, /originTopicId: config\.originTopicId \?\? null/);
});

test("Topic custom practice keeps attribution through registration after an eligible industry change, while navigation remains exact", async () => {
  const configured = { ...scenario, enabled: true, description: "Practice", desiredOutcome: "Agree next steps",
    aiRole: "A counterpart", applicableIndustryIds: ["sales", "people_management"] };
  // Execute the real Topic-scoped custom-options projection, including scenario attachment.
  const trainings = execute(app, "activeCustomTrainingOptions", {
    useMemo: (factory: () => any) => factory(), activeOrgCustomScenarios: [configured],
    enabledIndustries: configured.applicableIndustryIds.map(id => ({ id, label: id })),
    enabledSegments: [{ id: configured.segmentId, label: "Salesperson", enabled: true }],
    config: { orgTrainings: [{ id: "topic", name: "Topic", status: "active", description: "", attachedCustomScenarioIds: [configured.id] }] },
    toRuntimeScenarioFromCustomScenario: execute(app, "toRuntimeScenarioFromCustomScenario", {}),
    sanitizeTrainingDescription: (value: string) => value,
  });
  assert.equal(trainings.length, 1);
  assert.deepEqual(trainings[0].industries.map((industry: any) => industry.id), configured.applicableIndustryIds);
  for (const industry of trainings[0].industries) {
    assert.equal(industry.roles[0].id, configured.segmentId);
    assert.equal(industry.roles[0].scenarios[0].id, configured.id);
  }
  const context = { simulationTopicReturnOrigin, simulationTopicAttributionId,
    setupOrigin: { type: "focus_topic", topicId: "topic" }, originScenarioSelection: buildScenarioSetupSelection(configured),
    scenarioCatalogTab: "custom", activeTraining: trainings[0], activeSegment: trainings[0].industries[0].roles[0],
    scenario: configured, industryOptions: trainings[0].industries, industryId: "sales" };
  assert.equal(execute(app, "originTopicId", context), "topic");
  assert.deepEqual(execute(app, "topicOrigin", context), context.setupOrigin);
  const changed = { ...context, industryId: "people_management" };
  assert.equal(execute(app, "originTopicId", changed), "topic");
  assert.equal(execute(app, "topicOrigin", changed), null, "existing industry-specific return navigation is unchanged");
  let body: any;
  const register = execute(readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8"), "startSimulationSession", {
    requestJson: async (_path: string, init: { body: string }) => { body = JSON.parse(init.body); },
  });
  await register("learner", { simulationSessionId: "session", scenarioId: configured.id, segmentId: configured.segmentId,
    trainingId: trainings[0].id, originTopicId: execute(app, "originTopicId", changed) }, "token");
  assert.equal(body.originTopicId, "topic");
  assert.equal(body.trainingId, "topic");
  assert.equal(execute(app, "originTopicId", { ...changed, industryId: "medical" }), null);
  assert.equal(execute(app, "originTopicId", { ...changed, industryOptions: [] }), null);
});

test("Topic attribution rejects unrelated, ineligible and Browse selections", () => {
  const origin = { type: "focus_topic" as const, topicId: "topic" };
  const industries = [{ id: "sales", roles: [{ id: scenario.segmentId, scenarios: [{ id: scenario.id, enabled: true }] }] }];
  assert.equal(simulationTopicAttributionId(origin, selected, applied, industries), "topic");
  for (const changed of [
    { ...applied, scenarioId: "unrelated" }, { ...applied, roleId: "unrelated" },
    { ...applied, trainingId: "unrelated" }, { ...applied, scenarioCatalogTab: "standard" as const, trainingId: null },
    { ...applied, industryId: "ineligible" }, { ...applied, industryId: null },
  ]) assert.equal(simulationTopicAttributionId(origin, selected, changed, industries), null);
  assert.equal(simulationTopicAttributionId({ ...origin, topicId: "other_topic" }, selected, applied, industries), null);
  assert.equal(simulationTopicAttributionId(null, selected, applied, industries), null);
  assert.equal(simulationTopicAttributionId({ type: "learning_resource", contentId: "resource" }, selected, applied, industries), null);
  assert.equal(simulationTopicAttributionId(origin, null, applied, industries), null);
  assert.equal(simulationTopicAttributionId(origin, selected, applied, []), null);
  assert.equal(simulationTopicAttributionId(origin, selected, applied,
    [{ id: "sales", roles: [{ ...industries[0]!.roles[0]!, enabled: false }] }]), null);
  assert.equal(simulationTopicAttributionId(origin, selected, applied,
    [{ id: "sales", roles: [{ id: scenario.segmentId, scenarios: [{ id: scenario.id, enabled: false }] }] }]), null);
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

function topicScreenHarness(initialTopicId: string | null, initialBackDestination: "home" | "catalog") {
  const state: any[] = [];
  let cursor = 0;
  const events: string[] = [];
  const render = execute(readFileSync(new URL("./FocusTopicsScreen.tsx", import.meta.url), "utf8"), "FocusTopicsScreen", {
    React: react, View: "View", styles: {}, getTrainingContentTheme: () => ({}),
    FocusTopicDetailScreen: "Detail", FocusTopicLandingScreen: "Catalog", TrainingContentDetailScreen: "Resource",
    useCallback: (callback: unknown) => callback, useMemo: (factory: () => any) => factory(),
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
  });
  return {
    events,
    render() {
      cursor = 0;
      return elements(render({ initialTopicId, initialBackDestination,
        catalog: { state: { topics, loading: false, error: null }, controller: { refresh: () => events.push("refresh") } },
        onBackToHome: () => events.push("home"), onLeaveReturnedTopic: () => events.push("leave"),
        onPracticeScenario: () => events.push("practice"),
      })).find((node) => ["Detail", "Catalog", "Resource"].includes(node.type))!;
    },
  };
}

test("Home → Topic → Back returns Home; Catalog → Topic → Back returns Catalog", () => {
  const origin = (context: Record<string, any>) => jsxCallback("FocusTopicsScreen", "initialBackDestination", {
    notificationDestination: null, setupOrigin: null, homeFocusTopicId: "topic", setupOriginTopicId: (value: any) => value?.topicId,
    ...context,
  });
  assert.equal(origin({}), "home");
  assert.equal(origin({ homeFocusTopicId: null }), "catalog");
  assert.equal(origin({ setupOrigin: { type: "focus_topic", topicId: "returned" } }), "catalog", "scorecard/exit return keeps catalog fallback");
  assert.equal(origin({ notificationDestination: { type: "focus_topic", topicId: "notification" } }), "catalog");

  const home = topicScreenHarness("topic", origin({}));
  home.render().props.onBack();
  assert.deepEqual(home.events, ["leave", "home"]);
  const catalog = topicScreenHarness(null, origin({ homeFocusTopicId: null }));
  catalog.render().props.onOpenTopic(topics[0]);
  assert.equal(catalog.render().type, "Detail");
  catalog.render().props.onBack();
  assert.equal(catalog.render().type, "Catalog");
  assert.deepEqual(catalog.events, ["leave"]);
});

test("resource return preserves Topic origin and unavailable Topic Back still refreshes the catalog", () => {
  for (const origin of ["home", "catalog"] as const) {
    const screen = topicScreenHarness("topic", origin);
    screen.render().props.onOpenResource("resource");
    assert.equal(screen.render().type, "Resource");
    screen.render().props.onBack();
    assert.equal(screen.render().type, "Detail");
    screen.render().props.onUnavailable();
    screen.render().props.onBack();
    assert.deepEqual(screen.events, origin === "home" ? ["leave", "refresh", "home"] : ["leave", "refresh"]);
  }
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

test("actual catalog hook reuses Home/View All data, refreshes on reentry and isolates identity/authorization changes", async () => {
  const source = readFileSync(new URL("./useFocusTopicCatalog.ts", import.meta.url), "utf8");
  let memo: { deps: unknown[]; value: any } | undefined;
  const effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  let effectIndex = 0;
  const pendingEffects: Array<() => void> = [];
  let onAppState: (state: string) => void = () => {};
  let calls = 0;
  let latestPractice: string | undefined;
  const hook = execute(source, "useFocusTopicCatalog", {
    createFocusTopicCatalogController,
    fetchFocusTopicCatalog: async (id: string) => { calls++; return { topics: [{ ...topics[0], id, lastCompletedPracticeAt: latestPractice }] }; },
    useMemo: (factory: () => any, deps: unknown[]) => {
      if (!memo || deps.some((dep, index) => dep !== memo!.deps[index])) memo = { deps, value: factory() };
      return memo.value;
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => any) => snapshot(),
    useEffect: (effect: () => any, deps: unknown[]) => {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
    AppState: { addEventListener: (_event: string, callback: typeof onAppState) => {
      onAppState = callback; return { remove() {} };
    } },
  });
  const render = (params: Record<string, any>) => {
    effectIndex = 0;
    const result = hook(params);
    pendingEffects.splice(0).forEach((effect) => effect());
    return result;
  };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const context = { userId: "user_a", orgId: "org_a", authToken: "token", enabled: true, destination: "home" };
  const first = render(context);
  assert.equal(first.state.topics, null);
  await settle();
  assert.equal(first.controller.getSnapshot().topics[0].id, "user_a");
  assert.equal(calls, 1);
  assert.equal(render({ ...context, destination: "focus_topics" }).controller, first.controller);
  assert.equal(render(context).state.topics[0].id, "user_a");
  await settle();
  assert.equal(calls, 1, "Home → View All → Home does not prepare another request");
  render({ ...context, destination: null });
  assert.equal(first.controller.getSnapshot().topics, null);
  latestPractice = "2026-10-20T12:00:00.000Z";
  render({ ...context, destination: "focus_topics" });
  await settle();
  assert.equal(calls, 2, "leaving and reentering refreshes");
  assert.equal(first.controller.getSnapshot().topics[0].lastCompletedPracticeAt, latestPractice, "return after practice reads current recency before Home reuses it");
  onAppState("inactive"); assert.equal(first.controller.getSnapshot().topics, null);
  onAppState("active"); await settle(); assert.equal(calls, 3);
  const changedOrg = render({ ...context, orgId: "org_b" });
  assert.notEqual(changedOrg.controller, first.controller);
  assert.equal(changedOrg.state.topics, null, "no old-org flash before effects");
  await settle();
  const changedUser = render({ ...context, userId: "user_b", orgId: "org_b" });
  assert.equal(changedUser.state.topics, null);
  await settle();
  assert.equal(changedUser.controller.getSnapshot().topics[0].id, "user_b");
  const changedToken = render({ ...context, userId: "user_b", orgId: "org_b", authToken: "new_token" });
  assert.equal(changedToken.state.topics, null);
  await settle();
  const disabled = render({ ...context, enabled: false });
  await settle();
  assert.equal(disabled.controller.getSnapshot().topics, null);
  assert.equal(calls, 6, "disabled authority performs no fetch");
  effects.forEach((effect) => effect.cleanup?.());
});

test("Topic detail presents learning before practice while retaining both independent empty states and revoked fallback", () => {
  const source = readFileSync(new URL("./FocusTopicDetailScreen.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf(">Learning Resources</Text>") < source.indexOf(">Practice</Text>"));
  assert.match(source, /No practice scenarios are available/);
  assert.match(source, /No learning resources are available/);
  assert.match(source, /isFocusTopicUnavailableError\(caught\)/);
  assert.match(source, /This Focus Topic is no longer available/);
});
