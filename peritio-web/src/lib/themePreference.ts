export type ThemeMode = "dark" | "light";
export const DEFAULT_THEME: ThemeMode = "light";
export const THEME_STORAGE_KEY = "peritio.theme";

export function readThemePreference(getStorage: () => Pick<Storage, "getItem">): ThemeMode {
  try {
    return getStorage().getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Run synchronously in <head>, before page content can paint. Only an explicit
// saved dark preference enables dark mode; neither app follows OS appearance.
export const THEME_BOOT_SCRIPT = `
(() => {
  let theme = 'light';
  try {
    const stored = window.localStorage.getItem('peritio.theme');
    theme = stored === 'dark' ? 'dark' : 'light';
  } catch (_) {}
  document.documentElement.dataset.theme = theme;
})();
`;
