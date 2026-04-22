import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export type OrbMode = "idle" | "recording" | "thinking" | "speaking";

interface VoiceOrbProps {
  mode: OrbMode;
  variant?: "light" | "dark";
}

type SignalStageKey = "capture" | "process" | "deliver";
type SignalStageState = "idle" | "ready" | "active";

const MODE_LABELS: Record<OrbMode, string> = {
  idle: "Ready",
  recording: "Listening",
  thinking: "Processing",
  speaking: "Responding",
};

const MODE_CAPTIONS: Record<OrbMode, string> = {
  idle: "Waiting for the next turn.",
  recording: "Capturing the live response.",
  thinking: "Building the next reply.",
  speaking: "Delivering the assistant reply.",
};

const SIGNAL_STAGES: Array<{ key: SignalStageKey; label: string }> = [
  { key: "capture", label: "Capture" },
  { key: "process", label: "Process" },
  { key: "deliver", label: "Deliver" },
];

const THEME = {
  light: {
    shellBg: "rgba(252, 249, 242, 0.98)",
    shellBorder: "rgba(97, 116, 97, 0.14)",
    shellInner: "rgba(97, 116, 97, 0.07)",
    headerLabel: "#677362",
    engineChipBg: "rgba(247, 244, 236, 0.94)",
    engineChipBorder: "rgba(97, 116, 97, 0.14)",
    engineChipText: "#4e5f4f",
    stateBadgeBg: "rgba(255, 252, 246, 0.96)",
    stateBadgeBorder: "rgba(97, 116, 97, 0.16)",
    stateBadgeText: "#4f614f",
    stageBg: "rgba(246, 248, 242, 0.94)",
    stageBorder: "rgba(97, 116, 97, 0.12)",
    trackBg: "rgba(96, 114, 96, 0.12)",
    trackReady: "rgba(96, 114, 96, 0.18)",
    inactiveText: "#7a8476",
    caption: "#667264",
    shadow: "#131914",
    coreShell: "rgba(255, 252, 247, 0.98)",
    coreBorder: "rgba(97, 116, 97, 0.12)",
    coreGrid: "rgba(96, 114, 96, 0.16)",
  },
  dark: {
    shellBg: "rgba(20, 27, 21, 0.96)",
    shellBorder: "rgba(244, 231, 206, 0.1)",
    shellInner: "rgba(244, 231, 206, 0.04)",
    headerLabel: "#cfc3ab",
    engineChipBg: "rgba(28, 35, 28, 0.92)",
    engineChipBorder: "rgba(244, 231, 206, 0.09)",
    engineChipText: "#efe3ca",
    stateBadgeBg: "rgba(25, 34, 26, 0.96)",
    stateBadgeBorder: "rgba(244, 231, 206, 0.12)",
    stateBadgeText: "#f6ebd6",
    stageBg: "rgba(24, 32, 25, 0.96)",
    stageBorder: "rgba(244, 231, 206, 0.08)",
    trackBg: "rgba(244, 231, 206, 0.08)",
    trackReady: "rgba(244, 231, 206, 0.12)",
    inactiveText: "#9dab9a",
    caption: "#d5ddcf",
    shadow: "#0e1510",
    coreShell: "rgba(29, 38, 31, 0.98)",
    coreBorder: "rgba(244, 231, 206, 0.08)",
    coreGrid: "rgba(244, 231, 206, 0.12)",
  },
} as const;

