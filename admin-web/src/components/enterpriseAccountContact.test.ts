import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createOrganizationContactDraft,
  validateOrganizationContact,
} from "./enterpriseAccountContact";

const componentSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "EnterpriseAccountContactCard.tsx"),
  "utf8",
);

test("organization contact editor initializes and restores the persisted values", () => {
  const persisted = createOrganizationContactDraft({
    contactName: "Alex Admin",
    contactEmail: "alex@acme.example",
  });

  assert.deepEqual(persisted, {
    contactName: "Alex Admin",
    contactEmail: "alex@acme.example",
  });
  assert.deepEqual(createOrganizationContactDraft(persisted), persisted);
});

test("organization contact editor rejects blank names and invalid email addresses", () => {
  assert.deepEqual(validateOrganizationContact({ contactName: "  ", contactEmail: "alex@acme.example" }), {
    error: "Contact name is required.",
  });
  assert.deepEqual(validateOrganizationContact({ contactName: "Alex Admin", contactEmail: "not-an-email" }), {
    error: "Enter a valid contact email address.",
  });
});

test("organization contact editor trims and narrows the contact update payload", () => {
  const result = validateOrganizationContact({
    contactName: "  Alex Admin  ",
    contactEmail: "  alex@acme.example  ",
  });

  assert.deepEqual(result, {
    payload: {
      contactName: "Alex Admin",
      contactEmail: "alex@acme.example",
    },
  });
  assert.deepEqual(Object.keys("payload" in result ? result.payload : {}), ["contactName", "contactEmail"]);
});

test("organization contact editor keeps save failures recoverable and protects pending saves", () => {
  assert.match(componentSource, /catch \(caught\) \{\s*setError\(/);
  assert.match(componentSource, /if \(saving\) \{\s*return;/);
  assert.match(componentSource, /className="primary" onClick=\{\(\) => void save\(\)\} disabled=\{saving\}/);
  assert.match(componentSource, /onClick=\{cancelEditing\} disabled=\{saving\}/);
  assert.match(componentSource, /setDraft\(persisted\);\s*setError\(null\);\s*setEditing\(false\);/);
  assert.match(componentSource, /setDisplayed\(nextDisplayed\);\s*setEditing\(false\);/);
  assert.match(componentSource, /setEditing\(false\);\s*setNotice\("Contact information saved\."\);/);
});
