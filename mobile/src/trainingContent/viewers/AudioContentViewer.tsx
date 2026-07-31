import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TrainingContentTheme } from "../theme";

interface AudioContentViewerProps {
  url: string;
  headers: Record<string, string>;
  theme: TrainingContentTheme;
  onAccessError: () => void;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function AudioContentViewer({
  url,
  headers,
  theme,
  onAccessError,
}: AudioContentViewerProps) {
  const player = useAudioPlayer(
    { uri: url, headers },
    { updateInterval: 300, downloadFirst: false, keepAudioSessionActive: false }
  );
  const status = useAudioPlayerStatus(player);
  const failed = status.playbackState.toLocaleLowerCase().includes("error");

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rewind 15 seconds"
          style={[styles.iconButton, { backgroundColor: theme.surfaceStrong }]}
          onPress={() => {
            void player.seekTo(Math.max(0, status.currentTime - 15));
          }}
        >
          <MaterialCommunityIcons name="rewind-15" size={25} color={theme.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause" : "Play"}
          style={[styles.playButton, { backgroundColor: theme.accent }]}
          onPress={() => status.playing ? player.pause() : player.play()}
        >
          <MaterialCommunityIcons
            name={status.playing ? "pause" : "play"}
            size={29}
            color={theme.accentText}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward 15 seconds"
          style={[styles.iconButton, { backgroundColor: theme.surfaceStrong }]}
          onPress={() => {
            void player.seekTo(Math.min(status.duration || Infinity, status.currentTime + 15));
          }}
        >
          <MaterialCommunityIcons name="fast-forward-15" size={25} color={theme.text} />
        </Pressable>
      </View>
      <View style={[styles.track, { backgroundColor: theme.surfaceStrong }]}>
        <View
          style={[
            styles.progress,
            {
              backgroundColor: theme.secondary,
              width: `${
                status.duration > 0
                  ? Math.min(100, (status.currentTime / status.duration) * 100)
                  : 0
              }%`,
            },
          ]}
        />
      </View>
      <View style={styles.timeRow}>
        <Text style={[styles.time, { color: theme.muted }]}>
          {formatTime(status.currentTime)}
        </Text>
        <Text style={[styles.time, { color: theme.muted }]}>
          {formatTime(status.duration)}
        </Text>
      </View>
      {status.isBuffering ? (
        <Text style={[styles.status, { color: theme.muted }]}>Buffering...</Text>
      ) : null}
      {failed ? (
        <View style={styles.errorRow}>
          <Text style={[styles.status, { color: theme.danger }]}>
            This audio cannot be played on this device.
          </Text>
          <Text style={[styles.retry, { color: theme.accent }]} onPress={onAccessError}>
            Refresh access
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 16, borderWidth: 1, borderRadius: 6, gap: 12 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  progress: { height: 6, borderRadius: 3 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  time: { fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  status: { fontSize: 14, lineHeight: 19, textAlign: "center" },
  errorRow: { alignItems: "center", gap: 6 },
  retry: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
});
