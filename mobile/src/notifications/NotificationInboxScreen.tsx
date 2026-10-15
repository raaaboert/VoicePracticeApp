import type { MobileNotificationDestination } from "@voicepractice/shared";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AppColorScheme } from "../types";
import { getTrainingContentTheme } from "../trainingContent/theme";
import { createNotificationInboxController, notificationAccessibilityLabel, notificationStatusLabel, notificationTimeLabel } from "./model";

export function NotificationInboxScreen(props: { colorScheme: AppColorScheme;
  controller: ReturnType<typeof createNotificationInboxController>;
  state: ReturnType<ReturnType<typeof createNotificationInboxController>["snapshot"]>;
  onBack: () => void; onOpen: (destination: MobileNotificationDestination) => void;
}) {
  const theme = getTrainingContentTheme(props.colorScheme);
  const { state, controller } = props;
  const button = (label: string, run: () => void, disabled = false, accessibleLabel = label) => (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibleLabel} disabled={disabled || state.acting}
      onPress={run} style={[styles.button, { borderColor: theme.border, opacity: disabled || state.acting ? 0.5 : 1 }]}>
      <Text style={{ color: theme.accent }}>{label}</Text>
    </Pressable>
  );
  return <View style={[styles.fill, { backgroundColor: theme.background }]}>
    <View style={styles.header}>
      {button("Back", props.onBack)}
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Notifications</Text>
      {button("Refresh", () => { void controller.refresh(); }, state.loading)}
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={{ color: theme.muted }}>{state.unreadCount} unread</Text>
      <View style={styles.header}>
        {button(state.history ? "Show active inbox" : "View all notifications", () => { void controller.history(!state.history); }, state.loading)}
        {button("Mark all read", () => { void controller.act(null, "mark-all"); }, state.loading || !state.unreadCount)}
      </View>
      {state.loading ? <ActivityIndicator accessibilityLabel="Loading notifications" color={theme.accent} /> : null}
      {state.acting ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>Updating notification…</Text> : null}
      {state.unsupported ? <Text style={{ color: theme.muted }}>Notifications are not available on this server yet.</Text> : null}
      {state.error ? <View accessibilityLiveRegion="polite"><Text style={{ color: theme.danger }}>{state.error}</Text>
        {button("Retry", () => { void controller.refresh(); }, state.loading)}</View> : null}
      {!state.loading && !state.error && !state.unsupported && !state.rows.length
        ? <Text style={{ color: theme.muted }}>{state.history ? "No notifications in your history." : "You're all caught up. No active notifications."}</Text> : null}
      {state.rows.map((row) => <View key={row.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={notificationAccessibilityLabel(row)} disabled={state.acting} onPress={() => {
          void controller.act(row.id, "open").then((destination) => { if (destination) props.onOpen(destination); });
        }} style={styles.open}>
          <Text style={[styles.rowTitle, { color: theme.text }]}>{row.title}</Text>
          <Text style={{ color: theme.muted }}>{notificationStatusLabel(row)} · {notificationTimeLabel(row.createdAt)}</Text>
        </Pressable>
        {!row.dismissedAt ? button("Dismiss", () => { void controller.act(row.id, "dismiss"); }, false, `Dismiss ${row.title}`) : null}
      </View>)}
      {state.nextOffset !== null ? button("Load more", () => { void controller.more(); }, state.loading) : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: 12 },
  title: { fontSize: 20, fontWeight: "700" }, content: { padding: 16, gap: 12 },
  button: { padding: 12, minHeight: 44, borderWidth: 1, borderRadius: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  open: { padding: 4, minHeight: 44, gap: 8 }, rowTitle: { fontSize: 16, fontWeight: "600" },
});
