import assert from "node:assert/strict";
import test from "node:test";

import { buildCsv, formatCsvCell } from "./csv";

test("formatCsvCell protects spreadsheet formula prefixes", () => {
  assert.equal(formatCsvCell("=HYPERLINK(\"https://example.com\")"), `"'=HYPERLINK(""https://example.com"")"`);
  assert.equal(formatCsvCell("+1+1"), "'+1+1");
  assert.equal(formatCsvCell("-1+1"), "'-1+1");
  assert.equal(formatCsvCell("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(formatCsvCell("\tTabbed"), "'\tTabbed");
  assert.equal(formatCsvCell("   =SUM(A1:A2)"), "'   =SUM(A1:A2)");
  assert.equal(formatCsvCell("  +SUM(A1:A2)"), "'  +SUM(A1:A2)");
  assert.equal(formatCsvCell(" \t=SUM(A1:A2)"), "' \t=SUM(A1:A2)");
});

test("formatCsvCell preserves normal values and applies standard CSV escaping", () => {
  assert.equal(formatCsvCell("Normal Value"), "Normal Value");
  assert.equal(formatCsvCell("Doe, Jane"), `"Doe, Jane"`);
  assert.equal(formatCsvCell(`He said "hello"`), `"He said ""hello"""`);
  assert.equal(formatCsvCell("Line 1\nLine 2"), `"Line 1\nLine 2"`);
});

test("buildCsv formats rows with CRLF line endings", () => {
  assert.equal(
    buildCsv([
      ["Employee ID", "Name"],
      ["EMP-1", "Doe, Jane"],
    ]),
    "Employee ID,Name\r\nEMP-1,\"Doe, Jane\""
  );
});

test("buildCsv preserves Unicode user-provided values", () => {
  assert.equal(
    buildCsv([
      ["Employee ID", "Name"],
      ["EMP-UNICODE", "Zoë Nguyễn"],
    ]),
    "Employee ID,Name\r\nEMP-UNICODE,Zoë Nguyễn"
  );
});
