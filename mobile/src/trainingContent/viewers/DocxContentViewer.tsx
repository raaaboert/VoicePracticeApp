import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import type { TrainingContentTheme } from "../theme";

interface DocxContentViewerProps {
  url: string;
  headers: Record<string, string>;
  filename: string | null;
  theme: TrainingContentTheme;
}

function safeDocxFilename(filename: string | null): string {
  const basename = (filename ?? "training-document.docx")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return basename.toLocaleLowerCase().endsWith(".docx")
    ? basename
    : `${basename || "training-document"}.docx`;
}

export function DocxContentViewer({
  url,
  headers,
  filename,
  theme,
}: DocxContentViewerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDocument = async () => {
    setBusy(true);
    setError(null);
    const destination = `${FileSystem.cacheDirectory}peritio-${Date.now()}-${safeDocxFilename(filename)}`;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setError("Document opening is not available on this device.");
        return;
      }
      const result = await FileSystem.downloadAsync(url, destination, { headers });
      if (result.status < 200 || result.status >= 300) {
        throw new Error("download_failed");
      }
      await Sharing.shareAsync(destination, {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        dialogTitle: "Open Document",
      });
    } catch {
      setError("The document could not be opened. Please try again.");
    } finally {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      setBusy(false);
    }
  };

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <MaterialCommunityIcons name="file-word-outline" size={36} color={theme.accent} />
      <Text style={[styles.filename, { color: theme.text }]}>
        {filename ?? "Word document"}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[
          styles.button,
          { backgroundColor: theme.accent },
          busy ? styles.disabled : null,
        ]}
        onPress={() => {
          Alert.alert(
            "Open Document",
            "This document will be downloaded temporarily and opened outside the Peritio viewer. Continue?",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Continue", onPress: () => { void openDocument(); } },
            ]
          );
        }}
      >
        <MaterialCommunityIcons name="open-in-new" size={19} color={theme.accentText} />
        <Text style={[styles.buttonText, { color: theme.accentText }]}>
          {busy ? "Preparing..." : "Open Document"}
        </Text>
      </Pressable>
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    minHeight: 190,
    padding: 18,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  filename: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  error: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
