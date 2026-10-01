import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { DashboardAdminManagerOption } from "@voicepractice/shared";

import {
  filterManagerOptions,
  managerSelectionLabel,
  moveManagerHighlight,
  normalizeManagerSearch,
} from "./ManagerCombobox";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const comboboxSource = readFileSync(join(componentsDir, "ManagerCombobox.tsx"), "utf8");
const cssSource = readFileSync(join(componentsDir, "../../app/globals.css"), "utf8");

const OPTIONS: DashboardAdminManagerOption[] = [
  {
    userId: "manager_robert",
    email: "robert@example.com",
    firstName: "Robert",
    lastName: "Dautel",
    displayName: "Robert Dautel",
  },
  {
    userId: "manager_alice",
    email: "asmith@example.com",
    firstName: "Alice",
    lastName: "Smith",
    displayName: "Alice Smith",
  },
];

test("manager search normalizes whitespace and matches first name, last name, full name, and email", () => {
  assert.equal(normalizeManagerSearch("  ROBERT   Dautel "), "robert dautel");
  assert.deepEqual(filterManagerOptions(OPTIONS, "robert").map((option) => option.userId), ["manager_robert"]);
  assert.deepEqual(filterManagerOptions(OPTIONS, "DAUTEL").map((option) => option.userId), ["manager_robert"]);
  assert.deepEqual(filterManagerOptions(OPTIONS, "Robert   Dautel").map((option) => option.userId), ["manager_robert"]);
  assert.deepEqual(filterManagerOptions(OPTIONS, "ASMITH@EXAMPLE.COM").map((option) => option.userId), ["manager_alice"]);
  assert.deepEqual(filterManagerOptions(OPTIONS, "nobody").map((option) => option.userId), []);
});

test("current manager and Unassigned selection labels initialize explicitly", () => {
  assert.equal(managerSelectionLabel(OPTIONS, "manager_robert"), "Robert Dautel");
  assert.equal(managerSelectionLabel(OPTIONS, ""), "Unassigned");
  assert.equal(managerSelectionLabel(OPTIONS, "inactive_manager", "Former Manager"), "Former Manager");
});

test("keyboard highlight movement wraps and handles an empty result list", () => {
  assert.equal(moveManagerHighlight(-1, 1, 3), 0);
  assert.equal(moveManagerHighlight(-1, -1, 3), 2);
  assert.equal(moveManagerHighlight(2, 1, 3), 0);
  assert.equal(moveManagerHighlight(0, -1, 3), 2);
  assert.equal(moveManagerHighlight(0, 1, 0), -1);
});

test("combobox keeps the existing manager option set and managerUserId draft contract", () => {
  assert.equal(adminSource.includes("options={managerOptions}"), true);
  assert.equal(adminSource.includes("onChange={(managerUserId) => updateDraft(user.userId, { managerUserId })}"), true);
  assert.equal(adminSource.includes("body.managerUserId = draft.managerUserId || null"), true);
  assert.equal(adminSource.includes("[user.userId]: createDraft(user)"), true);
  assert.equal(adminSource.includes('<option value="user">User</option>'), true);
  assert.equal(adminSource.includes('<option value="user_admin">User Admin</option>'), true);
});

test("combobox exposes listbox semantics, keyboard controls, empty copy, and bounded scrolling", () => {
  assert.equal(comboboxSource.includes('role="combobox"'), true);
  assert.equal(comboboxSource.includes('role="listbox"'), true);
  assert.equal(comboboxSource.includes('role="option"'), true);
  assert.equal(comboboxSource.includes('event.key === "ArrowDown" || event.key === "ArrowUp"'), true);
  assert.equal(comboboxSource.includes('event.key === "Enter"'), true);
  assert.equal(comboboxSource.includes('event.key === "Escape"'), true);
  assert.equal(comboboxSource.includes('scrollIntoView({ block: "nearest" })'), true);
  assert.equal(comboboxSource.includes("No matching managers"), true);
  assert.equal(cssSource.includes("max-height: 16rem"), true);
  assert.equal(cssSource.includes("overflow-y: auto"), true);
});

test("a long eligible-manager list remains filterable without changing candidate identity", () => {
  const longList = Array.from({ length: 250 }, (_, index): DashboardAdminManagerOption => ({
    userId: `manager_${index}`,
    email: `manager.${index}@example.com`,
    firstName: "Manager",
    lastName: String(index),
    displayName: `Manager ${index}`,
  }));
  const all = filterManagerOptions(longList, "");
  assert.equal(all.length, 251);
  assert.equal(all[0]?.userId, "");
  assert.deepEqual(filterManagerOptions(longList, "manager.249@example.com").map((option) => option.userId), ["manager_249"]);
});