const MODE_COLORS = {
  light: {
    idle: {
      accent: "#637b64",
      accentSoft: "rgba(99, 123, 100, 0.2)",
      glow: "rgba(99, 123, 100, 0.14)",
      highlight: "#f3e6ca",
    },
    recording: {
      accent: "#c98566",
      accentSoft: "rgba(201, 133, 102, 0.22)",
      glow: "rgba(201, 133, 102, 0.16)",
      highlight: "#f6ddd0",
    },
    thinking: {
      accent: "#c9a96d",
      accentSoft: "rgba(201, 169, 109, 0.22)",
      glow: "rgba(201, 169, 109, 0.16)",
      highlight: "#f6ead1",
    },
    speaking: {
      accent: "#86a187",
      accentSoft: "rgba(134, 161, 135, 0.22)",
      glow: "rgba(134, 161, 135, 0.16)",
      highlight: "#edf2e8",
    },
  },
  dark: {
    idle: {
      accent: "#8faf93",
      accentSoft: "rgba(143, 175, 147, 0.24)",
      glow: "rgba(143, 175, 147, 0.14)",
      highlight: "#f3e5c6",
    },
    recording: {
      accent: "#d9906f",
      accentSoft: "rgba(217, 144, 111, 0.24)",
      glow: "rgba(217, 144, 111, 0.14)",
      highlight: "#f7dece",
    },
    thinking: {
      accent: "#debe81",
      accentSoft: "rgba(222, 190, 129, 0.24)",
      glow: "rgba(222, 190, 129, 0.16)",
      highlight: "#faecd1",
    },
    speaking: {
      accent: "#a9c3aa",
      accentSoft: "rgba(169, 195, 170, 0.24)",
      glow: "rgba(169, 195, 170, 0.16)",
      highlight: "#eff1e6",
    },
  },
} as const;

function getSignalStageState(mode: OrbMode, stage: SignalStageKey): SignalStageState {
  if (mode === "recording") {
    return stage === "capture" ? "active" : "idle";
  }
  if (mode === "thinking") {
    if (stage === "capture") {
      return "ready";
    }
    return stage === "process" ? "active" : "idle";
  }
  if (mode === "speaking") {
    if (stage === "deliver") {
      return "active";
    }
    return "ready";
  }
  return "ready";
}

