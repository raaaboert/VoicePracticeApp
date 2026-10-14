import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSimulationStartupCoordinator } from "./simulationStartup";

const payload = { assistantText: "Pinned opening", trainingPackId: null, speechPrefetch: null };

test("registration failure prevents opening and permits a recoverable registration retry", async () => {
  const startup = createSimulationStartupCoordinator();
  let openings = 0;
  const open = () => { openings++; return Promise.resolve(payload); };
  await assert.rejects(startup.register(async () => { throw new Error("registration denied"); }), /registration denied/);
  await assert.rejects(startup.prepareOpening(open), /must be registered/);
  assert.equal(startup.registered, false);
  assert.equal(openings, 0);
  await startup.register(async () => {});
  assert.deepEqual(await startup.prepareOpening(open), payload);
  assert.equal(openings, 1);
});

test("concurrent starts and screen remounts share registration and one opening", async () => {
  const startup = createSimulationStartupCoordinator();
  let registrations = 0;
  let openings = 0;
  let release!: () => void;
  const register = () => { registrations++; return new Promise<void>((resolve) => { release = resolve; }); };
  const first = startup.register(register);
  const remounted = startup.register(register);
  assert.equal(first, remounted);
  await Promise.resolve();
  assert.equal(registrations, 1);
  release();
  await Promise.all([first, remounted]);
  const open = async () => { openings++; return payload; };
  const [a, b] = await Promise.all([startup.prepareOpening(open), startup.prepareOpening(open)]);
  assert.equal(a, b);
  await startup.register(register);
  assert.equal(await startup.prepareOpening(open), payload);
  assert.equal(registrations, 1);
  assert.equal(openings, 1);
  startup.openingMessageCommitted = true;
  startup.messages = [{ id: "opening", role: "assistant", content: payload.assistantText }];
  startup.openingDelivered = true;
  assert.equal(startup.messages.length, 1);
  assert.equal(createSimulationStartupCoordinator().registered, false, "new session has independent startup state");
});

test("opening failure retries without registering again", async () => {
  const startup = createSimulationStartupCoordinator();
  await startup.register(async () => {});
  await assert.rejects(startup.prepareOpening(async () => { throw new Error("timeout"); }), /timeout/);
  assert.equal(startup.registered, true);
  assert.equal(await startup.prepareOpening(async () => payload), payload);
});

test("screen registers before opening, guards stale results, and App retains session-scoped startup state", () => {
  const source = readFileSync(new URL("../screens/SimulationScreen.tsx", import.meta.url), "utf8");
  const start = source.slice(source.indexOf("const startSession ="), source.indexOf("const startSession =") + 22000);
  assert.ok(start.indexOf("await startup.register(") >= 0);
  assert.ok(start.indexOf("await startup.register(") < start.indexOf("if (startPlan.shouldDeliverOpening)"));
  assert.match(start, /if \(!isCurrentStartupAttempt\(\)\)/);
  assert.match(start, /recognized_start_error[\s\S]*throw startError/);
  assert.match(source, /openingPromise = startup.prepareOpening/);
  const initialization = source.slice(source.indexOf("unmountedRef.current = false;"));
  assert.doesNotMatch(initialization.split("void initialize();")[0]!, /startOpeningPrefetch\(/);
  assert.match(initialization, /openingMessageCommittedRef.current = startup.openingMessageCommitted/);
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /createSimulationStartupCoordinator\(\), \[[\s\S]*?simulationConfig\?\.simulationSessionId, user\?\.id, mobileAuthToken, activeSuperUserOrgId/);
  assert.match(app, /startup=\{simulationStartup\}/);
});
