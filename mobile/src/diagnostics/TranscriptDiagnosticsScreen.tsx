import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppColorScheme } from "../types";
import { getApiBaseUrl } from "../lib/api";
import { getSimulationMessageWidthConstraints } from "../lib/simulationMessageLayout";
import { normalizeTranscriptText } from "../lib/transcriptText";
import { getSimulationTranscriptStyles } from "../screens/SimulationScreen";
import {
  compareTranscriptFrames, diagnosticLineHeight, formatDiagnosticNumber as number,
  makeTranscriptSweep, MAX_DIAGNOSTIC_RESULTS, nextTranscriptSweepStep,
  TRANSCRIPT_PROBES, transcriptDiagnosticsAllowed,
} from "./transcriptWrappingDiagnostics";
import type { DiagnosticMode, ProbeMeasurement } from "./transcriptWrappingDiagnostics";

type Probe = typeof TRANSCRIPT_PROBES[number];
type Measurements = Record<string, ProbeMeasurement>;
type Result = { offset: number; mode: DiagnosticMode; id: string; status: string; shortfall: number | null };
type Run = { positions: number[]; step: number };

// Real native Text, with the live renderer's exact widths, normalization and bubble styles.
function Bubble({ probe, compact, mode, width, styles, configuration, report, logicalScroll, position = 0 }: {
  probe: Probe; compact: boolean; mode: DiagnosticMode; width: number;
  styles: ReturnType<typeof getSimulationTranscriptStyles>; configuration: string;
  report: (id: string, value: ProbeMeasurement) => void; logicalScroll: () => number; position?: number;
}) {
  const text = useRef<Text>(null);
  const measurement = useRef<ProbeMeasurement>({ configuration, position });
  if (measurement.current.position !== position) measurement.current = { configuration, position };
  const widths = getSimulationMessageWidthConstraints({ viewportWidth: width, compact });
  function update(value: Partial<ProbeMeasurement>) {
    if (measurement.current.position !== position) return;
    measurement.current = { ...measurement.current, ...value };
    report(probe.id, { ...measurement.current });
  }
  function measurePosition() {
    text.current?.measureInWindow((_x, y, _width, height) => update({ windowY: y, logicalY: y + logicalScroll(), measuredHeight: height }));
  }
  useEffect(() => {
    const frame = requestAnimationFrame(measurePosition);
    return () => cancelAnimationFrame(frame);
  }, [position]);
  return <View onLayout={(event) => update({ bubbleY: event.nativeEvent.layout.y })}
    style={[styles.messageBubble, compact ? styles.messageBubbleCompact : null,
      probe.role === "user" ? styles.userBubble : styles.aiBubble,
      widths ? { width: widths.bubbleMaxWidth } : null]}>
    <Text style={[styles.messageRole, compact ? styles.messageRoleCompact : null,
      probe.role === "user" ? styles.userMessageRole : styles.aiMessageRole]}>
      {probe.role === "user" ? "You" : "AI"}
    </Text>
    <Text ref={text} lineBreakStrategyIOS="standard"
      onLayout={(event) => { update({ frame: { ...event.nativeEvent.layout } }); measurePosition(); }}
      onTextLayout={(event) => { update({ lines: event.nativeEvent.lines.length }); measurePosition(); }}
      style={[styles.messageText, compact ? styles.messageTextCompact : null,
        probe.role === "user" ? styles.userMessageText : styles.aiMessageText,
        widths ? { width: widths.textMaxWidth } : null, { lineHeight: diagnosticLineHeight(compact, mode) }]}>
      {normalizeTranscriptText(probe.content)}
    </Text>
  </View>;
}

export function TranscriptWrappingDiagnostics({ colorScheme, onClose }: { colorScheme: AppColorScheme; onClose: () => void }) {
  const allowed = transcriptDiagnosticsAllowed(process.env.EXPO_PUBLIC_API_BASE_URL, getApiBaseUrl());
  // This second boundary denies direct component access in production too.
  return allowed ? <DiagnosticSession colorScheme={colorScheme} onClose={onClose} /> : null;
}

