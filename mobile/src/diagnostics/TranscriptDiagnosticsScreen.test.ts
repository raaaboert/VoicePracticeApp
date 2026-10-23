import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as model from "./transcriptWrappingDiagnostics";
import { getSimulationMessageWidthConstraints } from "../lib/simulationMessageLayout";
import { normalizeTranscriptText } from "../lib/transcriptText";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./TranscriptDiagnosticsScreen.tsx", import.meta.url), "utf8");
const liveSource = readFileSync(new URL("./useLiveTranscriptDiagnostics.tsx", import.meta.url), "utf8");
function loadFunction(text: string, name: string, bindings: Record<string, unknown>) {
  const ast = ts.createSourceFile("diagnostic.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node);
  const code = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function("require", "exports", ...Object.keys(bindings), `${code}; return ${name};`)(require, {}, ...Object.values(bindings));
}
// Controlled React hooks/native callbacks. This exercises JS lifecycle, NOT native text drawing.
function hooks() {
  const slots: any[] = [], effects: Array<() => void> = [];
  let index = 0;
  return {
    useState(initial: any) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value: any) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(initial: any) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo(factory: () => unknown) { index++; return factory(); },
    useEffect(effect: () => any, deps: unknown[]) {
      const i = index++, old = slots[i];
      if (!old || deps.some((value, n) => value !== old.deps[n])) {
        old?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = effect(); });
      }
    },
    render(render: () => any) {
      index = 0; const result = render(); effects.splice(0).forEach((effect) => effect()); return result;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function elements(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function button(node: any, label: string) {
  const found = elements(node).find((item) => item.type === "Pressable" && item.props.children?.props?.children === label);
  assert.ok(found, label); return found;
}
const native = { View: "View", Text: "Text", ScrollView: "ScrollView", SafeAreaView: "SafeAreaView", Pressable: "Pressable" };

test("production direct diagnostic entry returns null; staging entry uses the native diagnostic session", () => {
  const process = { env: { EXPO_PUBLIC_API_BASE_URL: "https://peritio-api-prod.onrender.com" } };
  const component = loadFunction(source, "TranscriptWrappingDiagnostics", { process,
    transcriptDiagnosticsAllowed: model.transcriptDiagnosticsAllowed,
    getApiBaseUrl: () => process.env.EXPO_PUBLIC_API_BASE_URL, DiagnosticSession: "DiagnosticSession" });
  assert.equal(component({ colorScheme: "soft_light", onClose() {} }), null);
  process.env.EXPO_PUBLIC_API_BASE_URL = model.STAGING_TRANSCRIPT_API;
  assert.equal(component({ colorScheme: "soft_light", onClose() {} }).type, "DiagnosticSession");
});

test("synthetic native bubble keeps full text/widths and records float frame independently of line count", () => {
  const h = hooks(), reports: any[] = [];
  const render = loadFunction(source, "Bubble", { ...h, ...native,
    getSimulationMessageWidthConstraints, normalizeTranscriptText, diagnosticLineHeight: model.diagnosticLineHeight,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  const styles = Object.fromEntries(["messageBubble", "userBubble", "aiBubble", "messageRole", "messageText"].map((key) => [key, key]));
  const props = { probe: model.TRANSCRIPT_PROBES[1], compact: false, mode: "baseline", width: 390, styles,
    configuration: "same", position: 0, logicalScroll: () => 2048, report: (_id: string, value: any) => reports.push(value) };
  const tree = h.render(() => render(props));
  const body = tree.props.children[1];
  assert.equal(body.props.children, props.probe.content);
  assert.equal(body.props.numberOfLines, undefined);
  assert.equal(body.props.ellipsizeMode, undefined);
  assert.equal(body.props.lineBreakStrategyIOS, "standard");
  assert.deepEqual(body.props.style.at(-1), { lineHeight: 21 });
  body.props.ref.current = { measureInWindow: (callback: any) => callback(20, 2000, 301, 110) };
  body.props.onLayout({ nativeEvent: { layout: { x: 0, y: 32, width: 301, height: 109.9998779296875 } } });
  body.props.onTextLayout({ nativeEvent: { lines: [{ text: "never retained" }] } });
  assert.equal(reports.at(-1).frame.height, 109.9998779296875);
  assert.equal(reports.at(-1).measuredHeight, 110);
  assert.equal(reports.at(-1).lines, 1);
  assert.equal(reports.at(-1).logicalY, 4048);
  assert.doesNotMatch(JSON.stringify(reports), /never retained|Absolutely/);
  const moved = h.render(() => render({ ...props, position: 1 / 3 }));
  moved.props.children[1].props.onTextLayout({ nativeEvent: { lines: [{ text: "still private" }] } });
  assert.equal(reports.at(-1).frame, undefined, "manual movement must not reuse an old layout frame");
  assert.equal(reports.at(-1).position, 1 / 3);
  h.unmount();
});

test("real sweep lifecycle terminates even without further native layout events and cleans timers", () => {
  const h = hooks(), timers = new Map<number, () => void>(); let sequence = 0;
  const Bubble = () => null;
  const render = loadFunction(source, "DiagnosticSession", {
    ...h, ...native, ...model, Bubble, number: model.formatDiagnosticNumber,
    local: {}, Platform: { OS: "ios", constants: { reactNativeVersion: { major: 0, minor: 86, patch: 3 } } },
    PixelRatio: { get: () => 3 }, useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
    getSimulationTranscriptStyles: () => ({}),
    setTimeout(callback: () => void) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const view = () => h.render(() => render({ colorScheme: "soft_light", onClose() {} }));
  let tree = view();
  elements(tree).find((item) => item.type === "ScrollView" && item.props.nestedScrollEnabled).props.onLayout({ nativeEvent: { layout: { width: 390 } } });
  tree = view();
  const anchors = elements(tree).filter((item) => item.type === Bubble && item.props.probe.id === "long-you");
  assert.equal(anchors.length, 2, "independent reference plus scrolling target");
  for (const [i, anchor] of anchors.entries()) anchor.props.report("long-you", {
    configuration: anchor.props.configuration, position: 0, frame: { x: 0, y: 32, width: 301, height: 84 },
    windowY: i === 0 ? 32 : 300, logicalY: 300, lines: 4,
  });
  tree = view();
  assert.equal(button(tree, "Sweep both A/B").props.disabled, false);
  button(tree, "Sweep both A/B").props.onPress(); tree = view();
  let steps = 0;
  while (timers.size) {
    assert.equal(timers.size, 1, "no duplicate timers");
    const [id, callback] = [...timers][0]; timers.delete(id); callback(); tree = view(); steps++;
    assert.ok(steps <= model.MAX_SWEEP_PROBES);
  }
  assert.equal(steps, 56);
  assert.equal(button(tree, "Stop sweep").props.disabled, true);
  const stoppedLayout = elements(tree).filter((item) => item.type === "Pressable").map((item) => item.props.children.props.children);
  assert.ok(stoppedLayout.includes("Switch line height"), "A/B control label is fixed so numeric widths cannot move the scene");
  // Start again from a fresh measurement, then unmount during the sweep.
  const target = elements(tree).filter((item) => item.type === Bubble && item.props.probe.id === "long-you").at(-1);
  target.props.report("long-you", { configuration: target.props.configuration, position: target.props.position,
    frame: { x: 0, y: 32, width: 301, height: 84 }, windowY: 300, logicalY: target.props.position + 300, lines: 4 });
  const reference = elements(tree).find((item) => item.type === Bubble && item.props.probe.id === "long-you");
  reference.props.report("long-you", { configuration: reference.props.configuration,
    frame: { x: 0, y: 32, width: 301, height: 84 }, windowY: 32, lines: 4 });
  tree = view(); button(tree, "Sweep both A/B").props.onPress(); view();
  assert.equal(timers.size, 1); h.unmount(); assert.equal(timers.size, 0);
});

test("live instrumentation is off by default, bounded, numeric only and denied in production", () => {
  const h = hooks();
  const process = { env: { EXPO_PUBLIC_API_BASE_URL: model.STAGING_TRANSCRIPT_API } };
  const hook = loadFunction(liveSource, "useLiveTranscriptDiagnostics", { ...h, ...native, process,
    getApiBaseUrl: () => process.env.EXPO_PUBLIC_API_BASE_URL,
    transcriptDiagnosticsAllowed: model.transcriptDiagnosticsAllowed, number: model.formatDiagnosticNumber,
    PixelRatio: { get: () => 3 } });
  const ids = Array.from({ length: 20 }, (_, index) => `message-${index}`);
  const view = (scope = "session:A") => h.render(() => hook(scope, ids, 1, false));
  let result = view();
  assert.equal(result.enabled, false); assert.equal(result.panel, null); assert.deepEqual(result.textProps(ids[19]), {});
  result.titleProps.onLongPress(); result = view(); assert.equal(result.enabled, true);
  assert.deepEqual(result.textProps(ids[0]), {});
  const props = result.textProps(ids[19]);
  props.onTextLayout({ nativeEvent: { lines: [{ text: "private learner utterance" }] } });
  props.onLayout({ nativeEvent: { layout: { x: 0, y: 32, width: 300, height: 109.9998779296875 } } });
  props.ref({ measureInWindow(callback: any) { callback(15, 2048, 300, 110); } });
  button(result.panel, "Capture local frames").props.onPress(); result = view();
  const rendered = JSON.stringify(result.panel);
  assert.doesNotMatch(rendered, /private learner utterance/); assert.match(rendered, /109\.999877930/);
  assert.match(rendered, /INCONCLUSIVE/);
  const callbacks: Array<(x: number, y: number, width: number, height: number) => void> = [];
  props.ref({ measureInWindow(callback: any) { callbacks.push(callback); } });
  button(result.panel, "Capture local frames").props.onPress();
  button(result.panel, "Capture local frames").props.onPress();
  callbacks[1](15, 2048, 300, 111);
  callbacks[0](15, 2048, 300, 999);
  result = view();
  assert.doesNotMatch(JSON.stringify(result.panel), /999\.000000000/, "stale native callbacks cannot replace a newer capture");
  result = view("session:B"); result = view("session:B");
  assert.equal(result.enabled, false); assert.equal(result.panel, null);
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://peritio-api-prod.onrender.com";
  result = view(); assert.deepEqual(result.titleProps, {}); assert.deepEqual(result.textProps(ids[19]), {}); assert.equal(result.panel, null);
  h.unmount();
});

test("references are mounted outside scrollers and diagnostics have no persistence/network/provider calls", () => {
  assert.ok(source.indexOf('style={local.reference}') < source.indexOf('<ScrollView removeClippedSubviews'));
  assert.match(source, /referenceBubble: \{ position: "absolute", top: 0/);
  assert.match(source, /opacity: 0/);
  assert.ok(source.indexOf('Line height {diagnosticLineHeight') > source.indexOf('<ScrollView ref={inner}'),
    "changing numeric status is below the calibrated scene");
  assert.doesNotMatch(source + liveSource, /console\.|AsyncStorage|SecureStore|fetch\(|fetchAi|createOpeningLine|generateAssistantReply/);
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /useState\(false\);\s*const canOpenTranscriptDiagnostics/);
  assert.match(app, /canOpenTranscriptDiagnostics && transcriptDiagnosticsOpen/);
  assert.match(app, /Boolean\(user\?\.emailVerifiedAt && mobileAuthToken\)/);
});
