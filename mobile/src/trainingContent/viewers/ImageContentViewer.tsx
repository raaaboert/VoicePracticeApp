import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

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
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState(false);
  const availableWidth = Math.max(240, width - 32);

  useEffect(() => {
    setDimensions(null);
    setError(false);
    Image.getSizeWithHeaders(
      url,
      headers,
      (imageWidth, imageHeight) => {
        const ratio = imageHeight > 0 ? imageHeight / imageWidth : 1;
        setDimensions({
          width: availableWidth,
          height: Math.min(1_800, Math.max(180, availableWidth * ratio)),
        });
      },
      () => setError(true)
    );
  }, [availableWidth, headers, url]);

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
  if (!dimensions) {
    return <ActivityIndicator color={theme.accent} />;
  }
  return (
    <View style={[styles.frame, { backgroundColor: theme.mediaBackground }]}>
      <Image
        source={{ uri: url, headers }}
        resizeMode="contain"
        style={dimensions}
        onError={() => setError(true)}
        accessibilityLabel="Training Content image"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", overflow: "hidden", borderRadius: 6 },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  error: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  retry: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
});
