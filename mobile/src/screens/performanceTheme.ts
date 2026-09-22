import type { AppColorScheme } from "../types";

export interface PerformanceTheme {
  background: string;
  section: string;
  surfaceStrong: string;
  card: string;
  planCard: string;
  border: string;
  borderSubtle: string;
  sectionDivider: string;
  sectionBorder: string;
  planBorder: string;
  text: string;
  body: string;
  muted: string;
  eyebrow: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  activeStatus: string;
  scheduledStatus: string;
  mutedStatus: string;
  control: string;
  controlInset: string;
  input: string;
  inputPlaceholder: string;
  divider: string;
  progressTrack: string;
  statBackground: string;
  selectedBorder: string;
  errorBorder: string;
  errorBackground: string;
  errorText: string;
  previewBorder: string;
  previewBackground: string;
  modalBackdrop: string;
  calendarPanel: string;
  buttonBorder: string;
  buttonBackground: string;
}

const LIGHT_THEME: PerformanceTheme = {
  background: "#f5f1e8",
  section: "rgba(255, 255, 250, 0.965)",
  surfaceStrong: "#ffffff",
  card: "rgba(255, 255, 250, 0.98)",
  planCard: "rgba(247, 250, 244, 0.98)",
  border: "rgba(98, 119, 100, 0.24)",
  borderSubtle: "rgba(98, 119, 100, 0.16)",
  sectionDivider: "rgba(98, 119, 100, 0.12)",
  sectionBorder: "rgba(98, 119, 100, 0.18)",
  planBorder: "rgba(97, 120, 97, 0.34)",
  text: "#1f2921",
  body: "#465845",
  muted: "#596761",
  eyebrow: "#8d7452",
  accent: "#617861",
  accentText: "#f8f0df",
  accentSoft: "rgba(97, 120, 97, 0.18)",
  activeStatus: "rgba(97, 120, 97, 0.2)",
  scheduledStatus: "rgba(177, 144, 92, 0.2)",
  mutedStatus: "rgba(70, 88, 69, 0.12)",
  control: "rgba(246, 248, 241, 0.98)",
  controlInset: "rgba(238, 243, 235, 0.98)",
  input: "#ffffff",
  inputPlaceholder: "#667463",
  divider: "rgba(98, 119, 100, 0.14)",
  progressTrack: "rgba(98, 119, 100, 0.16)",
  statBackground: "rgba(98, 119, 100, 0.1)",
  selectedBorder: "rgba(97, 120, 97, 0.82)",
  errorBorder: "rgba(182, 76, 76, 0.32)",
  errorBackground: "rgba(182, 76, 76, 0.1)",
  errorText: "#8d3c3c",
  previewBorder: "rgba(97, 120, 97, 0.28)",
  previewBackground: "rgba(97, 120, 97, 0.08)",
  modalBackdrop: "rgba(18, 24, 19, 0.42)",
  calendarPanel: "#ffffff",
  buttonBorder: "rgba(98, 119, 100, 0.22)",
  buttonBackground: "rgba(246, 248, 241, 0.98)",
};

const DARK_THEME: PerformanceTheme = {
  background: "#101711",
  section: "rgba(19,27,22,0.72)",
  surfaceStrong: "rgba(19,27,22,0.96)",
  card: "rgba(19,27,22,0.78)",
  planCard: "rgba(15,24,18,0.92)",
  border: "rgba(246,240,223,0.18)",
  borderSubtle: "rgba(246,240,223,0.12)",
  sectionDivider: "rgba(246,240,223,0.1)",
  sectionBorder: "rgba(246,240,223,0.16)",
  planBorder: "rgba(143,184,141,0.34)",
  text: "#f6f0df",
  body: "#d8ddcf",
  muted: "#aeb8a8",
  eyebrow: "#c9b88f",
  accent: "#8fb88d",
  accentText: "#102017",
  accentSoft: "rgba(143,184,141,0.2)",
  activeStatus: "rgba(114,157,116,0.28)",
  scheduledStatus: "rgba(201,184,143,0.24)",
  mutedStatus: "rgba(255,255,255,0.1)",
  control: "rgba(255,255,255,0.06)",
  controlInset: "rgba(20,28,22,0.68)",
  input: "rgba(8,13,10,0.42)",
  inputPlaceholder: "#7d877a",
  divider: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.12)",
  statBackground: "rgba(255,255,255,0.07)",
  selectedBorder: "rgba(143,184,141,0.82)",
  errorBorder: "rgba(240,138,138,0.36)",
  errorBackground: "rgba(91,35,35,0.34)",
  errorText: "#ffd6d6",
  previewBorder: "rgba(143,184,141,0.28)",
  previewBackground: "rgba(143,184,141,0.08)",
  modalBackdrop: "rgba(0,0,0,0.6)",
  calendarPanel: "#152017",
  buttonBorder: "rgba(246,240,223,0.2)",
  buttonBackground: "rgba(255,255,255,0.07)",
};

export function getPerformanceTheme(colorScheme: AppColorScheme): PerformanceTheme {
  return colorScheme === "soft_light" ? LIGHT_THEME : DARK_THEME;
}
