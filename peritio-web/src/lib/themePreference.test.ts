import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, useTheme } from "../components/ThemeProvider";
import * as preferences from "./themePreference";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function boot(stored: string | null, blocked = false) {
  const dataset = { theme: "light" };
  runInNewContext(preferences.THEME_BOOT_SCRIPT, {
    document: { documentElement: { dataset } },
    window: {
      get localStorage() {
        if (blocked) throw new Error("Storage unavailable");
        return { getItem: () => stored };
      },
      matchMedia: () => { throw new Error("OS appearance must not affect the default"); },
    },
  });
  return dataset;
}

test("first visit is light even with a dark OS; only saved explicit dark selects dark", () => {
  for (const [stored, expected] of [[null, "light"], ["", "light"], ["system", "light"],
    ["invalid", "light"], ["light", "light"], ["dark", "dark"]] as const) {
    assert.equal(preferences.readThemePreference(() => ({ getItem: () => stored })), expected);
    assert.equal(boot(stored).theme, expected, "pre-paint and provider policy must agree");
  }
  assert.equal(boot("dark", true).theme, "light");
  assert.equal(preferences.readThemePreference(() => { throw new Error("Blocked getter"); }), "light");
});

// Execute the real provider with hook state and a browser-storage double. No DOM
// renderer dependency is needed to test mount, rerender, toggle and reload.
function providerHarness(storage: Map<string, string>) {
  const source = ts.transpileModule(read("../components/ThemeProvider.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const states: unknown[] = [];
  let index = 0;
  let mounted = false;
  const effects: Array<() => void> = [];
  let value!: ReturnType<typeof useTheme>;
  const dataset = boot(storage.get(preferences.THEME_STORAGE_KEY) ?? null);
  const writes: string[] = [];
  const exports: Record<string, any> = {};
  runInNewContext(source, {
    exports,
    document: { documentElement: { dataset } },
    window: { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, next: string) => { storage.set(key, next); writes.push(next); },
    } },
    require: (name: string) => {
      if (name === "../lib/themePreference") return preferences;
      if (name === "react/jsx-runtime") return { jsx: (_type: unknown, props: { value: typeof value }) => { value = props.value; return null; } };
      if (name === "react") return {
        createContext: () => ({ Provider: {} }),
        useState: (initial: unknown) => {
          const slot = index++;
          if (states.length <= slot) states[slot] = initial;
          return [states[slot], (next: unknown) => { states[slot] = next; }];
        },
        useEffect: (effect: () => void) => { if (!mounted) effects.push(effect); },
        useMemo: (factory: () => unknown) => factory(),
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { index = 0; exports.ThemeProvider({ children: null }); return value; };
  render();
  assert.equal(value.theme, "light", "server and first hydration render agree");
  assert.equal(value.ready, false);
  const beforeMount = dataset.theme;
  effects.forEach((effect) => effect()); mounted = true; render();
  return { render, dataset, writes, beforeMount, get value() { return value; } };
}

test("explicit preferences survive hydration navigation login logout and reload without implicit writes", () => {
  const storage = new Map([[preferences.THEME_STORAGE_KEY, "dark"]]);
  const browser = providerHarness(storage);
  assert.equal(browser.beforeMount, "dark", "boot applies saved dark before hydration");
  assert.equal(browser.value.theme, "dark");
  assert.equal(browser.dataset.theme, "dark");
  assert.deepEqual(browser.writes, []);
  browser.value.toggleTheme(); browser.render();
  assert.equal(browser.dataset.theme, "light");
  browser.value.toggleTheme(); browser.render();
  assert.equal(browser.dataset.theme, "dark");
  for (const transition of ["navigation", "login", "logout"]) {
    browser.render();
    assert.equal(browser.dataset.theme, "dark", transition);
  }
  assert.deepEqual(browser.writes, ["light", "dark"]);
  assert.equal(providerHarness(storage).dataset.theme, "dark");
  const firstVisit = providerHarness(new Map());
  assert.equal(firstVisit.dataset.theme, "light");
  assert.deepEqual(firstVisit.writes, [], "absence stays absent until an explicit choice");
});

test("server output is light and both root layouts apply the same script before content", () => {
  function Observer() {
    const { theme, ready } = useTheme();
    return createElement("span", null, `${theme}:${ready}`);
  }
  assert.equal(renderToStaticMarkup(createElement(ThemeProvider, null, createElement(Observer))), "<span>light:false</span>");
  for (const path of ["../../app/layout.tsx", "../../../admin-web/app/layout.tsx"]) {
    const layout = read(path);
    assert.match(layout, /suppressHydrationWarning data-theme="light"/);
    assert.match(layout, /<head><script dangerouslySetInnerHTML=\{\{ __html: THEME_BOOT_SCRIPT \}\} \/><\/head>/);
    assert.ok(layout.indexOf("THEME_BOOT_SCRIPT }}") < layout.indexOf("<body>"));
    assert.match(layout, /<ThemeProvider>\{children\}<\/ThemeProvider>/);
  }
});

test("all existing dashboard authentication variants use theme-aware controls without resetting preferences", () => {
  const login = read("../../app/login/page.tsx");
  const form = read("../components/LoginForm.tsx");
  for (const variant of ["no-dashboard-access", "session-expired"]) assert.ok(login.includes(variant));
  for (const state of ["request_code", "verify_code", "Sending code...", "Verifying...", "form-error", "notice", "Change email"]) assert.ok(form.includes(state));
  for (const className of ["field-label", "text-input", "primary-button", "ghost-button"]) assert.ok(form.includes(className));
  assert.match(login, /<ThemeSwitchButton \/>/);
  const css = read("../../app/globals.css");
  assert.match(css, /\.login-callout\s*\{[\s\S]*?background: var\(--surface-raised\)/);
  assert.match(css, /\.form-error\s*\{[\s\S]*?color: var\(--danger\)/);
  assert.match(css, /\.text-input:focus-visible\s*\{[\s\S]*?var\(--accent\)/);
  const denied = read("../../app/app/access-denied/page.tsx");
  assert.match(denied, /no-dashboard-access/);
  assert.match(denied, /className="section-card"/);
  for (const path of ["../../app/api/auth/logout/route.ts", "../../app/api/auth/verify-code/route.ts", "../components/LoginForm.tsx"]) {
    assert.doesNotMatch(read(path), /peritio\.theme|localStorage\.clear|setTheme\(/);
  }
});
