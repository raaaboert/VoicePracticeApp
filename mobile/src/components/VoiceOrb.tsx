import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export type OrbMode = "idle" | "recording" | "thinking" | "speaking";

interface VoiceOrbProps {
  mode: OrbMode;
}

const MODE_LABELS: Record<OrbMode, string> = {
  idle: "Ready",
  recording: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const MODE_COLORS: Record<OrbMode, string> = {
  idle: "#5b7aa3",
  recording: "#ff7a59",
  thinking: "#f2b544",
  speaking: "#43c3ff",
};

export function VoiceOrb({ mode }: VoiceOrbProps) {
  const pulseValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulseValue.stopAnimation();
    pulseValue.setValue(1);

    if (mode === "idle") {
      return;
    }

    const peakScale = mode === "recording" ? 1.25 : mode === "thinking" ? 1.14 : 1.2;
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

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.outerRing,
          { borderColor: MODE_COLORS[mode], transform: [{ scale: pulseValue }] },
        ]}
      />
      <View style={[styles.centerOrb, { backgroundColor: MODE_COLORS[mode] }]} />
      <Text style={styles.label}>{MODE_LABELS[mode]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    height: 190,
    width: 190,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  outerRing: {
    position: "absolute",
    width: 174,
    height: 174,
    borderRadius: 87,
    borderWidth: 2.5,
    opacity: 0.8,
  },
  centerOrb: {
    width: 92,
    height: 92,
    borderRadius: 46,
    shadowColor: "#111827",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 10,
  },
  label: {
    position: "absolute",
    bottom: 0,
    color: "#d7e5ff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
