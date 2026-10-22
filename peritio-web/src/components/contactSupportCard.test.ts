import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactSupportCard } from "./ContactSupportCard";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("settings replaces unfinished account preferences with the support card and preserves working theme controls", () => {
  const panel = read("./ThemeSettingsPanel.tsx");
  const page = read("../../app/app/settings/page.tsx");
  assert.doesNotMatch(panel + page, /Coming next|Account preferences|More settings soon|Profile controls|notification preferences|dashboard defaults|future workspace settings/i);
  assert.match(panel, /<ContactSupportCard\s*\/>/);
  assert.match(page, /<ThemeSettingsPanel\s*\/>/);
  assert.match(page, /Choose your dashboard appearance or contact Peritio support\./);
  assert.ok(panel.indexOf('className="theme-grid"') < panel.indexOf("<ContactSupportCard"));
  assert.match(panel, /disabled=\{!ready\}/);
  assert.match(panel, /aria-pressed=\{ready && theme === option.id\}/);
  assert.match(panel, /onClick=\{\(\) => setTheme\(option.id\)\}/);
});

test("support renders a labeled compact card with a keyboard-native mail link to the owner-confirmed mailbox", () => {
  const markup = renderToStaticMarkup(createElement(ContactSupportCard));
  assert.match(markup, /<section class="section-card settings-support-card" aria-labelledby="settings-support-heading"/);
  assert.match(markup, /<h2 id="settings-support-heading">Need help\?<\/h2>/);
  assert.match(markup, /Questions about your account, training content, or using Peritio\?/);
  assert.match(markup, /<a class="ghost-button settings-support-link" href="[^"]+">/);
  assert.match(markup, /Contact Support<\/a>/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(markup, /tabindex="-1"|disabled|role="button"/);
  const href = markup.match(/href="([^"]+)"/)![1]!;
  assert.equal(href, "mailto:support@peritio.ai?subject=Peritio%20Support%20Request");
  const mail = new URL(href);
  assert.equal(mail.protocol, "mailto:");
  assert.equal(mail.pathname, "support@peritio.ai");
  assert.equal(mail.searchParams.get("subject"), "Peritio Support Request");
  assert.deepEqual([...mail.searchParams.keys()], ["subject"], "no user/org/debug details, tokens, body or extra recipients");
  const source = read("./ContactSupportCard.tsx");
  assert.doesNotMatch(source, /fetch\(|onClick|useEffect|useSession|localStorage|document\.|window\./);
});

test("support uses existing light/dark card and focus styles and the responsive section header", () => {
  const css = read("../../app/globals.css");
  assert.match(css, /\.ghost-button\s*\{[^}]*background: var\(--panel-muted\);[^}]*color: var\(--text\);/s);
  assert.match(css, /\.ghost-button:focus-visible,[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.section-header\s*\{[^}]*display: flex;/s);
  assert.match(css, /\.section-header,[^}]*flex-direction: column;[^}]*align-items: stretch;/s);
  assert.match(css, /\.settings-support-copy\s*\{\s*min-width: 0;/);
  assert.match(css, /\.settings-support-link\s*\{[^}]*display: inline-flex;[^}]*gap: 0\.5rem;/s);
  assert.match(css, /\.settings-support-card \.section-header\s*\{\s*margin-bottom: 0;/);
});
