import * as FileSystem from "expo-file-system/legacy";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Pdf from "react-native-pdf";

import { confirmAndOpenExternalLink } from "../externalLinks";
import {
  buildLocalPdfSource,
  createNativeViewerLoadGuard,
  disposeNativeViewerLoadGuard,
  isValidPdfPageProgress,
  NATIVE_VIEWER_LOAD_TIMEOUT_MS,
  resetNativeViewerLoadGuard,
  resolvePdfNativeRenderSignal,
} from "../nativeViewerLifecycle";
import {
  deferManagedTemporaryPdfDeletion,
  type PdfTemporaryDownloadSession,
  PdfTemporaryFileError,
  type PdfTemporaryFileSystem,
  refreshTemporaryPdf,
  startTemporaryPdfDownload,
  type PdfFileDiagnosticCategory,
} from "../pdfTemporaryFile";
import type { TrainingContentTheme } from "../theme";
import {
  classifyPdfNativeError,
  type PdfNativeErrorClass,
  recordTrainingContentViewerDiagnostic,
} from "../viewerDiagnostics";

interface PdfContentViewerProps {
  url: string;
  headers: Record<string, string>;
  expectedByteSize: number | null;
  theme: TrainingContentTheme;
  onAccessError: () => Promise<void>;
}

type PdfViewerFailureCode =
  | PdfFileDiagnosticCategory
  | "pdf_render_failed"
  | "pdf_render_timeout";

type PdfViewerState =
  | { stage: "downloading" }
  | { stage: "rendering"; localUri: string }
  | { stage: "loaded"; localUri: string }
  | { stage: "getting_access" }
  | {
      stage: "failed";
      errorCode: PdfViewerFailureCode;
      message: string;
      nativeErrorClass?: PdfNativeErrorClass;
    };

const PDF_FILE_SYSTEM: PdfTemporaryFileSystem = {
  cacheDirectory: FileSystem.cacheDirectory,
  createDownloadResumable: (url, destinationUri, options) =>
    FileSystem.createDownloadResumable(url, destinationUri, options),
  getInfoAsync: async (uri) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists
      ? { exists: true, size: info.size }
      : { exists: false };
  },
  readAsStringAsync: (uri, options) =>
    FileSystem.readAsStringAsync(uri, options),
  deleteAsync: (uri, options) => FileSystem.deleteAsync(uri, options),
};

const StableAndroidPdf = memo(Pdf);
const PdfRenderer = Platform.OS === "android" ? StableAndroidPdf : Pdf;

