import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Pdf from "react-native-pdf";

import { confirmAndOpenExternalLink } from "../externalLinks";
import type { TrainingContentTheme } from "../theme";

interface PdfContentViewerProps {
  url: string;
  headers: Record<string, string>;
  theme: TrainingContentTheme;
  onAccessError: () => void;
}

export function PdfContentViewer({
  url,
  headers,
  theme,
  onAccessError,
}: PdfContentViewerProps) {
  const { height } = useWindowDimensions();
  const [error, setError] = useState(false);
  const [pageLabel, setPageLabel] = useState<string | null>(null);

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={[styles.error, { color: theme.danger }]}>
          This PDF could not be displayed.
        </Text>
        <Text style={[styles.retry, { color: theme.accent }]} onPress={onAccessError}>
          Refresh access
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      {pageLabel ? (
        <Text style={[styles.pageLabel, { color: theme.muted }]}>{pageLabel}</Text>
      ) : null}
      <Pdf
        source={{ uri: url, headers, cache: false }}
        trustAllCerts={false}
        enablePaging={false}
        enableDoubleTapZoom
        horizontal={false}
        spacing={8}
        style={[
          styles.pdf,
          {
            height: Math.max(360, Math.min(620, height * 0.62)),
            backgroundColor: theme.surfaceStrong,
          },
        ]}
        renderActivityIndicator={() => <ActivityIndicator color={theme.accent} />}
        onLoadComplete={(pages) => setPageLabel(`${pages} ${pages === 1 ? "page" : "pages"}`)}
        onPageChanged={(page, pages) => setPageLabel(`Page ${page} of ${pages}`)}
        onError={() => setError(true)}
        onPressLink={(urlToOpen) =>
          confirmAndOpenExternalLink(urlToOpen, {
            allowMailto: true,
            onError: () => setError(true),
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  pdf: { width: "100%", borderRadius: 6 },
  pageLabel: { fontSize: 12, lineHeight: 16, textAlign: "center" },
  state: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12 },
  error: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  retry: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
});
