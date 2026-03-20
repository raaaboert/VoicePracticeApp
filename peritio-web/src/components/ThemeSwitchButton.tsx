"use client";

import { useTheme } from "@/src/components/ThemeProvider";

export function ThemeSwitchButton() {
  const { ready, theme, toggleTheme } = useTheme();
  const label = !ready ? "Theme" : theme === "dark" ? "Light Mode" : "Dark Mode";

  return (
    <button type="button" className="ghost-button" onClick={toggleTheme}>
      {label}
    </button>
  );
}
