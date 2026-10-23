import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the real component and event handlers with deterministic hooks/network bindings.
// This harness checks state and requests; it does not claim browser layout validation.
export function workspaceHarness(file: string, exportName: string, props: any, fetch: (path: string, init?: any) => Promise<any>) {
  let cursor = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  const listeners = new Map<string, any>();
  const document = { activeElement: { focus() {} }, getElementById: () => ({ focus() {} }),
    addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const window = { confirm: () => true, location: { href: "http://local.test/company", assign() {} },
    addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const react = {
    useState(initial: any) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (next: any) => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }];
    },
    useRef(initial: any) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
    useMemo(fn: any, _deps: any) { cursor++; return fn(); },
    useEffect(fn: () => void | (() => void), deps: any[]) {
      const slot = cursor++;
      if (!slots[slot] || deps.some((value, i) => value !== slots[slot][i])) {
        slots[slot] = deps;
        effects.push(() => { cleanups[slot]?.(); const cleanup = fn(); cleanups[slot] = typeof cleanup === "function" ? cleanup : () => {}; });
      }
    },
  };
  const cache = new Map<string, any>();
  function load(name: string): any {
    if (cache.has(name)) return cache.get(name);
    const url = new URL(name, import.meta.url);
    const require = createRequire(url);
    const module = { exports: {} as any }; cache.set(name, module.exports);
    const code = ts.transpileModule(readFileSync(url, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    }, fileName: fileURLToPath(url) }).outputText;
    new Function("require", "exports", "window", "document", code)((id: string) => {
      if (id === "react") return react;
      if (id === "../lib/api") return { adminFetch: fetch };
      if (id === "../lib/adminApiClient") return { fetchAdminApiJson: fetch };
      if (id === "./FocusTopicScenarioAttachments") return { FocusTopicScenarioAttachments: "FocusTopicScenarioAttachments" };
      if (id === "./useTopicDraftGuard") return load("./useTopicDraftGuard.tsx");
      if (id === "./WorkspaceTabs") return load("./WorkspaceTabs.tsx");
      if (id.startsWith("./Enterprise")) return new Proxy({}, { get: (_target, key) => String(key) });
      return require(id);
    }, module.exports, window, document);
    return module.exports;
  }
  const component = load(file)[exportName];
  return {
    listeners, window, document, props,
    render() { cursor = 0; const tree = component(props); effects.splice(0).forEach((effect) => effect()); return tree; },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}
export function nodes(tree: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(tree)) return tree.flatMap((entry) => nodes(entry, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
export function textOf(tree: any): string {
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
}
export function button(tree: any, label: string) {
  const result = nodes(tree, (node) => node.type === "button" && textOf(node) === label);
  if (result.length !== 1) throw new Error(`Expected one ${label} button; found ${result.length}`);
  return result[0];
}
export async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); }
