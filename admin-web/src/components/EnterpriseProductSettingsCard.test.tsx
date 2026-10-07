import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { EnterpriseProductSettingsCard } from "./EnterpriseProductSettingsCard.js";

test("organization product controls render all authoritative labels and effective values", () => {
  const markup = renderToStaticMarkup(
    <EnterpriseProductSettingsCard
      settings={{
        allowCustomerScenarioCreation: true,
        requireOrgAdminScenarioApproval: false,
        allowUserAdminFocusTopicManagement: true,
        allowManagerFocusTopicManagement: false,
        updatedAt: "2026-10-06T12:00:00.000Z",
      }}
      savingSwitch={null}
      onChange={() => {}}
    />,
  );
  for (const label of [
    "Allow Customer Scenario Creation",
    "Require Org Admin Approval Before Publishing",
    "Allow User Admin Focus Topic Management",
    "Allow Manager Focus Topic Management",
  ]) {
    assert.match(markup, new RegExp(label));
  }
  assert.equal((markup.match(/role="switch"/g) ?? []).length, 4);
  assert.equal((markup.match(/checked=""/g) ?? []).length, 2);
});

test("enterprise organization page loads and updates through the authoritative product-settings API", () => {
  const source = readFileSync(new URL("../../app/users/enterprise/[orgId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /`\/orgs\/\$\{orgId\}\/product-settings`/);
  assert.match(source, /`\/orgs\/\$\{dashboard\.org\.id\}\/product-settings\/\$\{switchKey\}`/);
  assert.match(source, /method: "PATCH"/);
});
