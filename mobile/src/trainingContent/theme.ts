import type { AppColorScheme } from "../types";

export interface TrainingContentTheme {
  background: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  secondary: string;
  danger: string;
  input: string;
  mediaBackground: string;
}

export function getTrainingContentTheme(
  colorScheme: AppColorScheme
): TrainingContentTheme {
  if (colorScheme === "classic_blue") {
    return {
      background: "#29332f",
      surface: "#35413c",
      surfaceStrong: "#43524b",
      border: "#63736b",
      text: "#f7f5ed",
      muted: "#c7cec9",
      accent: "#78c7bd",
      accentText: "#162724",
      secondary: "#efb66f",
      danger: "#ffb4ab",
      input: "#202925",
      mediaBackground: "#101613",
    };
  }
  return {
    background: "#f5f7f5",
    surface: "#ffffff",
    surfaceStrong: "#e8efeb",
    border: "#cbd7d0",
    text: "#17211d",
    muted: "#596761",
    accent: "#187a70",
    accentText: "#ffffff",
    secondary: "#b55f2a",
    danger: "#a9382f",
    input: "#ffffff",
    mediaBackground: "#111815",
  };
}