function DiagnosticSession({ colorScheme, onClose }: { colorScheme: AppColorScheme; onClose: () => void }) {
  const { width, fontScale } = useWindowDimensions();
  const styles = useMemo(() => getSimulationTranscriptStyles(colorScheme), [colorScheme]);
  const dark = colorScheme !== "soft_light";
  const ink = { color: dark ? "#f8f0df" : "#243a2d" };
  const [viewport, setViewport] = useState(0);
  const [compact, setCompact] = useState(false);
  const [mode, setMode] = useState<DiagnosticMode>("baseline");
  const [offset, setOffset] = useState(0);
  const [mount, setMount] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [frames, setFrames] = useState<Measurements>({});
  const [references, setReferences] = useState<Measurements>({});
  const inner = useRef<ScrollView>(null);
  const scroll = useRef({ outer: 0, inner: 0 });
  const framesRef = useRef<Measurements>({});
  const referencesRef = useRef<Measurements>({});
  const configuration = `${viewport}:${width}:${fontScale}:${compact}:${colorScheme}:${mode}`;
  const generation = `${configuration}:${mount}`;
  const active = useRef(generation);
  active.current = generation;
  const referenceActive = useRef(configuration);
  referenceActive.current = configuration;
  useEffect(() => () => { active.current = "unmounted"; referenceActive.current = "unmounted"; }, []);

  useEffect(() => {
    setRun(null); setResults([]);
  }, [viewport, width, fontScale, compact, colorScheme]);

  function record(id: string, value: ProbeMeasurement, expected: string, reference: boolean) {
    if (expected !== (reference ? referenceActive.current : active.current)) return;
    const store = reference ? referencesRef : framesRef;
    if (JSON.stringify(store.current[id]) === JSON.stringify(value)) return;
    store.current = { ...store.current, [id]: value };
    (reference ? setReferences : setFrames)(store.current);
  }
  function remount() { setMount((value) => value + 1); framesRef.current = {}; setFrames({}); }
  function stop() { setRun(null); }
  function move(value: number) { stop(); setOffset(Math.max(0, Math.min(4600, value))); }
  function start() {
    const anchor = framesRef.current["long-you"], reference = referencesRef.current["long-you"];
    if (anchor?.configuration !== configuration || reference?.configuration !== configuration
      || anchor.position !== offset || !Number.isFinite(anchor?.logicalY)
      || compareTranscriptFrames(anchor, reference).status === "INCONCLUSIVE") return;
    const positions = makeTranscriptSweep(anchor.logicalY! - offset, reference.frame!.height);
    if (!positions.length) return;
    setResults([]); setMode("baseline"); setOffset(positions[0]); remount();
    setRun({ positions, step: 0 });
  }
  // Fixed 900ms per probe, including missing measurements; maximum 56 steps/50.4s.
  // Every sweep probe remounts. Manual 1/3pt moves do not: useful for stale-layout investigation.
  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(() => {
      const snapshot = TRANSCRIPT_PROBES.map((probe) => {
        const actual = framesRef.current[probe.id];
        const reference = referencesRef.current[probe.id];
        const comparison = compareTranscriptFrames(actual?.configuration === configuration && actual.position === offset ? actual : undefined, reference);
        return { offset, mode, id: probe.id, status: comparison.status, shortfall: comparison.shortfall };
      });
      // Keep one summary per step: suspicious first, otherwise anchor (no text retained).
      const result = snapshot.find((item) => item.status === "SHORT") ?? snapshot[1];
      setResults((previous) => [...previous, result].slice(-MAX_DIAGNOSTIC_RESULTS));
      const next = nextTranscriptSweepStep(run.step, run.positions.length * 2);
      if (next === null) { setRun(null); return; }
      setMode(next < run.positions.length ? "baseline" : "comparison");
      setOffset(run.positions[next % run.positions.length]); remount();
      setRun({ ...run, step: next });
    }, 900);
    return () => clearTimeout(timer);
  }, [run, configuration, offset, mode]);

  function jump(result: Result) {
    stop(); setMode(result.mode); setOffset(result.offset); remount();
    // Bubble position is relative to inner content; same offsets used by both A/B passes.
    pendingJump.current = result.id;
  }
  const pendingJump = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingJump.current;
    const frame = id ? frames[id] : undefined;
    if (frame?.configuration === configuration && frame.bubbleY !== undefined) {
      pendingJump.current = null;
      inner.current?.scrollTo({ y: Math.max(0, frame.bubbleY - 16), animated: false });
    }
  }, [frames, configuration]);

  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button"
    accessibilityState={{ disabled }} disabled={disabled} onPress={action}
    style={[local.button, { borderColor: dark ? "#a6b7a4" : "#59765c", opacity: disabled ? 0.45 : 1 }]}>
    <Text style={ink}>{label}</Text>
  </Pressable>;
  const rn = Platform.constants.reactNativeVersion;
  const anchorReady = frames["long-you"]?.position === offset
    && Number.isFinite(frames["long-you"]?.logicalY)
    && compareTranscriptFrames(frames["long-you"], references["long-you"]).status !== "INCONCLUSIVE";
  return <SafeAreaView style={[local.root, { backgroundColor: dark ? "#15251e" : "#faf7ee" }]}>
    {/* Independent overlapping references stay near the coordinate origin, outside both scrollers.
        opacity:0 keeps native layout/TextKit active; display:none would invalidate measurement. */}
    {viewport > 0 ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={local.reference}>
      {TRANSCRIPT_PROBES.map((probe) => <View key={`${configuration}:${probe.id}`} style={local.referenceBubble}>
        <Bubble probe={probe} compact={compact} mode={mode} width={viewport} styles={styles}
          configuration={configuration} logicalScroll={() => 0}
          report={(id, value) => record(id, value, configuration, true)} />
      </View>)}
    </View> : null}
    <ScrollView removeClippedSubviews={false} scrollEventThrottle={16}
      onScroll={(event) => { scroll.current.outer = event.nativeEvent.contentOffset.y; }}
      onScrollBeginDrag={stop} contentContainerStyle={local.outer}>
      <Text style={[local.title, ink]}>Staging transcript diagnostics</Text>
      <Text style={ink}>Synthetic text only · RN {rn.major}.{rn.minor}.{rn.patch} · Expo SDK 57 · {Platform.OS}{"\n"}
        Pixel scale {PixelRatio.get()} · font scale {fontScale} · viewport {viewport}pt</Text>
      <Text style={ink}>SHORT = native frame smaller than independent reference. FITS does not prove correct drawing.
        INCONCLUSIVE = missing, stale, mismatched or off-origin reference. Line counts are secondary.</Text>
      <View style={local.controls}>
        {button("Close", onClose)}
        {button(compact ? "Compact 19 / 19.001" : "Standard 21 / 21.001", () => { stop(); setCompact(!compact); })}
        {button("Switch line height", () => { stop(); setMode(mode === "baseline" ? "comparison" : "baseline"); remount(); })}
        {button("− ⅓ pt", () => move(offset - 1 / 3), !!run)}
        {button("+ ⅓ pt", () => move(offset + 1 / 3), !!run)}
        {button("Remount bubbles", () => { stop(); remount(); })}
        {button("Sweep both A/B", start, !!run || !anchorReady)}
        {button("Stop sweep", stop, !run)}
      </View>
      <Text style={ink}>Sweep crosses the long YOU reference midpoint near 512/1024/2048/4096pt, ±1pt in thirds.
        A/B reuse identical offsets. Each probe remounts; manual nudges preserve mounts and may be inconclusive until a new onLayout event.
        Scroll stops a sweep. Results are local and cleared on exit.</Text>
      <View style={[styles.chatCard, compact ? styles.chatCardCompact : null, { height: 420 }]}>
        <View style={styles.chatHeader}><Text style={styles.chatTitle}>Live turn history · synthetic</Text></View>
        <ScrollView ref={inner} style={styles.chatScroll} nestedScrollEnabled removeClippedSubviews={false}
          onLayout={(event) => setViewport(Math.floor(event.nativeEvent.layout.width))}
          onScrollBeginDrag={stop} scrollEventThrottle={16}
          onScroll={(event) => { scroll.current.inner = event.nativeEvent.contentOffset.y; }}
          contentContainerStyle={[styles.chatContent, compact ? styles.chatContentCompact : null]}>
          <View style={{ height: offset }} />
          {viewport > 0 ? TRANSCRIPT_PROBES.map((probe) => <Bubble key={`${generation}:${probe.id}`}
            probe={probe} compact={compact} mode={mode} width={viewport} styles={styles} configuration={configuration} position={offset}
            logicalScroll={() => scroll.current.outer + scroll.current.inner}
            report={(id, value) => record(id, value, generation, false)} />) : null}
        </ScrollView>
      </View>
      {/* Changing status/number widths must not move the calibrated scene between A/B passes. */}
      <Text style={ink}>Line height {diagnosticLineHeight(compact, mode)} · {mode}{"\n"}
        Spacer {number(offset)}pt · {run ? `probe ${run.step + 1}/${run.positions.length * 2}` : "idle"}</Text>
      {!anchorReady && !run ? <Text style={ink}>Sweep needs fresh anchor and near-origin reference frames. Try Remount bubbles; unusually tall references may be inconclusive.</Text> : null}
      <Text style={ink}>Positions sampled at layout: Text window Y and scroll-restored Y (not a native Yoga absolute-coordinate API).
        Inspect actual positions below. The independent reference never uses target line count to infer height.</Text>
      {TRANSCRIPT_PROBES.map((probe) => {
        const actual = frames[probe.id]?.configuration === configuration && frames[probe.id]?.position === offset ? frames[probe.id] : undefined;
        const reference = references[probe.id];
        const comparison = compareTranscriptFrames(actual, reference);
        return <View key={probe.id} style={local.metric}>
          <Text selectable style={ink}>{probe.id}: {comparison.status} · shortfall {number(comparison.shortfall)}pt{"\n"}
            frame w {number(actual?.frame?.width)} h {number(actual?.frame?.height)} x {number(actual?.frame?.x)} y {number(actual?.frame?.y)}{"\n"}
            windowY {number(actual?.windowY)} restoredY {number(actual?.logicalY)}{"\n"}
            measureInWindow height {number(actual?.measuredHeight)} (secondary; may round){"\n"}
            reference w {number(reference?.frame?.width)} h {number(reference?.frame?.height)} Y {number(reference?.windowY)}{"\n"}
            lines target/ref {actual?.lines ?? "?"}/{reference?.lines ?? "?"} · {comparison.reason}</Text>
          {button(`Inspect ${probe.id}`, () => { pendingJump.current = probe.id;
            inner.current?.scrollTo({ y: Math.max(0, (actual?.bubbleY ?? offset) - 16), animated: false }); })}
        </View>;
      })}
      <Text style={[local.title, ink]}>Bounded sweep results ({results.length})</Text>
      {results.map((result, index) => <View key={index} style={local.metric}>
        <Text style={ink}>{index + 1}. {result.mode} · {result.id} · {result.status} · Δ {number(result.shortfall)} · offset {number(result.offset)}</Text>
        {button("Revisit probe", () => jump(result))}
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}

const local = StyleSheet.create({
  root: { flex: 1 }, outer: { padding: 12, gap: 12 }, title: { fontSize: 18, fontWeight: "700" },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, justifyContent: "center" },
  metric: { gap: 6, paddingVertical: 8 },
  reference: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  referenceBubble: { position: "absolute", top: 0, left: 0, right: 0 },
});
