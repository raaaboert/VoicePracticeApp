import { useEffect, useMemo, useState } from "react";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  buildProgressiveVideoSource,
  NATIVE_VIEWER_LOAD_TIMEOUT_MS,
} from "../nativeViewerLifecycle";
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
  const source = useMemo(
    () => buildProgressiveVideoSource(url, headers),
    [headers, url]
  );
  const player = useVideoPlayer(
    source,
    (created) => {
      created.loop = false;
      created.staysActiveInBackground = false;
      created.showNowPlayingNotification = false;
      created.timeUpdateEventInterval = 0.5;
    }
  );
  const status = useEvent(player, "statusChange", { status: player.status });
  const [timedOut, setTimedOut] = useState(false);
  const waitingForPlayback = status.status === "idle" || status.status === "loading";

  useEffect(() => {
    setTimedOut(false);
    if (!waitingForPlayback) {
      return;
    }
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, NATIVE_VIEWER_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [source, waitingForPlayback]);

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
      {waitingForPlayback && !timedOut ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.statusText, { color: theme.muted }]}>Buffering...</Text>
        </View>
      ) : null}
      {status.status === "error" || timedOut ? (
        <View style={styles.statusRow}>
          <Text style={[styles.errorText, { color: theme.danger }]}>
            {timedOut
              ? "This video is taking too long to load."
              : "This video cannot be played on this device."}
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
