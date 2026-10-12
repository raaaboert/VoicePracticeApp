import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { runRetiredFocusTopicReminderShim } from "./focusTopicReminderShim.js";

test("retired Focus Topic reminder executable is a side-effect-free compatibility shim", async () => {
  const source = await readFile(new URL("./focusTopicReminderWorker.ts", import.meta.url), "utf8");
  assert.match(source, /runRetiredFocusTopicReminderShim/);
  assert.doesNotMatch(source, /from "\.\/index\.js"/);
  assert.doesNotMatch(source, /runtimeConfig/);
  assert.doesNotMatch(source, /storage\//);
  assert.doesNotMatch(source, /startApiServer/);
});

test("retired Focus Topic reminder command exits successfully without configuration or database work", async () => {
  const messages: string[] = [];
  assert.deepEqual(runRetiredFocusTopicReminderShim((message) => messages.push(message)), {
    considered: 0, inserted: 0,
  });
  assert.deepEqual(messages, ["[focus-topic-reminders] retired; no action taken"]);

  const apiRoot = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
  const child = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const childProcess = spawn(process.execPath, ["--import", "tsx", "src/focusTopicReminderWorker.ts"], {
      cwd: apiRoot,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    childProcess.stdout.on("data", (chunk) => { output += chunk; });
    childProcess.stderr.on("data", (chunk) => { output += chunk; });
    childProcess.once("error", reject);
    childProcess.once("close", (code) => resolve({ code, output }));
  });
  assert.equal(child.code, 0, child.output);
  assert.match(child.output, /retired; no action taken/);
});
