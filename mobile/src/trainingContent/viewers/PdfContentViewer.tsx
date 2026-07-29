import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Pdf from "react-native-pdf";

import { confirmAndOpenExternalLink } from "../externalLinks";
import {
  buildPrivatePdfSource,
  createNativeViewerLoadGuard,
  disposeNativeViewerLoadGuard,
  NATIVE_VIEWER_LOAD_TIMEOUT_MS,
  resetNativeViewerLoadGuard,
  settleNativeViewerLoad,
} from "../nativeViewerLifecycle";
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
  const source = useMemo(() => buildPrivatePdfSource(url, headers), [headers, url]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const loadGuard = useRef(createNativeViewerLoadGuard());
  const mounted = useRef(true);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    resetNativeViewerLoadGuard(loadGuard.current);
    setLoadError(null);
    setPageLabel(null);
    loadTimeout.current = setTimeout(() => {
      if (settleNativeViewerLoad(loadGuard.current)) {
        setLoadError("This PDF is taking too long to load.");
      }
    }, NATIVE_VIEWER_LOAD_TIMEOUT_MS);
    return () => {
      mounted.current = false;
      disposeNativeViewerLoadGuard(loadGuard.current);
      if (loadTimeout.current) {
        clearTimeout(loadTimeout.current);
        loadTimeout.current = null;
      }
    };
  }, [source]);

  const finishInitialLoad = () => {
    if (loadTimeout.current) {
      clearTimeout(loadTimeout.current);
      loadTimeout.current = null;
    }
  };

  if (loadError) {
    return (
      <View style={styles.state}>
        <Text style={[styles.error, { color: theme.danger }]}>
          {loadError}
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
        source={source}
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
        onLoadComplete={(pages) => {
          if (!settleNativeViewerLoad(loadGuard.current)) {
            return;
          }
          finishInitialLoad();
          setPageLabel(`${pages} ${pages === 1 ? "page" : "pages"}`);
        }}
        onPageChanged={(page, pages) => {
          if (mounted.current) {
            setPageLabel(`Page ${page} of ${pages}`);
          }
        }}
        onError={() => {
          if (!settleNativeViewerLoad(loadGuard.current)) {
            return;
          }
          finishInitialLoad();
          setLoadError("This PDF could not be displayed.");
        }}
        onPressLink={(urlToOpen) =>
          confirmAndOpenExternalLink(urlToOpen, {
            allowMailto: true,
            onError: () => setLoadError("This PDF link could not be opened."),
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
