import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(componentsDir, path), "utf8");
const css = read("../../app/globals.css");
const themeProvider = read("ThemeProvider.tsx");
const adminNav = read("TrainingContentAdminNav.tsx");
const focusTopics = read("FocusTopicAdministration.tsx");
const whatMatters = read("DashboardWhatMattersSection.tsx");
const notificationInbox = read("NotificationInbox.tsx");

test("dark and light themes define the same compact semantic visual system", () => {
  const roles = [
    "canvas",
    "surface",
    "surface-raised",
    "surface-muted",
    "surface-accent",
    "border",
    "border-strong",
    "text-primary",
    "text-secondary",
    "text-muted",
    "brand-forest",
    "brand-sage",
    "brand-gold",
    "action-primary",
    "action-primary-text",
    "danger",
    "success",
    "warning",
  ];
  const dark = css.slice(css.indexOf(":root {"), css.indexOf('html[data-theme="light"]'));
  const light = css.slice(css.indexOf('html[data-theme="light"]'), css.indexOf("* {"));

  for (const role of roles) {
    assert.match(dark, new RegExp(`--${role}:`), `dark theme is missing --${role}`);
    assert.match(light, new RegExp(`--${role}:`), `light theme is missing --${role}`);
  }
});

test("shared controls consume semantic surfaces with visible active, focus, and disabled states", () => {
  assert.match(css, /\.text-input:focus-visible\s*\{[\s\S]*?border-color: var\(--accent\);[\s\S]*?box-shadow: 0 0 0 3px var\(--accent-soft\)/);
  assert.match(css, /\.tab-button\.active\s*\{[\s\S]*?background: var\(--surface-accent\);[\s\S]*?border-color: var\(--accent\)/);
  assert.match(css, /\.app-nav a\.active\s*\{[\s\S]*?box-shadow: inset 3px 0 0 var\(--accent\)/);
  assert.match(css, /\.primary-button:disabled,[\s\S]*?cursor: not-allowed/);
  assert.match(focusTopics, /className="text-input" id="focus-topic-audience"/);
  assert.match(focusTopics, /className="primary-button focus-topic-add-assignment"/);
});

test("Performance priority labels keep named semantic treatments instead of low-contrast one-offs", () => {
  assert.match(whatMatters, /dashboard-priority-tone-\$\{primary\.tone\}/);
  assert.match(css, /\.dashboard-priority-tone-primary \.dashboard-priority-kicker\s*\{[\s\S]*?var\(--success\)/);
  assert.match(css, /\.dashboard-priority-tone-caution \.dashboard-priority-kicker\s*\{[\s\S]*?var\(--warning\)/);
  assert.match(css, /\.dashboard-priority-tone-watch \.dashboard-priority-kicker\s*\{[\s\S]*?var\(--text-secondary\)/);
  assert.doesNotMatch(css, /rgba\(147, 197, 253|rgba\(251, 191, 36|rgba\(94, 234, 212/);
});

test("notification inbox retains its panel, unread state, timestamp, and badge presentation", () => {
  assert.match(notificationInbox, /className="notification-panel"/);
  assert.match(notificationInbox, /notification-row\$\{notification\.readAt \? " is-read" : " is-unread"\}/);
  assert.match(notificationInbox, /formatNotificationTime\(notification\.createdAt\)/);
  assert.match(notificationInbox, /className="notification-badge"/);
  assert.match(css, /\.notification-row\.is-unread\s*\{[\s\S]*?box-shadow: inset 3px 0 0 var\(--accent\)/);
});

test("theme switching and canonical Admin section order remain intact", () => {
  assert.match(themeProvider, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(themeProvider, /window\.localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(themeProvider, /toggleTheme: \(\) => setTheme\(theme === "dark" \? "light" : "dark"\)/);

  const labels = ["Users & Access", "Focus Topics", "Learning Resources", "Focus Topic Order"];
  let previous = -1;
  for (const label of labels) {
    const next = adminNav.indexOf(label);
    assert.ok(next > previous, `${label} must remain in the canonical Admin order`);
    previous = next;
  }
});