export function VoiceOrb({ mode, variant = "dark" }: VoiceOrbProps) {
  const pulseValue = useRef(new Animated.Value(1)).current;
  const theme = THEME[variant];
  const colors = MODE_COLORS[variant][mode];

  useEffect(() => {
    pulseValue.stopAnimation();
    pulseValue.setValue(1);

    if (mode === "idle") {
      return;
    }

    const peakScale = mode === "recording" ? 1.09 : mode === "thinking" ? 1.06 : 1.08;
    const pulseDuration = mode === "recording" ? 520 : mode === "thinking" ? 900 : 680;

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
    outputRange: [1, 1.08],
    extrapolate: "clamp",
  });
  const haloOpacity = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [0.24, 0.08],
    extrapolate: "clamp",
  });
  const coreScale = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [1, 1.04],
    extrapolate: "clamp",
  });
  const activeLineOpacity = pulseValue.interpolate({
    inputRange: [1, 1.1],
    outputRange: [0.9, 0.58],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.wrapper}>
      <View style={[styles.shell, { backgroundColor: theme.shellBg, borderColor: theme.shellBorder }]}>
        <View style={[styles.shellInset, { borderColor: theme.shellInner }]} />
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.engineLabel, { color: theme.headerLabel }]}>Peritio Engine</Text>
            <Text style={[styles.engineSubcopy, { color: theme.inactiveText }]}>Live turn processing</Text>
          </View>
          <View style={[styles.stateBadge, { backgroundColor: theme.stateBadgeBg, borderColor: theme.stateBadgeBorder }]}>
            <Text style={[styles.stateBadgeText, { color: theme.stateBadgeText }]}>{MODE_LABELS[mode]}</Text>
          </View>
        </View>

        <View style={[styles.stagePanel, { backgroundColor: theme.stageBg, borderColor: theme.stageBorder }]}>
          <View style={styles.stageVisual}>
            <Animated.View
              style={[
                styles.halo,
                {
                  backgroundColor: colors.glow,
                  opacity: haloOpacity,
                  transform: [{ scale: haloScale }],
                },
              ]}
            />
            <View style={[styles.stageRail, styles.stageRailLeft, { backgroundColor: theme.coreGrid }]} />
            <View style={[styles.stageRail, styles.stageRailRight, { backgroundColor: theme.coreGrid }]} />
            <Animated.View
              style={[
                styles.coreShell,
                {
                  backgroundColor: theme.coreShell,
                  borderColor: theme.coreBorder,
                  shadowColor: theme.shadow,
                  transform: [{ scale: coreScale }],
                },
              ]}
            >
              <View style={[styles.coreCrossHorizontal, { backgroundColor: theme.coreGrid }]} />
              <View style={[styles.coreCrossVertical, { backgroundColor: theme.coreGrid }]} />
              <View style={[styles.coreRing, { borderColor: colors.accentSoft }]} />
              <View style={[styles.coreRingInner, { borderColor: colors.accent }]} />
              <View style={[styles.coreDot, { backgroundColor: colors.accent }]} />
              <View style={[styles.coreHighlight, { backgroundColor: colors.highlight }]} />
            </Animated.View>
          </View>
        </View>

        <View style={styles.signalPanel}>
          {SIGNAL_STAGES.map((stage) => {
            const stageState = getSignalStageState(mode, stage.key);
            const fillWidth = stageState === "active" ? "84%" : stageState === "ready" ? "58%" : "28%";
            const fillOpacityStyle = stageState === "active" ? { opacity: activeLineOpacity } : { opacity: stageState === "ready" ? 0.88 : 0.42 };
            const dotColor = stageState === "active" ? colors.accent : stageState === "ready" ? colors.accentSoft : theme.trackReady;
            const labelColor = stageState === "idle" ? theme.inactiveText : theme.stateBadgeText;
            return (
              <View key={stage.key} style={styles.signalRow}>
                <Text style={[styles.signalLabel, { color: labelColor }]}>{stage.label}</Text>
                <View style={[styles.signalTrack, { backgroundColor: theme.trackBg }]}>
                  <Animated.View
                    style={[
                      styles.signalFill,
                      fillOpacityStyle,
                      {
                        width: fillWidth,
                        backgroundColor: stageState === "active" ? colors.accent : stageState === "ready" ? colors.accentSoft : theme.trackReady,
                      },
                    ]}
                  />
                </View>
                <View style={[styles.signalDot, { backgroundColor: dotColor }]} />
              </View>
            );
          })}
        </View>

        <Text style={[styles.caption, { color: theme.caption }]}>{MODE_CAPTIONS[mode]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    alignSelf: "center",
    marginVertical: 2,
  },
  shell: {
    width: "100%",
    maxWidth: 292,
    minHeight: 286,
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  shellInset: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 22,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  engineLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    marginBottom: 2,
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
    minHeight: 150,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  stageVisual: {
    width: 196,
    height: 146,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 144,
    height: 144,
    borderRadius: 999,
  },
  stageRail: {
    position: "absolute",
    top: 72,
    width: 38,
    height: 2,
    borderRadius: 999,
  },
  stageRailLeft: {
    left: 18,
  },
  stageRailRight: {
    right: 18,
  },
  coreShell: {
    width: 102,
    height: 102,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 9 },
    elevation: 5,
  },
  coreCrossHorizontal: {
    position: "absolute",
    width: 52,
    height: 1,
    borderRadius: 999,
  },
  coreCrossVertical: {
    position: "absolute",
    width: 1,
    height: 52,
    borderRadius: 999,
  },
  coreRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 999,
    borderWidth: 1,
  },
  coreRingInner: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 2,
  },
  coreDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
  },
  coreHighlight: {
    position: "absolute",
    top: 24,
    right: 26,
    width: 10,
    height: 10,
    borderRadius: 999,
    opacity: 0.7,
  },
  signalPanel: {
    gap: 10,
    marginBottom: 14,
  },
  signalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  signalLabel: {
    width: 56,
    fontSize: 12,
    fontWeight: "700",
  },
  signalTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  signalFill: {
    height: "100%",
    borderRadius: 999,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },
});
