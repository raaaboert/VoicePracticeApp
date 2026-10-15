"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DEFAULT_THEME, readThemePreference, THEME_STORAGE_KEY, type ThemeMode } from "../lib/themePreference";
export type { ThemeMode } from "../lib/themePreference";

interface ThemeContextValue {
  ready: boolean;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedTheme = readThemePreference(() => window.localStorage);
    applyTheme(storedTheme);
    setThemeState(storedTheme);
    setReady(true);
  }, []);

  const setTheme = (nextTheme: ThemeMode) => {
    applyTheme(nextTheme);
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures; the theme still updates for the current session.
    }
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      ready,
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [ready, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return value;
}
