import assert from "node:assert/strict";
import { promises as fs, type PathLike } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ApiDatabase } from "@voicepractice/shared";
import { createDatabaseStorage } from "./storage.js";

const snapshot = (revision: string) => ({ users: [], orgs: [],
  config: { fixtureText: "x".repeat(40_000), revision } }) as unknown as ApiDatabase;

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "peritio-file-publication-"));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const dbPath = path.join(directory, "db.json");
  const storage = createDatabaseStorage({ provider: "file", dbPath, databaseUrl: null,
    pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1,
    ensureDatabaseShape: value => value as ApiDatabase, createDefaultDatabase: () => snapshot("initial") });
  return { directory, dbPath, storage };
}

test("file snapshot readers cannot observe a paused 16384-byte partial write", { timeout: 5000 }, async t => {
  const { directory, dbPath, storage } = await fixture(t);
  const before = snapshot("before"), after = snapshot("after");
  await fs.writeFile(dbPath, JSON.stringify(before), "utf8");
  const write = fs.writeFile;
  let resume!: () => void, markPartial!: () => void;
  const paused = new Promise<void>(resolve => { markPartial = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
    const [target, data, options] = args;
    if (String(target) !== dbPath && !String(target).startsWith(dbPath + ".")) return write(...args);
    assert.equal(typeof data, "string");
    const json = String(data), partial = json.slice(0, 16_384);
    assert.equal(Buffer.byteLength(partial), 16_384);
    assert.throws(() => JSON.parse(partial), SyntaxError);
    await write(target, partial, options);
    markPartial();
    await released;
    await fs.appendFile(target, json.slice(16_384), "utf8");
  });
  const saving = storage.save(after);
  try {
    await paused;
    // A raw external reader reproduces readDb(), without the API's mutation lock.
    assert.deepEqual(JSON.parse(await fs.readFile(dbPath, "utf8")), before);
  } finally {
    resume();
    await saving;
  }
  assert.deepEqual(await storage.loadRaw(), after);
  assert.deepEqual(await fs.readdir(directory), ["db.json"]);
});

for (const failure of ["write", "rename"] as const) {
  test(`failed file snapshot ${failure} preserves committed JSON and removes its temporary file`, async t => {
    const { directory, dbPath, storage } = await fixture(t);
    const before = snapshot("before");
    await fs.writeFile(dbPath, JSON.stringify(before), "utf8");
    const injected = new Error(`injected ${failure} failure`);
    if (failure === "write") {
      const write = fs.writeFile;
      t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
        await write(args[0], "{partial", args[2]);
        throw injected;
      });
    } else {
      t.mock.method(fs, "rename", async () => { throw injected; });
    }
    await assert.rejects(storage.save(snapshot("after")), error => error === injected);
    assert.deepEqual(JSON.parse(await fs.readFile(dbPath, "utf8")), before);
    assert.deepEqual(await fs.readdir(directory), ["db.json"]);
  });
}

test("initial file snapshot loads repeatedly without leaving temporary files", async t => {
  const { directory, storage } = await fixture(t);
  assert.deepEqual(await storage.loadRaw(), snapshot("initial"));
  assert.deepEqual(await storage.loadRaw(), snapshot("initial"));
  assert.deepEqual(await fs.readdir(directory), ["db.json"]);
});

test("initial database creation stays unpublished until the complete snapshot can be renamed", { timeout: 5000 }, async t => {
  const { directory, dbPath, storage } = await fixture(t);
  const rename = fs.rename;
  let publish!: () => void, markReady!: () => void;
  const held = new Promise<void>(resolve => { markReady = resolve; });
  const released = new Promise<void>(resolve => { publish = resolve; });
  t.mock.method(fs, "rename", async (source: PathLike, destination: PathLike) => {
    if (String(destination) === dbPath) {
      assert.deepEqual(JSON.parse(await fs.readFile(source, "utf8")), snapshot("initial"));
      markReady(); await released;
    }
    await rename(source, destination);
  });
  const initializing = storage.loadRaw();
  try {
    await held;
    await assert.rejects(fs.readFile(dbPath), { code: "ENOENT" });
  } finally {
    publish(); await initializing;
  }
  assert.deepEqual(await storage.loadRaw(), snapshot("initial"));
  assert.deepEqual(await fs.readdir(directory), ["db.json"]);
});
