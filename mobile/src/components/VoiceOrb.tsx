import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export type OrbMode = "idle" | "recording" | "thinking" | "speaking";

interface VoiceOrbProps {
  mode: OrbMode;
  variant?: "light" | "dark";
}

const MODE_LABELS: Record<OrbMode, string> = {
  idle: "Ready",
  recording: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const MODE_CAPTIONS: Record<OrbMode, string> = {
  idle: "The session is ready for the next turn.",
  recording: "Your response is being captured live.",
  thinking: "The next reply is being prepared now.",
  speaking: "The AI response is actively delivering.",
};

const ORB_THEME = {
  light: {
    shellBg: "rgba(252, 249, 242, 0.92)",
    shellBorder: "rgba(112, 128, 110, 0.14)",
    frame: "rgba(91, 111, 92, 0.18)",
    frameSoft: "rgba(91, 111, 92, 0.09)",
    rail: "rgba(224, 205, 171, 0.3)",
    caption: "#687466",
    badgeBg: "rgba(255, 250, 242, 0.94)",
    badgeBorder: "rgba(113, 127, 111, 0.14)",
    badgeText: "#4d5f4f",
    coreShell: "rgba(255, 252, 246, 0.98)",
    coreBorder: "rgba(91, 111, 92, 0.12)",
    shadow: "#121813",
  },
  dark: {
    shellBg: "rgba(23, 31, 24, 0.9)",
    shellBorder: "rgba(244, 231, 206, 0.1)",
    frame: "rgba(244, 231, 206, 0.14)",
    frameSoft: "rgba(244, 231, 206, 0.06)",
    rail: "rgba(224, 205, 171, 0.3)",
    caption: "#d7dece",
    badgeBg: "rgba(28, 36, 29, 0.92)",
    badgeBorder: "rgba(244, 231, 206, 0.1)",
    badgeText: "#f6ecd7",
    coreShell: "rgba(29, 39, 31, 0.96)",
    coreBorder: "rgba(244, 231, 206, 0.08)",
    shadow: "#0f1510",
  },
} as const;

const MODE_COLORS = {
  light: {
    idle: { accent: "#667e69", accentSoft: "rgba(102, 126, 105, 0.22)", glow: "rgba(102, 126, 105, 0.16)", highlight: "#f3e6ca" },
    recording: { accent: "#c77c5c", accentSoft: "rgba(199, 124, 92, 0.2)", glow: "rgba(199, 124, 92, 0.16)", highlight: "#f4d8ca" },
    thinking: { accent: "#d1b27a", accentSoft: "rgba(209, 178, 122, 0.22)", glow: "rgba(209, 178, 122, 0.16)", highlight: "#f6ead0" },
    speaking: { accent: "#8ea990", accentSoft: "rgba(142, 169, 144, 0.24)", glow: "rgba(142, 169, 144, 0.16)", highlight: "#eef3e7" },
  },
  dark: {
    idle: { accent: "#8caf93", accentSoft: "rgba(140, 175, 147, 0.24)", glow: "rgba(140, 175, 147, 0.16)", highlight: "#f4e6c8" },
    recording: { accent: "#d58a69", accentSoft: "rgba(213, 138, 105, 0.22)", glow: "rgba(213, 138, 105, 0.16)", highlight: "#f6d9cc" },
    thinking: { accent: "#e0bf83", accentSoft: "rgba(224, 191, 131, 0.24)", glow: "rgba(224, 191, 131, 0.16)", highlight: "#faedd5" },
    speaking: { accent: "#a7c1a5", accentSoft: "rgba(167, 193, 165, 0.24)", glow: "rgba(167, 193, 165, 0.16)", highlight: "#f1eadc" },
  },
} as const;

export function VoiceOrb({ mode, variant = "dark" }: VoiceOrbProps) {
  const pulseValue = useRef(new Animated.Value(1)).current;
  const theme = ORB_THEME[variant];
  const colors = MODE_COLORS[variant][mode];

  useEffect(() => {
    pulseValue.stopAnimation();
    pulseValue.setValue(1);

    if (mode === "idle") {
      return;
    }

    const peakScale = mode === "recording" ? 1.2 : mode === "thinking" ? 1.12 : 1.15;
    const pulseDuration = mode === "recording" ? 560 : mode === "thinking" ? 900 : 650;

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

  const ringScale = pulseValue.interpolate({
    inputRange: [1, 1.2],
    outputRange: [1, 1.12],
    extrapolate: "clamp",
  });
  const glowScale = pulseValue.interpolate({
    inputRange: [1, 1.2],
    outputRange: [1, 1.18],
    extrapolate: "clamp",
  });
  const glowOpacity = pulseValue.interpolate({
    inputRange: [1, 1.2],
    outputRange: [0.28, 0.12],
    extrapolate: "clamp",
  });
  const coreScale = pulseValue.interpolate({
    inputRange: [1, 1.2],
    outputRange: [1, 1.05],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.wrapper}>
      <View style={[styles.shell, { backgroundColor: theme.shellBg, borderColor: theme.shellBorder }]}>
        <View style={[styles.frameOuter, { borderColor: theme.frame }]} />
        <View style={[styles.frameInner, { borderColor: theme.frameSoft }]} />
        <View style={[styles.leftRail, { backgroundColor: theme.rail }]} />
        <View style={[styles.leftRailShort, { backgroundColor: theme.rail }]} />
        <View style={[styles.rightRail, { backgroundColor: theme.rail }]} />

        <View style={[styles.stateBadge, { backgroundColor: theme.badgeBg, borderColor: theme.badgeBorder }]}>
          <Text style={[styles.stateBadgeText, { color: theme.badgeText }]}>{MODE_LABELS[mode]}</Text>
        </View>

        <Animated.View
          style={[
            styles.glow,
            {
              backgroundColor: colors.glow,
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.outerRing,
            { borderColor: colors.accentSoft, transform: [{ scale: ringScale }] },
          ]}
        />
        <Animated.View
          style={[
            styles.innerRing,
            { borderColor: colors.accent, transform: [{ scale: ringScale }] },
          ]}
        />
        <Animated.View style={[styles.coreShell, { backgroundColor: theme.coreShell, borderColor: theme.coreBorder, shadowColor: theme.shadow, transform: [{ scale: coreScale }] }]}>
          <View style={[styles.coreOrb, { backgroundColor: colors.accent }]} />
          <View style={[styles.coreHighlight, { backgroundColor: colors.highlight }]} />
        </Animated.View>

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
    maxWidth: 260,
    minHeight: 252,
    borderRadius: 30,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 20,
    paddingBottom: 18,
  },
  frameOuter: {
    position: "absolute",
    top: 16,
    left: 22,
    right: 22,
    bottom: 16,
    borderRadius: 26,
    borderWidth: 1,
  },
  frameInner: {
    position: "absolute",
    top: 28,
    left: 34,
    right: 34,
    bottom: 28,
    borderRadius: 22,
    borderWidth: 1,
  },
  leftRail: {
    position: "absolute",
    left: 22,
    top: 70,
    width: 2,
    height: 104,
    borderRadius: 999,
  },
  leftRailShort: {
    position: "absolute",
    left: 30,
    top: 92,
    width: 2,
    height: 62,
    borderRadius: 999,
  },
  rightRail: {
    position: "absolute",
    right: 24,
    top: 56,
    width: 2,
    height: 92,
    borderRadius: 999,
  },
  stateBadge: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  stateBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.3,
  },
  glow: {
    position: "absolute",
    top: 68,
    width: 150,
    height: 150,
    borderRadius: 999,
  },
  outerRing: {
    position: "absolute",
    top: 78,
    width: 138,
    height: 138,
    borderRadius: 999,
    borderWidth: 1,
  },
  innerRing: {
    position: "absolute",
    top: 88,
    width: 118,
    height: 118,
    borderRadius: 999,
    borderWidth: 2,
  },
  coreShell: {
    width: 94,
    height: 94,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
    marginBottom: 62,
  },
  coreOrb: {
    width: 48,
    height: 48,
    borderRadius: 999,
  },
  coreHighlight: {
    position: "absolute",
    top: 22,
    width: 12,
    height: 12,
    borderRadius: 999,
    opacity: 0.72,
  },
  caption: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 180,
  },
});
