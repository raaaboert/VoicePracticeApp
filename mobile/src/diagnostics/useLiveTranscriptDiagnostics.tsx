import { useEffect, useRef, useState } from "react";
import { PixelRatio, Pressable, ScrollView, Text, View } from "react-native";
import type { LayoutChangeEvent, NativeSyntheticEvent, TextLayoutEventData } from "react-native";
import { getApiBaseUrl } from "../lib/api";
import { formatDiagnosticNumber as number, transcriptDiagnosticsAllowed } from "./transcriptWrappingDiagnostics";
import type { Frame } from "./transcriptWrappingDiagnostics";

type LiveFrame = { frame?: Frame; lines?: number; window?: Frame };

// Explicit local snapshots only. No transcript strings, logs, storage, timers or network requests.
// No independent reference here: live observations must never be classified SHORT/FITS.
export function useLiveTranscriptDiagnostics(scope: string, recentIds: string[], fontScale: number, dark: boolean) {
  const allowed = transcriptDiagnosticsAllowed(process.env.EXPO_PUBLIC_API_BASE_URL, getApiBaseUrl());
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveFrame[]>([]);
  const nodes = useRef(new Map<string, Text>());
  const frames = useRef(new Map<string, LiveFrame>());
  const bindings = useRef(new Map<string, {
    ref: (node: Text | null) => void;
    onLayout: (event: LayoutChangeEvent) => void;
    onTextLayout: (event: NativeSyntheticEvent<TextLayoutEventData>) => void;
  }>());
  const active = useRef("");
  const captureSequence = useRef(0);
  active.current = allowed && enabled ? scope : "";
  useEffect(() => {
    captureSequence.current++; setEnabled(false); setSnapshot([]); nodes.current.clear(); frames.current.clear(); bindings.current.clear();
    return () => { active.current = ""; };
  }, [scope]);
  const selected = new Set(recentIds.slice(-12));
  for (const key of bindings.current.keys()) if (!selected.has(key)) {
    bindings.current.delete(key); nodes.current.delete(key); frames.current.delete(key);
  }
  function textProps(id: string) {
    if (!allowed || !enabled || !selected.has(id)) return {};
    if (!bindings.current.has(id)) bindings.current.set(id, {
      ref: (node) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); },
      onLayout: (event) => {
        if (active.current === scope) frames.current.set(id, { ...frames.current.get(id), frame: { ...event.nativeEvent.layout } });
      },
      onTextLayout: (event) => {
        if (active.current === scope) frames.current.set(id, { ...frames.current.get(id), lines: event.nativeEvent.lines.length });
      },
    });
    return bindings.current.get(id)!;
  }
  function close() {
    active.current = ""; setEnabled(false); setSnapshot([]); frames.current.clear(); bindings.current.clear(); nodes.current.clear();
  }
  function capture() {
    const sequence = ++captureSequence.current;
    const captured = [...selected].map((id) => ({ id, value: { ...frames.current.get(id) } }));
    for (const item of captured) nodes.current.get(item.id)?.measureInWindow((x, y, width, height) => {
      if (active.current !== scope || captureSequence.current !== sequence) return;
      item.value.window = { x, y, width, height };
      setSnapshot(captured.map(({ value }) => ({ ...value })));
    });
    setSnapshot(captured.map(({ value }) => ({ ...value })));
  }
  const ink = { color: dark ? "#f8f0df" : "#243a2d" };
  const panel = allowed && enabled ? <View accessibilityLabel="Local live transcript measurements"
    style={{ position: "absolute", left: 8, right: 8, bottom: 8, maxHeight: 240, padding: 12,
      borderWidth: 1, borderColor: dark ? "#a6b7a4" : "#59765c", backgroundColor: dark ? "#15251e" : "#faf7ee" }}>
    <ScrollView>
      <Text style={ink}>LIVE · INCONCLUSIVE · scale {PixelRatio.get()} / font {fontScale}{"\n"}
        No independent live reference. Capture before scrolling when clipping appears. Missing onLayout means no fresh event since enabling.
        Instrumentation may perturb layout; enable before testing. Last 12 bubbles only.</Text>
      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} onPress={capture}>
        <Text style={ink}>Capture local frames</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} onPress={close}>
        <Text style={ink}>Close diagnostics</Text>
      </Pressable>
      {snapshot.map((value, index) => <Text selectable key={index} style={ink}>
        Bubble {index + 1} · layout w/h {number(value.frame?.width)}/{number(value.frame?.height)} · lines {value.lines ?? "?"}{"\n"}
        window x/y {number(value.window?.x)}/{number(value.window?.y)} · w/h {number(value.window?.width)}/{number(value.window?.height)}
      </Text>)}
    </ScrollView>
  </View> : null;
  return { enabled: allowed && enabled, textProps, panel,
    titleProps: allowed ? { onLongPress: () => setEnabled((value) => !value),
      accessibilityHint: "Hold to toggle local staging transcript measurements" } : {} };
}
