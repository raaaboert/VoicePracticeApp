import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { computeVoiceOrbLayout, type VoiceOrbLayoutMode } from "../lib/voiceOrbLayout";

export type OrbMode = VoiceOrbLayoutMode;

interface VoiceOrbProps {
  mode: OrbMode;
  variant?: "light" | "dark";
}

type SignalStageKey = "capture" | "process" | "deliver";
type SignalStageState = "upcoming" | "ready" | "complete" | "active";

type SignalStageMeta = {
  state: SignalStageState;
  status: string;
};

const MODE_LABELS: Record<OrbMode, string> = {
  idle: "Ready",
  recording: "Listening",
  thinking: "Processing",
  speaking: "Responding",
};

const MODE_CAPTIONS: Record<OrbMode, string> = {
  idle: "The engine is waiting for the next response.",
  recording: "Voice input is being captured live.",
  thinking: "The next reply is being prepared now.",
  speaking: "The assistant reply is being delivered.",
};

const SIGNAL_STAGES: Array<{ key: SignalStageKey; label: string }> = [
  { key: "capture", label: "Capture" },
  { key: "process", label: "Process" },
  { key: "deliver", label: "Deliver" },
];

const THEME = {
  light: {
    shellBg: "rgba(252, 249, 242, 0.98)",
    shellBorder: "rgba(97, 116, 97, 0.18)",
    headerLabel: "#677362",
    headerCopy: "#778173",
    stateBadgeBg: "rgba(249, 246, 238, 0.98)",
    stateBadgeBorder: "rgba(97, 116, 97, 0.16)",
    stateBadgeText: "#4f614f",
    stageBg: "rgba(247, 249, 243, 0.98)",
    stageBorder: "rgba(97, 116, 97, 0.16)",
    coreShell: "rgba(255, 252, 246, 0.98)",
    coreBorder: "rgba(97, 116, 97, 0.16)",
    coreGrid: "rgba(96, 114, 96, 0.15)",
    stepDivider: "rgba(97, 116, 97, 0.14)",
    stepBg: "rgba(241, 245, 236, 0.98)",
    inactiveText: "#7a8476",
    labelText: "#4c5d4a",
    statusChipBg: "rgba(244, 246, 240, 0.98)",
    statusChipBorder: "rgba(97, 116, 97, 0.15)",
    caption: "#667264",
    shadow: "#131914",
  },
  dark: {
    shellBg: "rgba(20, 27, 21, 0.96)",
    shellBorder: "rgba(244, 231, 206, 0.09)",
    headerLabel: "#cfc3ab",
    headerCopy: "#9caa99",
    stateBadgeBg: "rgba(27, 35, 28, 0.96)",
    stateBadgeBorder: "rgba(244, 231, 206, 0.1)",
    stateBadgeText: "#f6ebd6",
    stageBg: "rgba(24, 32, 25, 0.94)",
    stageBorder: "rgba(244, 231, 206, 0.08)",
    coreShell: "rgba(29, 38, 31, 0.98)",
    coreBorder: "rgba(244, 231, 206, 0.08)",
    coreGrid: "rgba(244, 231, 206, 0.1)",
    stepDivider: "rgba(244, 231, 206, 0.07)",
    stepBg: "rgba(28, 36, 29, 0.56)",
    inactiveText: "#9dab9a",
    labelText: "#eef4ec",
    statusChipBg: "rgba(27, 35, 28, 0.94)",
    statusChipBorder: "rgba(244, 231, 206, 0.09)",
    caption: "#d5ddcf",
    shadow: "#0e1510",
  },
} as const;

