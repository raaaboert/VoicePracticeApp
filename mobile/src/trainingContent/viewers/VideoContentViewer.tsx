import { useEffect } from "react";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { TrainingContentTheme } from "../theme";

interface VideoContentViewerProps {
  url: string;
  headers: Record<string, string>;
  theme: TrainingContentTheme;
  onAccessError: () => void;
}

export function VideoContentViewer({
  url,
  headers,
  theme,
  onAccessError,
}: VideoContentViewerProps) {
  const player = useVideoPlayer(
    { uri: url, headers, useCaching: false, contentType: "progressive" },
    (created) => {
      created.loop = false;
      created.staysActiveInBackground = false;
      created.showNowPlayingNotification = false;
      created.timeUpdateEventInterval = 0.5;
    }
  );
  const status = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
        style={[styles.video, { backgroundColor: theme.mediaBackground }]}
      />
      {status.status === "loading" ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.statusText, { color: theme.muted }]}>Buffering...</Text>
        </View>
      ) : null}
      {status.status === "error" ? (
        <View style={styles.statusRow}>
          <Text style={[styles.errorText, { color: theme.danger }]}>
            This video cannot be played on this device.
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
  root: { gap: 10 },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: 6 },
  statusRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  statusText: { fontSize: 14, lineHeight: 19 },
  errorText: { fontSize: 14, lineHeight: 19, textAlign: "center" },
  retry: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
});