export function PdfContentViewer({
  url,
  headers,
  expectedByteSize,
  theme,
  onAccessError,
}: PdfContentViewerProps) {
  const { height } = useWindowDimensions();
  const [viewerState, setViewerState] = useState<PdfViewerState>({
    stage: "downloading",
  });
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const operationGeneration = useRef(0);
  const mounted = useRef(true);
  const activeDownload = useRef<PdfTemporaryDownloadSession | null>(null);
  const localUri = useRef<string | null>(null);
  const renderGuard = useRef(createNativeViewerLoadGuard());
  const renderTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRenderTimeout = useCallback(() => {
    if (renderTimeout.current) {
      clearTimeout(renderTimeout.current);
      renderTimeout.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    resetNativeViewerLoadGuard(renderGuard.current);
    setViewerState({ stage: "downloading" });
    setPageLabel(null);

    void (async () => {
      try {
        const session = startTemporaryPdfDownload({
          fileSystem: PDF_FILE_SYSTEM,
          url,
          headers,
          expectedByteSize,
        });
        activeDownload.current = session;
        const downloadedUri = await session.result;
        if (
          !mounted.current ||
          operationGeneration.current !== generation
        ) {
          await session.cancel();
          return;
        }
        if (activeDownload.current === session) {
          activeDownload.current = null;
        }
        localUri.current = downloadedUri;
        resetNativeViewerLoadGuard(renderGuard.current);
        setViewerState({ stage: "rendering", localUri: downloadedUri });
        renderTimeout.current = setTimeout(() => {
          if (
            mounted.current &&
            operationGeneration.current === generation &&
            resolvePdfNativeRenderSignal(
              renderGuard.current,
              "timeout",
              Platform.OS
            ) === "failed"
          ) {
            recordTrainingContentViewerDiagnostic("pdf_render_timeout");
            setViewerState({
              stage: "failed",
              errorCode: "pdf_render_timeout",
              message: "This PDF could not be displayed.",
            });
            const uriToDelete = localUri.current;
            localUri.current = null;
            deferManagedTemporaryPdfDeletion(PDF_FILE_SYSTEM, uriToDelete);
          }
        }, NATIVE_VIEWER_LOAD_TIMEOUT_MS);
      } catch (caught) {
        if (
          !mounted.current ||
          operationGeneration.current !== generation ||
          (caught instanceof PdfTemporaryFileError && caught.canceled)
        ) {
          return;
        }
        const category =
          caught instanceof PdfTemporaryFileError
            ? caught.diagnosticCategory
            : "pdf_download_failed";
        recordTrainingContentViewerDiagnostic(category);
        setViewerState({
          stage: "failed",
          errorCode: category,
          message: "This PDF could not be prepared.",
        });
      }
    })();

    return () => {
      mounted.current = false;
      operationGeneration.current += 1;
      clearRenderTimeout();
      disposeNativeViewerLoadGuard(renderGuard.current);
      const sessionToCancel = activeDownload.current;
      const uriToDelete = localUri.current;
      activeDownload.current = null;
      localUri.current = null;
      void sessionToCancel?.cancel();
      deferManagedTemporaryPdfDeletion(PDF_FILE_SYSTEM, uriToDelete);
    };
  }, [expectedByteSize, headers, url]);

  const refreshAccess = async () => {
    operationGeneration.current += 1;
    clearRenderTimeout();
    disposeNativeViewerLoadGuard(renderGuard.current);
    setPageLabel(null);
    setViewerState({ stage: "getting_access" });
    const sessionToCancel = activeDownload.current;
    const uriToDelete = localUri.current;
    activeDownload.current = null;
    localUri.current = null;
    await refreshTemporaryPdf({
      fileSystem: PDF_FILE_SYSTEM,
      activeDownload: sessionToCancel,
      localUri: uriToDelete,
      requestFreshAccess: onAccessError,
      deleteLocalPdf: deferManagedTemporaryPdfDeletion,
    });
  };

  const activeLocalUri =
    viewerState.stage === "rendering" || viewerState.stage === "loaded"
      ? viewerState.localUri
      : null;
  const source = useMemo(
    () => (activeLocalUri ? buildLocalPdfSource(activeLocalUri) : null),
    [activeLocalUri]
  );
  const pdfStyle = useMemo(
    () => [
      styles.pdf,
      {
        height: Math.max(360, Math.min(620, height * 0.62)),
        backgroundColor: theme.surfaceStrong,
      },
    ],
    [height, theme.surfaceStrong]
  );
  const renderPdfActivityIndicator = useCallback(
    () => <ActivityIndicator color={theme.accent} />,
    [theme.accent]
  );
  const handleLoadComplete = useCallback(
    (pages: number) => {
      if (
        resolvePdfNativeRenderSignal(
          renderGuard.current,
          "load_complete",
          Platform.OS
        ) !== "loaded"
      ) {
        return;
      }
      const uri = localUri.current;
      if (!mounted.current || !uri) {
        return;
      }
      clearRenderTimeout();
      setViewerState({ stage: "loaded", localUri: uri });
      setPageLabel(`${pages} ${pages === 1 ? "page" : "pages"}`);
    },
    [clearRenderTimeout]
  );
  const handlePageChanged = useCallback(
    (page: number, pages: number) => {
      if (!mounted.current || !isValidPdfPageProgress(page, pages)) {
        return;
      }
      if (
        resolvePdfNativeRenderSignal(
          renderGuard.current,
          "page_changed",
          Platform.OS
        ) === "loaded"
      ) {
        const uri = localUri.current;
        if (uri) {
          clearRenderTimeout();
          setViewerState({ stage: "loaded", localUri: uri });
        }
      }
      setPageLabel(`Page ${page} of ${pages}`);
    },
    [clearRenderTimeout]
  );
  const handlePdfError = useCallback(
    (error: object) => {
      if (
        resolvePdfNativeRenderSignal(
          renderGuard.current,
          "error",
          Platform.OS
        ) !== "failed"
      ) {
        return;
      }
      clearRenderTimeout();
      const nativeErrorClass = classifyPdfNativeError(error);
      recordTrainingContentViewerDiagnostic("pdf_render_failed", {
        nativeErrorClass,
      });
      setViewerState({
        stage: "failed",
        errorCode: "pdf_render_failed",
        nativeErrorClass,
        message: "This PDF could not be displayed.",
      });
      const uriToDelete = localUri.current;
      localUri.current = null;
      deferManagedTemporaryPdfDeletion(PDF_FILE_SYSTEM, uriToDelete);
    },
    [clearRenderTimeout]
  );
  const handlePdfLink = useCallback(
    (urlToOpen: string) =>
      confirmAndOpenExternalLink(urlToOpen, {
        allowMailto: true,
      }),
    []
  );

  if (
    viewerState.stage === "downloading" ||
    viewerState.stage === "getting_access"
  ) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.stateText, { color: theme.muted }]}>
          {viewerState.stage === "downloading"
            ? "Downloading document..."
            : "Getting fresh access..."}
        </Text>
      </View>
    );
  }

  if (viewerState.stage === "failed") {
    return (
      <View style={styles.state}>
        <Text style={[styles.error, { color: theme.danger }]}>
          {viewerState.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void refreshAccess();
          }}
        >
          <Text style={[styles.retry, { color: theme.accent }]}>
            Refresh access
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {viewerState.stage === "rendering" ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.stateText, { color: theme.muted }]}>
            Rendering document...
          </Text>
        </View>
      ) : pageLabel ? (
        <Text style={[styles.pageLabel, { color: theme.muted }]}>
          {pageLabel}
        </Text>
      ) : null}
      <PdfRenderer
        source={source!}
        trustAllCerts={false}
        enablePaging={false}
        enableDoubleTapZoom
        horizontal={false}
        spacing={8}
        style={pdfStyle}
        renderActivityIndicator={renderPdfActivityIndicator}
        onLoadComplete={handleLoadComplete}
        onPageChanged={handlePageChanged}
        onError={handlePdfError}
        onPressLink={handlePdfLink}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  pdf: { width: "100%", borderRadius: 6 },
  pageLabel: { fontSize: 12, lineHeight: 16, textAlign: "center" },
  statusRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  state: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  error: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  retry: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
});
