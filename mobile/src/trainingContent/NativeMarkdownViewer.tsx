import { StyleSheet, Text, View } from "react-native";

import { confirmAndOpenExternalLink } from "./externalLinks";
import type { MarkdownInline } from "./markdownModel";
import { parseSafeMarkdown } from "./markdownModel";
import type { TrainingContentTheme } from "./theme";

interface NativeMarkdownViewerProps {
  body: string;
  theme: TrainingContentTheme;
  onError: (message: string) => void;
}

export function NativeMarkdownViewer({
  body,
  theme,
  onError,
}: NativeMarkdownViewerProps) {
  const styles = createStyles(theme);
  return (
    <View style={styles.root}>
      {parseSafeMarkdown(body).map((block, blockIndex) => {
        if (block.type === "heading") {
          return (
            <Text
              key={`heading-${blockIndex}`}
              style={[
                styles.heading,
                block.level > 2 ? styles.smallHeading : null,
              ]}
            >
              <InlineContent content={block.content} styles={styles} onError={onError} />
            </Text>
          );
        }
        if (block.type === "list") {
          return (
            <View key={`list-${blockIndex}`} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={`item-${itemIndex}`} style={styles.listRow}>
                  <Text style={styles.listMarker}>
                    {block.ordered ? `${itemIndex + 1}.` : "\u2022"}
                  </Text>
                  <Text style={styles.paragraph}>
                    <InlineContent content={item} styles={styles} onError={onError} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={`paragraph-${blockIndex}`} style={styles.paragraph}>
            <InlineContent content={block.content} styles={styles} onError={onError} />
          </Text>
        );
      })}
    </View>
  );
}

function InlineContent({
  content,
  styles,
  onError,
}: {
  content: MarkdownInline[];
  styles: ReturnType<typeof createStyles>;
  onError: (message: string) => void;
}) {
  return (
    <>
      {content.map((inline, index) => {
        if (inline.type === "bold") {
          return <Text key={index} style={styles.bold}>{inline.text}</Text>;
        }
        if (inline.type === "italic") {
          return <Text key={index} style={styles.italic}>{inline.text}</Text>;
        }
        if (inline.type === "link") {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              style={styles.link}
              onPress={() => confirmAndOpenExternalLink(inline.url, {
                allowMailto: true,
                onError,
              })}
            >
              {inline.text}
            </Text>
          );
        }
        return <Text key={index}>{inline.text}</Text>;
      })}
    </>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    root: { gap: 12 },
    heading: {
      color: theme.text,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "700",
      marginTop: 5,
    },
    smallHeading: { fontSize: 18, lineHeight: 24 },
    paragraph: { flex: 1, color: theme.text, fontSize: 16, lineHeight: 25 },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    link: { color: theme.accent, textDecorationLine: "underline" },
    list: { gap: 7 },
    listRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    listMarker: {
      width: 24,
      color: theme.secondary,
      fontSize: 16,
      lineHeight: 25,
      fontWeight: "700",
      textAlign: "right",
    },
  });
}
