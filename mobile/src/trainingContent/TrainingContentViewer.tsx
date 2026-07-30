import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { MobileTrainingContentDetail } from "@voicepractice/shared";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { confirmAndOpenExternalLink } from "./externalLinks";
import { NativeMarkdownViewer } from "./NativeMarkdownViewer";
import { createNativeViewerInstanceKey } from "./nativeViewerLifecycle";
import type { TrainingContentTheme } from "./theme";
import { useTrainingContentAssetAccess } from "./useTrainingContentAssetAccess";
import { recordTrainingContentViewerDiagnostic } from "./viewerDiagnostics";
import { AudioContentViewer } from "./viewers/AudioContentViewer";
import { DocxContentViewer } from "./viewers/DocxContentViewer";
import { ImageContentViewer } from "./viewers/ImageContentViewer";
import { PdfContentViewer } from "./viewers/PdfContentViewer";
import { VideoContentViewer } from "./viewers/VideoContentViewer";

interface TrainingContentViewerProps {
  item: MobileTrainingContentDetail;
  userId: string;
  authToken: string;
  theme: TrainingContentTheme;
  onModuleRemoved: (message: string) => void;
  onItemRemoved: (message: string) => void;
  onError: (message: string) => void;
}

export function TrainingContentViewer(props: TrainingContentViewerProps) {
  if (props.item.contentType === "native") {
    return (
      <NativeMarkdownViewer
        body={props.item.nativeBody ?? ""}
        theme={props.theme}
        onError={props.onError}
      />
    );
  }
  if (props.item.contentType === "external_url") {
    return (
      <ExternalResourceViewer
        url={props.item.externalUrl}
        theme={props.theme}
        onError={props.onError}
      />
    );
  }
  return <UploadedContentViewer {...props} />;
}

function ExternalResourceViewer({
  url,
  theme,
  onError,
}: {
  url: string | null;
  theme: TrainingContentTheme;
  onError: (message: string) => void;
}) {
  const styles = createStyles(theme);
  return (
    <View style={styles.externalPanel}>
      <MaterialCommunityIcons name="web" size={34} color={theme.accent} />
      <Pressable
        accessibilityRole="button"
        disabled={!url}
        style={[styles.openButton, !url ? styles.disabled : null]}
        onPress={() => {
          if (url) {
            confirmAndOpenExternalLink(url, { onError });
          }
        }}
      >
        <MaterialCommunityIcons name="open-in-new" size={19} color={theme.accentText} />
        <Text style={styles.openButtonText}>Open Resource</Text>
      </Pressable>
      {!url ? (
        <Text style={styles.errorText}>This resource is not available right now.</Text>
      ) : null}
    </View>
  );
}

function UploadedContentViewer(props: TrainingContentViewerProps) {
  const styles = createStyles(props.theme);
  const accessState = useTrainingContentAssetAccess({
    userId: props.userId,
    contentId: props.item.id,
    authToken: props.authToken,
    onModuleRemoved: props.onModuleRemoved,
    onItemRemoved: props.onItemRemoved,
  });
  useEffect(() => {
    if (
      props.item.contentType === "pdf" &&
      !accessState.loading &&
      !accessState.access &&
      accessState.error
    ) {
      recordTrainingContentViewerDiagnostic("asset_access_failed");
    }
  }, [
    accessState.access,
    accessState.error,
    accessState.loading,
    props.item.contentType,
  ]);
  if (accessState.loading && !accessState.access) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={props.theme.accent} />
        <Text style={styles.stateText}>
          {props.item.contentType === "pdf"
            ? "Getting document access..."
            : "Opening resource..."}
        </Text>
      </View>
    );
  }
  if (!accessState.access) {
    return (
      <View style={styles.state}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={30}
          color={props.theme.danger}
        />
        <Text style={styles.errorText}>
          {accessState.error ?? "This resource could not be opened."}
        </Text>
        <Pressable style={styles.openButton} onPress={() => { void accessState.refresh(); }}>
          <Text style={styles.openButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const access = accessState.access;
  const viewerInstanceKey = createNativeViewerInstanceKey(
    props.item.id,
    accessState.accessRevision
  );
  switch (props.item.contentType) {
    case "image":
      return (
        <ImageContentViewer
          url={access.url}
          headers={access.requiredHeaders}
          theme={props.theme}
          onAccessError={() => { void accessState.refresh(); }}
        />
      );
    case "video":
      return (
        <VideoContentViewer
          key={`video:${viewerInstanceKey}`}
          url={access.url}
          headers={access.requiredHeaders}
          theme={props.theme}
          onAccessError={() => { void accessState.refresh(); }}
        />
      );
    case "audio":
      return (
        <AudioContentViewer
          url={access.url}
          headers={access.requiredHeaders}
          theme={props.theme}
          onAccessError={() => { void accessState.refresh(); }}
        />
      );
    case "pdf":
      return (
        <PdfContentViewer
          key={`pdf:${viewerInstanceKey}`}
          url={access.url}
          headers={access.requiredHeaders}
          theme={props.theme}
          onAccessError={accessState.refresh}
        />
      );
    case "docx":
      return (
        <DocxContentViewer
          url={access.url}
          headers={access.requiredHeaders}
          filename={props.item.asset?.filename ?? null}
          theme={props.theme}
        />
      );
    default:
      return null;
  }
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    externalPanel: {
      minHeight: 170,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 18,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
    },
    state: {
      minHeight: 200,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 20,
    },
    stateText: { color: theme.muted, fontSize: 15, lineHeight: 21 },
    errorText: {
      color: theme.danger,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
    },
    openButton: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 18,
      backgroundColor: theme.accent,
      borderRadius: 6,
    },
    openButtonText: {
      color: theme.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    disabled: { opacity: 0.5 },
  });
}
