import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  buildProgressiveVideoSource,
  NATIVE_VIEWER_LOAD_TIMEOUT_MS,
} from "../nativeViewerLifecycle";
import type { TrainingContentTheme } from "../theme";
import {
  buildVideoDiagnosticRows,
  createInitialVideoDiagnosticSnapshot,
  type VideoDiagnosticSnapshot,
} from "../videoDiagnosticPanel";
import {
  getValidatedVideoAspectRatio,
  VIDEO_ASPECT_RATIO_FALLBACK,
} from "../videoLayout";
import {
  recordTrainingContentViewerDiagnostic,
  shouldRecordTrainingContentViewerDiagnostics,
} from "../viewerDiagnostics";

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
  const [videoAspectRatio, setVideoAspectRatio] = useState(
    VIDEO_ASPECT_RATIO_FALLBACK
  );
  const diagnosticsEnabled =
    shouldRecordTrainingContentViewerDiagnostics(
      typeof __DEV__ !== "undefined" && __DEV__,
      process.env.EXPO_PUBLIC_API_BASE_URL
    );
  const [diagnosticSnapshot, setDiagnosticSnapshot] =
    useState<VideoDiagnosticSnapshot>(() =>
      createInitialVideoDiagnosticSnapshot(VIDEO_ASPECT_RATIO_FALLBACK)
    );
  const videoWrapperRef = useRef<View | null>(null);
  const diagnosticPanelRef = useRef<View | null>(null);
  const sourceLoadFired = useRef(false);
  const waitingForPlayback = status.status === "idle" || status.status === "loading";
  const measureDiagnosticPageY = useCallback(
    (
      target: View | null,
      field: "wrapperPageY" | "diagnosticPanelPageY"
    ) => {
      if (!diagnosticsEnabled || !target) {
        return;
      }
      target.measureInWindow((_pageX, pageY) => {
        if (!Number.isFinite(pageY)) {
          return;
        }
        setDiagnosticSnapshot((current) =>
          current[field] === pageY
            ? current
            : { ...current, [field]: pageY }
        );
      });
    },
    [diagnosticsEnabled]
  );

  useEventListener(player, "sourceLoad", ({ availableVideoTracks }) => {
    const size = availableVideoTracks.find(
      (track) => getValidatedVideoAspectRatio(track.size) !== null
    )?.size;
    const reportedSize = size ?? availableVideoTracks[0]?.size;
    const calculatedAspectRatio =
      getValidatedVideoAspectRatio(size) ?? VIDEO_ASPECT_RATIO_FALLBACK;
    sourceLoadFired.current = true;
    recordTrainingContentViewerDiagnostic("video_source_load", {
      platform: Platform.OS,
      sourceLoadFired: true,
      trackCount: availableVideoTracks.length,
      width: reportedSize?.width,
      height: reportedSize?.height,
      aspectRatio: calculatedAspectRatio,
    });
    if (diagnosticsEnabled) {
      setDiagnosticSnapshot((current) => ({
        ...current,
        sourceLoadFired: true,
        trackCount: availableVideoTracks.length,
        reportedWidth: reportedSize?.width ?? null,
        reportedHeight: reportedSize?.height ?? null,
        calculatedAspectRatio,
      }));
    }
    if (size) {
      setVideoAspectRatio(
        getValidatedVideoAspectRatio(size) ?? VIDEO_ASPECT_RATIO_FALLBACK
      );
      recordTrainingContentViewerDiagnostic("video_track_dimensions", size);
    } else {
      setVideoAspectRatio(VIDEO_ASPECT_RATIO_FALLBACK);
    }
  });

  useEffect(() => {
    sourceLoadFired.current = false;
    recordTrainingContentViewerDiagnostic("video_source_load", {
      platform: Platform.OS,
      sourceLoadFired: false,
      trackCount: 0,
      aspectRatio: VIDEO_ASPECT_RATIO_FALLBACK,
    });
    if (diagnosticsEnabled) {
      setDiagnosticSnapshot(
        createInitialVideoDiagnosticSnapshot(VIDEO_ASPECT_RATIO_FALLBACK)
      );
    }
    setVideoAspectRatio(VIDEO_ASPECT_RATIO_FALLBACK);
  }, [diagnosticsEnabled, source]);

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
      <View
        ref={videoWrapperRef}
        style={[styles.videoFrame, { aspectRatio: videoAspectRatio }]}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          recordTrainingContentViewerDiagnostic(
            "video_surface_layout",
            {
              platform: Platform.OS,
              aspectRatio: videoAspectRatio,
              width,
              height,
            }
          );
          if (diagnosticsEnabled) {
            setDiagnosticSnapshot((current) => ({
              ...current,
              wrapperWidth: width,
              wrapperHeight: height,
            }));
          }
          measureDiagnosticPageY(videoWrapperRef.current, "wrapperPageY");
        }}
      >
        <VideoView
          player={player}
          nativeControls
          contentFit="contain"
          contentPosition={{ dx: 0, dy: 0 }}
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture={false}
          onFirstFrameRender={() => {
            const firedBeforeFirstFrame = sourceLoadFired.current;
            recordTrainingContentViewerDiagnostic("video_first_frame_rendered", {
              platform: Platform.OS,
              sourceLoadFired: firedBeforeFirstFrame,
            });
            if (diagnosticsEnabled) {
              setDiagnosticSnapshot((current) => ({
                ...current,
                sourceLoadBeforeFirstFrame: firedBeforeFirstFrame,
              }));
            }
          }}
          onLayout={({ nativeEvent }) => {
            const { width, height } = nativeEvent.layout;
            recordTrainingContentViewerDiagnostic("video_view_layout", {
              platform: Platform.OS,
              aspectRatio: videoAspectRatio,
              width,
              height,
            });
            if (diagnosticsEnabled) {
              setDiagnosticSnapshot((current) => ({
                ...current,
                videoViewWidth: width,
                videoViewHeight: height,
              }));
            }
          }}
          style={styles.videoSurface}
        />
      </View>
      {diagnosticsEnabled ? (
        <VideoDiagnosticPanel
          platform={Platform.OS}
          activeAspectRatio={videoAspectRatio}
          snapshot={diagnosticSnapshot}
          theme={theme}
          panelRef={diagnosticPanelRef}
          onLayout={() => {
            measureDiagnosticPageY(
              diagnosticPanelRef.current,
              "diagnosticPanelPageY"
            );
          }}
        />
      ) : null}
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