const MODE_COLORS = {
  light: {
    idle: {
      accent: "#637b64",
      accentSoft: "rgba(99, 123, 100, 0.18)",
      glow: "rgba(99, 123, 100, 0.12)",
      highlight: "#f3e6ca",
    },
    recording: {
      accent: "#c98566",
      accentSoft: "rgba(201, 133, 102, 0.18)",
      glow: "rgba(201, 133, 102, 0.14)",
      highlight: "#f6ddd0",
    },
    thinking: {
      accent: "#c9a96d",
      accentSoft: "rgba(201, 169, 109, 0.18)",
      glow: "rgba(201, 169, 109, 0.14)",
      highlight: "#f6ead1",
    },
    speaking: {
      accent: "#86a187",
      accentSoft: "rgba(134, 161, 135, 0.18)",
      glow: "rgba(134, 161, 135, 0.14)",
      highlight: "#edf2e8",
    },
  },
  dark: {
    idle: {
      accent: "#8faf93",
      accentSoft: "rgba(143, 175, 147, 0.22)",
      glow: "rgba(143, 175, 147, 0.14)",
      highlight: "#f3e5c6",
    },
    recording: {
      accent: "#d9906f",
      accentSoft: "rgba(217, 144, 111, 0.22)",
      glow: "rgba(217, 144, 111, 0.14)",
      highlight: "#f7dece",
    },
    thinking: {
      accent: "#debe81",
      accentSoft: "rgba(222, 190, 129, 0.22)",
      glow: "rgba(222, 190, 129, 0.14)",
      highlight: "#faecd1",
    },
    speaking: {
      accent: "#a9c3aa",
      accentSoft: "rgba(169, 195, 170, 0.22)",
      glow: "rgba(169, 195, 170, 0.14)",
      highlight: "#eff1e6",
    },
  },
} as const;

function getSignalStageMeta(mode: OrbMode, stage: SignalStageKey): SignalStageMeta {
  if (mode === "recording") {
    if (stage === "capture") {
      return { state: "active", status: "Active" };
    }
    return { state: "upcoming", status: "Queued" };
  }

  if (mode === "thinking") {
    if (stage === "capture") {
      return { state: "complete", status: "Complete" };
    }
    if (stage === "process") {
      return { state: "active", status: "Active" };
    }
    return { state: "upcoming", status: "Queued" };
  }

  if (mode === "speaking") {
    if (stage === "deliver") {
      return { state: "active", status: "Active" };
    }
    return { state: "complete", status: "Complete" };
  }

  if (stage === "capture") {
    return { state: "ready", status: "Ready" };
  }

  return { state: "upcoming", status: "Queued" };
}

function getActivePhaseLabel(mode: OrbMode): string {
  if (mode === "recording") {
    return "Capture";
  }
  if (mode === "thinking") {
    return "Process";
  }
  if (mode === "speaking") {
    return "Deliver";
  }
  return "Standby";
}

