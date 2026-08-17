import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  clampImageTranslation,
  clampImageZoomScale,
  createImageGestureBaseline,
  fitImageWithinViewport,
  getImageViewerTransform,
  updateImageGesture,
  type ImageGestureBaseline,
  type ImageSize,
  type ImageTranslation,
} from "../imageZoomModel";
import type { TrainingContentTheme } from "../theme";

interface ImageContentViewerProps {
  url: string;
  headers: Record<string, string>;
  theme: TrainingContentTheme;
  onAccessError: () => void;
}

export function ImageContentViewer({
  url,
  headers,
  theme,
  onAccessError,
}: ImageContentViewerProps) {
  const { width } = useWindowDimensions();
  const [intrinsicDimensions, setIntrinsicDimensions] = useState<ImageSize | null>(null);
  const [error, setError] = useState(false);
  const [fullScreenVisible, setFullScreenVisible] = useState(false);
  const [viewportDimensions, setViewportDimensions] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoomScale, setZoomScale] = useState(1);
  const [translation, setTranslation] = useState<ImageTranslation>({ x: 0, y: 0 });
  const zoomScaleRef = useRef(zoomScale);
  const translationRef = useRef(translation);
  const viewportDimensionsRef = useRef(viewportDimensions);
  const fittedDimensionsRef = useRef<ImageSize>({ width: 0, height: 0 });
  const gestureStartRef = useRef<ImageGestureBaseline>({
    scale: 1,
    translation: { x: 0, y: 0 },
    distance: null,
    midpoint: null,
    gestureDx: 0,
    gestureDy: 0,
  });
  const availableWidth = Math.max(240, width - 32);
  const inlineDimensions = intrinsicDimensions
    ? {
        width: availableWidth,
        height: Math.min(
          1_800,
          Math.max(180, availableWidth * (intrinsicDimensions.height / intrinsicDimensions.width)),
        ),
      }
    : null;
  const fittedDimensions = intrinsicDimensions
    ? fitImageWithinViewport(intrinsicDimensions, viewportDimensions)
    : { width: 0, height: 0 };

  zoomScaleRef.current = zoomScale;
  translationRef.current = translation;
  viewportDimensionsRef.current = viewportDimensions;
  fittedDimensionsRef.current = fittedDimensions;

  const applyTransform = (scale: number, nextTranslation: ImageTranslation) => {
    const boundedScale = clampImageZoomScale(scale);
    const boundedTranslation = clampImageTranslation({
      translation: nextTranslation,
      fittedImage: fittedDimensionsRef.current,
      viewport: viewportDimensionsRef.current,
      scale: boundedScale,
    });
    zoomScaleRef.current = boundedScale;
    translationRef.current = boundedTranslation;
    setZoomScale(boundedScale);
    setTranslation(boundedTranslation);
  };

  const resetZoom = () => {
    applyTransform(1, { x: 0, y: 0 });
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => (
      event.nativeEvent.touches.length >= 2 || zoomScaleRef.current > 1
    ),
    onMoveShouldSetPanResponder: (event, gestureState) => (
      event.nativeEvent.touches.length >= 2
      || (
        zoomScaleRef.current > 1
        && (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2)
      )
    ),
    onPanResponderGrant: (event, gestureState) => {
      gestureStartRef.current = createImageGestureBaseline({
        scale: zoomScaleRef.current,
        translation: translationRef.current,
        touches: event.nativeEvent.touches,
        gestureDx: gestureState.dx,
        gestureDy: gestureState.dy,
      });
    },
    onPanResponderMove: (event, gestureState) => {
      const update = updateImageGesture({
        baseline: gestureStartRef.current,
        currentScale: zoomScaleRef.current,
        currentTranslation: translationRef.current,
        touches: event.nativeEvent.touches,
        gestureDx: gestureState.dx,
        gestureDy: gestureState.dy,
      });
      gestureStartRef.current = update.baseline;
      if (update.transform) {
        applyTransform(update.transform.scale, update.transform.translation);
      }
    },
    onPanResponderRelease: () => {
      applyTransform(zoomScaleRef.current, translationRef.current);
    },
    onPanResponderTerminate: () => {
      applyTransform(zoomScaleRef.current, translationRef.current);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  useEffect(() => {
    setIntrinsicDimensions(null);
    setError(false);
    setFullScreenVisible(false);
    resetZoom();
    Image.getSizeWithHeaders(
      url,
      headers,
      (imageWidth, imageHeight) => {
        setIntrinsicDimensions({ width: imageWidth, height: imageHeight });
      },
      () => setError(true)
    );
  }, [headers, url]);

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={[styles.error, { color: theme.danger }]}>
          This image could not be displayed.
        </Text>
        <Text style={[styles.retry, { color: theme.accent }]} onPress={onAccessError}>
          Refresh access
        </Text>
      </View>
    );
  }
  if (!inlineDimensions || !intrinsicDimensions) {
    return <ActivityIndicator color={theme.accent} />;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Training Content image"
        accessibilityHint="Opens a full-screen image viewer"
        style={[styles.frame, { backgroundColor: theme.mediaBackground }]}
        onPress={() => {
          resetZoom();
          setFullScreenVisible(true);
        }}
      >
        <Image
          source={{ uri: url, headers }}
          resizeMode="contain"
          style={inlineDimensions}
          onError={() => setError(true)}
        />
        <View style={styles.expandBadge} pointerEvents="none">
          <MaterialCommunityIcons name="arrow-expand" size={17} color="#ffffff" />
          <Text style={styles.expandBadgeText}>View full screen</Text>
        </View>
      </Pressable>
      <Modal
        visible={fullScreenVisible}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullScreenVisible(false)}
      >
        <SafeAreaView style={styles.fullScreenRoot} edges={["top", "bottom"]}>
          <View style={styles.fullScreenHeader}>
            <Text style={styles.fullScreenTitle}>Image</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close image viewer"
              style={styles.closeButton}
              onPress={() => setFullScreenVisible(false)}
            >
              <MaterialCommunityIcons name="close" size={24} color="#ffffff" />
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
          <View
            style={styles.gestureSurface}
            onLayout={(event) => {
              const nextViewport = {
                width: event.nativeEvent.layout.width,
                height: event.nativeEvent.layout.height,
              };
              viewportDimensionsRef.current = nextViewport;
              setViewportDimensions(nextViewport);
              resetZoom();
            }}
            {...panResponder.panHandlers}
          >
            {fittedDimensions.width > 0 && fittedDimensions.height > 0 ? (
              <View
                style={{
                  width: fittedDimensions.width,
                  height: fittedDimensions.height,
                  transform: getImageViewerTransform(zoomScale, translation),
                }}
              >
                <Image
                  source={{ uri: url, headers }}
                  resizeMode="contain"
                  style={styles.fullScreenImage}
                  onError={() => {
                    setFullScreenVisible(false);
                    setError(true);
                  }}
                  accessibilityLabel="Enlarged Training Content image"
                />
              </View>
            ) : null}
          </View>
          <Text style={styles.gestureHint}>Pinch to zoom. Drag to pan.</Text>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", overflow: "hidden", borderRadius: 6 },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  error: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  retry: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  expandBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },
  expandBadgeText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  fullScreenRoot: { flex: 1, backgroundColor: "#000000" },
  fullScreenHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.22)",
  },
  fullScreenTitle: { color: "#ffffff", fontSize: 17, fontWeight: "800" },
  closeButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  closeButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  gestureSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fullScreenImage: { width: "100%", height: "100%" },
  gestureHint: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