function VideoDiagnosticPanel({
  platform,
  activeAspectRatio,
  snapshot,
  theme,
  panelRef,
  onLayout,
}: {
  platform: string;
  activeAspectRatio: number;
  snapshot: VideoDiagnosticSnapshot;
  theme: TrainingContentTheme;
  panelRef: RefObject<View | null>;
  onLayout: () => void;
}) {
  const rows = buildVideoDiagnosticRows(
    platform,
    activeAspectRatio,
    snapshot
  );

  return (
    <View
      ref={panelRef}
      accessibilityLabel="Video diagnostics"
      onLayout={onLayout}
      style={[
        styles.diagnosticPanel,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.diagnosticTitle, { color: theme.text }]}>
        Video diagnostics
      </Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.diagnosticRow}>
          <Text style={[styles.diagnosticLabel, { color: theme.muted }]}>
            {row.label}
          </Text>
          <Text style={[styles.diagnosticValue, { color: theme.text }]}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  videoFrame: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 6,
    backgroundColor: "#000000",
  },
  videoSurface: {
    width: "100%",
    height: "100%",
    alignSelf: "center",
    backgroundColor: "#000000",
  },
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
  diagnosticPanel: {
    gap: 3,
    padding: 9,
    borderWidth: 1,
    borderRadius: 6,
  },
  diagnosticTitle: {
    marginBottom: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  diagnosticRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  diagnosticLabel: { flex: 1, fontSize: 11, lineHeight: 15 },
  diagnosticValue: {
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
  },
});