export function VoiceOrb({ mode, variant = "dark" }: VoiceOrbProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [pulseValue] = useState(() => new Animated.Value(1));
  const [stageVisualWidth, setStageVisualWidth] = useState(0);
  const theme = THEME[variant];
  const colors = MODE_COLORS[variant][mode];
  const compactScreen = windowWidth < 380;
  const fallbackStageVisualWidth = Math.min(Math.max(windowWidth - 132, 208), 332);
  const visualLayout = computeVoiceOrbLayout({
    availableWidth: stageVisualWidth > 0 ? stageVisualWidth : fallbackStageVisualWidth,
    mode,
  });
  const shellHorizontalPadding = windowWidth < 360 ? 14 : 18;
  const stagePanelHorizontalPadding = windowWidth < 360 ? 12 : 16;

  useEffect(() => {
    pulseValue.stopAnimation();
    pulseValue.setValue(1);

    if (mode === "idle") {
      return;
    }

    const peakScale = mode === "recording" ? 1.1 : mode === "thinking" ? 1.06 : 1.08;
    const pulseDuration = mode === "recording" ? 520 : mode === "thinking" ? 920 : 680;

    const loopAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: peakScale,
          duration: pulseDuration,
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: pulseDuration,
          useNativeDriver: true,
        }),
      ]),
    );

    loopAnimation.start();

    return () => {
      loopAnimation.stop();
    };
  }, [mode, pulseValue]);

  const haloScale = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [1, visualLayout.haloPeakScale],
    extrapolate: "clamp",
  });
  const haloOpacity = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [visualLayout.haloMaxOpacity, 0.09],
    extrapolate: "clamp",
  });
  const activeDotScale = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [1, 1.12],
    extrapolate: "clamp",
  });

  const phaseLabel = getActivePhaseLabel(mode);

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.shell,
          {
            backgroundColor: theme.shellBg,
            borderColor: theme.shellBorder,
            paddingHorizontal: shellHorizontalPadding,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={[styles.engineLabel, { color: theme.headerLabel }]}>Peritio Engine</Text>
            <Text style={[styles.engineSubcopy, { color: theme.headerCopy }]}>Live turn state</Text>
          </View>
          <View style={[styles.stateBadge, { backgroundColor: theme.stateBadgeBg, borderColor: theme.stateBadgeBorder }]}>
            <Text style={[styles.stateBadgeText, { color: theme.stateBadgeText }]}>{MODE_LABELS[mode]}</Text>
          </View>
        </View>

        <View
          style={[
            styles.stagePanel,
            {
              backgroundColor: theme.stageBg,
              borderColor: theme.stageBorder,
              paddingHorizontal: stagePanelHorizontalPadding,
            },
          ]}
        >
          <Text style={[styles.stageEyebrow, { color: theme.headerLabel }]}>Current phase</Text>
          <View style={styles.stageCurrentRow}>
            <View style={[styles.activePhaseChip, { backgroundColor: theme.statusChipBg, borderColor: colors.accentSoft }]}>
              <Text style={[styles.activePhaseChipText, { color: colors.accent }]}>{phaseLabel}</Text>
            </View>
            <Text
              style={[
                styles.stageCaption,
                { color: theme.caption },
                compactScreen ? styles.stageCaptionCompact : null,
              ]}
            >
              {MODE_CAPTIONS[mode]}
            </Text>
          </View>

          <View
            style={[
              styles.stageVisual,
              {
                minHeight: visualLayout.stageVisualHeight,
                height: visualLayout.stageVisualHeight,
              },
            ]}
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              setStageVisualWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
            }}
          >
            <View
              style={[
                styles.connector,
                styles.connectorLeft,
                {
                  backgroundColor: colors.accentSoft,
                  width: visualLayout.connectorWidth,
                  left: visualLayout.connectorInset,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.halo,
                {
                  backgroundColor: colors.glow,
                  width: visualLayout.haloDiameter,
                  height: visualLayout.haloDiameter,
                  opacity: haloOpacity,
                  transform: [{ scale: haloScale }],
                },
              ]}
            />
            <View
              style={[
                styles.coreShell,
                {
                  backgroundColor: theme.coreShell,
                  borderColor: theme.coreBorder,
                  borderRadius: visualLayout.coreBorderRadius,
                  height: visualLayout.coreSize,
                  width: visualLayout.coreSize,
                  shadowColor: theme.shadow,
                  shadowRadius: visualLayout.shadowRadius,
                  shadowOffset: { width: 0, height: visualLayout.shadowOffsetY },
                },
              ]}
            >
              <View
                style={[
                  styles.coreGridHorizontal,
                  {
                    backgroundColor: theme.coreGrid,
                    width: visualLayout.coreGridLength,
                  },
                ]}
              />
              <View
                style={[
                  styles.coreGridVertical,
                  {
                    backgroundColor: theme.coreGrid,
                    height: visualLayout.coreGridLength,
                  },
                ]}
              />
              <View
                style={[
                  styles.coreRing,
                  {
                    borderColor: colors.accentSoft,
                    height: visualLayout.outerRingSize,
                    width: visualLayout.outerRingSize,
                  },
                ]}
              />
              <View
                style={[
                  styles.coreRingInner,
                  {
                    borderColor: colors.accent,
                    height: visualLayout.innerRingSize,
                    width: visualLayout.innerRingSize,
                  },
                ]}
              />
              <Animated.View style={[styles.coreDotWrap, { transform: [{ scale: activeDotScale }] }]}>
                <View
                  style={[
                    styles.coreDot,
                    {
                      backgroundColor: colors.accent,
                      height: visualLayout.dotSize,
                      width: visualLayout.dotSize,
                    },
                  ]}
                />
              </Animated.View>
              <View
                style={[
                  styles.coreHighlight,
                  {
                    backgroundColor: colors.highlight,
                    height: visualLayout.highlightSize,
                    right: visualLayout.highlightRight,
                    top: visualLayout.highlightTop,
                    width: visualLayout.highlightSize,
                  },
                ]}
              />
            </View>
            <View
              style={[
                styles.connector,
                styles.connectorRight,
                {
                  backgroundColor: mode === "speaking" ? colors.accentSoft : theme.coreGrid,
                  right: visualLayout.connectorInset,
                  width: visualLayout.connectorWidth,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.stepList}>
          {SIGNAL_STAGES.map((stage, index) => {
            const meta = getSignalStageMeta(mode, stage.key);
            const isActive = meta.state === "active";
            const indicatorStyle =
              meta.state === "complete"
                ? { backgroundColor: colors.accent, borderColor: colors.accent }
                : meta.state === "ready"
                  ? { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }
                  : meta.state === "active"
                    ? { backgroundColor: colors.accent, borderColor: colors.accent }
                    : { backgroundColor: "transparent", borderColor: theme.stepDivider };
            const rowStyle = meta.state === "active" ? { backgroundColor: theme.stepBg } : null;
            const labelColor = meta.state === "upcoming" ? theme.inactiveText : theme.labelText;
            const statusTextColor =
              meta.state === "active"
                ? variant === "dark"
                  ? "#102017"
                  : "#f8f0df"
                : meta.state === "complete"
                  ? colors.accent
                  : theme.caption;
            const statusChipStyle =
              meta.state === "active"
                ? {
                    backgroundColor: colors.accent,
                    borderColor: colors.accent,
                  }
                : null;
            return (
              <View
                key={stage.key}
                style={[
                  styles.stepRow,
                  rowStyle,
                  meta.state === "active" ? { borderColor: colors.accentSoft, borderWidth: 1.25 } : null,
                  index < SIGNAL_STAGES.length - 1 ? { borderBottomColor: theme.stepDivider, borderBottomWidth: StyleSheet.hairlineWidth } : null,
                ]}
              >
                {meta.state === "active" ? <View style={[styles.stepActiveBar, { backgroundColor: colors.accent }]} /> : null}
                <Animated.View style={[styles.stepIndicatorWrap, isActive ? { transform: [{ scale: activeDotScale }] } : null]}>
                  <View style={[styles.stepIndicator, indicatorStyle]} />
                </Animated.View>
                <Text style={[styles.stepLabel, { color: labelColor }, meta.state === "active" ? styles.stepLabelActive : null]}>{stage.label}</Text>
                <View style={[styles.stepStatusChip, { backgroundColor: theme.statusChipBg, borderColor: theme.statusChipBorder }, statusChipStyle]}>
                  <Text style={[styles.stepStatusText, { color: statusTextColor }]}>
                    {meta.status}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 2,
  },
  shell: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  engineLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3,
  },
  engineSubcopy: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  stateBadge: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  stateBadgeText: {
    fontSize: 11.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  stagePanel: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    marginBottom: 12,
  },
  stageEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  stageCurrentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  activePhaseChip: {
    alignSelf: "flex-start",
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  activePhaseChipText: {
    fontSize: 12.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stageCaption: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    minWidth: 180,
    textAlign: "right",
  },
  stageCaptionCompact: {
    minWidth: 0,
    textAlign: "left",
  },
  stageVisual: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    overflow: "hidden",
  },
  connector: {
    position: "absolute",
    top: "50%",
    height: 2,
    marginTop: -1,
    borderRadius: 999,
  },
  connectorLeft: {
    left: 6,
  },
  connectorRight: {
    right: 6,
  },
  halo: {
    position: "absolute",
    borderRadius: 999,
  },
  coreShell: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.12,
    elevation: 4,
  },
  coreGridHorizontal: {
    position: "absolute",
    height: 1,
    borderRadius: 999,
  },
  coreGridVertical: {
    position: "absolute",
    width: 1,
    borderRadius: 999,
  },
  coreRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1,
  },
  coreRingInner: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
  },
  coreDotWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  coreDot: {
    borderRadius: 999,
  },
  coreHighlight: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.72,
  },
  stepList: {
    borderRadius: 18,
    overflow: "hidden",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    overflow: "hidden",
    position: "relative",
  },
  stepActiveBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 999,
  },
  stepIndicatorWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepIndicator: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  stepLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "700",
  },
  stepLabelActive: {
    fontWeight: "800",
  },
  stepStatusChip: {
    minHeight: 26,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepStatusText: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
