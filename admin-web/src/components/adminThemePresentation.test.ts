import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../../app/globals.css");
const light = css.slice(css.indexOf('html[data-theme="light"]'), css.indexOf(".auth-theme-control"));

test("Master Utility reuses the dashboard provider and retains manual switching on login and authenticated pages", () => {
  const layout = read("../../app/layout.tsx");
  assert.match(layout, /peritio-web\/src\/components\/ThemeProvider/);
  assert.match(layout, /peritio-web\/src\/lib\/themePreference/);
  assert.match(layout, /data-theme="light"/);
  for (const path of ["../../app/login/page.tsx", "../../app/page.tsx", "./AdminShell.tsx"]) {
    assert.match(read(path), /<ThemeSwitchButton \/>/);
  }
  const login = read("../../app/login/page.tsx");
  for (const state of ["loading", "Signing in...", "Sign In", 'className="error"', 'className="primary"', 'htmlFor="password"']) {
    assert.ok(login.includes(state), state);
  }
  assert.doesNotMatch(read("../lib/api.ts"), /peritio\.theme|localStorage\.clear/);
});

test("Master light mode covers surfaces controls errors focus and environment-status states", () => {
  for (const token of ["text", "text-muted", "surface", "surface-strong", "control-bg", "control-border", "error-text", "focus", "warning", "info"]) {
    assert.match(light, new RegExp(`--vp-${token}:`));
  }
  assert.match(css, /:root:not\(\[data-theme\]\),\s*html\[data-theme="light"\]/);
  assert.match(css, /input,[\s\S]*?select,[\s\S]*?textarea\s*\{[\s\S]*?background: var\(--vp-surface-strong\)/);
  assert.match(css, /\.error\s*\{[\s\S]*?color: var\(--vp-error-text\)/);
  assert.match(css, /button:focus-visible,[\s\S]*?outline: 2px solid var\(--vp-focus\)/);
  assert.match(css, /\.environment-pill-staging\s*\{[\s\S]*?color: var\(--vp-warning\)/);
  assert.match(css, /\.environment-pill-production\s*\{[\s\S]*?color: var\(--vp-error-text\)/);
  for (const path of ["../../app/prompt-preview/page.tsx", "../../app/support/page.tsx"]) {
    assert.match(read(path), /background: "var\(--vp-surface-strong\)"/);
  }
});

test("light authentication text error and primary button colors meet normal-text contrast", () => {
  const color = (token: string) => light.match(new RegExp(`--vp-${token}: (#[a-f0-9]{6});`))![1]!;
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  for (const [foreground, background] of [["text", "surface"], ["text-muted", "surface"],
    ["error-text", "surface"], ["primary-text", "brand-400"], ["warning", "warning-soft"], ["info", "info-soft"]]) {
    const levels = [luminance(color(foreground!)), luminance(color(background!))].sort((a, b) => a - b);
    assert.ok((levels[1]! + 0.05) / (levels[0]! + 0.05) >= 4.5, `${foreground} on ${background}`);
  }
});

test("authentication route inventory contains only the existing dashboard OTP and Master password login pages", () => {
  function authPages(root: string): string[] {
    const paths: string[] = [];
    function visit(directory: string) {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) visit(path);
        else if (item.name === "page.tsx") {
          const route = relative(root, path).replaceAll("\\", "/");
          if (/(^|\/)(login|register|registration|activate|activation|invite|invitation|verify|verification|password|reset)(\/|$)/.test(route)) paths.push(route);
        }
      }
    }
    visit(root);
    return paths.sort();
  }
  assert.deepEqual(authPages(fileURLToPath(new URL("../../app", import.meta.url))), ["login/page.tsx"]);
  assert.deepEqual(authPages(fileURLToPath(new URL("../../../peritio-web/app", import.meta.url))), ["login/page.tsx"]);
});
