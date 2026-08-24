import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  clampImageTranslation,
  clampImageZoomScale,
  fitImageWithinViewport,
  getImageViewerTransform,
  type ImageSize,
} from "../imageZoomModel";
import type { TrainingContentTheme } from "../theme";

interface ImageContentViewerProps {
  url: string;
  headers: Record<string, string>;
  theme: TrainingContentTheme;
  onAccessError: () => void;
}

function FullScreenImageSafeArea({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.fullScreenSafeArea,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {children}
    </View>
  );
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
  const zoomScale = useSharedValue(1);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const fittedWidth = useSharedValue(0);
  const fittedHeight = useSharedValue(0);
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

  const resetZoom = useCallback(() => {
    zoomScale.value = 1;
    translationX.value = 0;
    translationY.value = 0;
    pinchStartScale.value = 1;
    panStartX.value = 0;
    panStartY.value = 0;
  }, [panStartX, panStartY, pinchStartScale, translationX, translationY, zoomScale]);

  useEffect(() => {
    viewportWidth.value = viewportDimensions.width;
    viewportHeight.value = viewportDimensions.height;
    fittedWidth.value = fittedDimensions.width;
    fittedHeight.value = fittedDimensions.height;
    resetZoom();
  }, [
    fittedDimensions.height,
    fittedDimensions.width,
    fittedHeight,
    fittedWidth,
    resetZoom,
    viewportDimensions.height,
    viewportDimensions.width,
    viewportHeight,
    viewportWidth,
  ]);

  const imageGesture = useMemo(() => {
    const clampCurrentTranslation = () => {
      "worklet";
      const boundedTranslation = clampImageTranslation({
        translation: { x: translationX.value, y: translationY.value },
        fittedImage: { width: fittedWidth.value, height: fittedHeight.value },
        viewport: { width: viewportWidth.value, height: viewportHeight.value },
        scale: zoomScale.value,
      });
      translationX.value = boundedTranslation.x;
      translationY.value = boundedTranslation.y;
    };

    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinchStartScale.value = zoomScale.value;
      })
      .onUpdate((event) => {
        zoomScale.value = clampImageZoomScale(pinchStartScale.value * event.scale);
        clampCurrentTranslation();
      })
      .onFinalize(() => {
        zoomScale.value = clampImageZoomScale(zoomScale.value);
        clampCurrentTranslation();
      });

    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        panStartX.value = translationX.value;
        panStartY.value = translationY.value;
      })
      .onUpdate((event) => {
        const boundedTranslation = clampImageTranslation({
          translation: {
            x: panStartX.value + event.translationX,
            y: panStartY.value + event.translationY,
          },
          fittedImage: { width: fittedWidth.value, height: fittedHeight.value },
          viewport: { width: viewportWidth.value, height: viewportHeight.value },
          scale: zoomScale.value,
        });
        translationX.value = boundedTranslation.x;
        translationY.value = boundedTranslation.y;
      })
      .onFinalize(clampCurrentTranslation);

    return Gesture.Simultaneous(pinch, pan);
  }, [
    fittedHeight,
    fittedWidth,
    panStartX,
    panStartY,
    pinchStartScale,
    translationX,
    translationY,
    viewportHeight,
    viewportWidth,
    zoomScale,
  ]);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: getImageViewerTransform(zoomScale.value, {
      x: translationX.value,
      y: translationY.value,
    }),
  }));

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
        accessibilityLabel="Learning Resource image"
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
        <GestureHandlerRootView style={styles.fullScreenRoot}>
          <SafeAreaProvider style={styles.fullScreenRoot}>
            <FullScreenImageSafeArea>
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
              <GestureDetector gesture={imageGesture}>
                <View
                  style={styles.gestureSurface}
                  onLayout={(event) => {
                    const nextViewport = {
                      width: event.nativeEvent.layout.width,
                      height: event.nativeEvent.layout.height,
                    };
                    setViewportDimensions(nextViewport);
                    resetZoom();
                  }}
                >
                  {fittedDimensions.width > 0 && fittedDimensions.height > 0 ? (
                    <Animated.View
                      style={[
                        {
                          width: fittedDimensions.width,
                          height: fittedDimensions.height,
                        },
                        animatedImageStyle,
                      ]}
                    >
                      <Image
                        source={{ uri: url, headers }}
                        resizeMode="contain"
                        style={styles.fullScreenImage}
                        onError={() => {
                          setFullScreenVisible(false);
                          setError(true);
                        }}
                        accessibilityLabel="Enlarged Learning Resource image"
                      />
                    </Animated.View>
                  ) : null}
                </View>
              </GestureDetector>
              <Text style={styles.gestureHint}>Pinch to zoom. Drag to pan.</Text>
            </FullScreenImageSafeArea>
          </SafeAreaProvider>
        </GestureHandlerRootView>
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
  fullScreenSafeArea: { flex: 1 },
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
