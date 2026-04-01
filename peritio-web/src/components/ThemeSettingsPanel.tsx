"use client";

import { ThemeMode, useTheme } from "@/src/components/ThemeProvider";

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  description: string;
}> = [
  {
    id: "dark",
    label: "Dark",
    description: "High-contrast dashboard mode for dense review sessions.",
  },
  {
    id: "light",
    label: "Light",
    description: "Brighter workspace for daytime reporting and customer reviews.",
  },
];

export function ThemeSettingsPanel() {
  const { ready, theme, setTheme } = useTheme();

  return (
    <div className="page-stack">
      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Appearance</p>
            <h2>Theme</h2>
            <p className="section-copy">
              Switch between the dark and light dashboard themes. This preference is stored locally in the browser for
              now.
            </p>
          </div>
          <span className="pill">{ready ? `Current: ${theme}` : "Loading preference"}</span>
        </div>

        <div className="theme-grid">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`theme-card${theme === option.id ? " active" : ""}`}
              onClick={() => setTheme(option.id)}
            >
              <div>
                <strong>{option.label}</strong>
                <p>{option.description}</p>
              </div>
              <div className={`theme-preview ${option.id}`}>
                <span />
                <span />
                <span />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Coming next</p>
            <h2>Account preferences</h2>
            <p className="section-copy">
              Profile controls, notification preferences, and dashboard defaults will appear here as account-level
              preferences roll out.
            </p>
          </div>
          <span className="pill muted">More settings soon</span>
        </div>
      </section>
    </div>
  );
}
