import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { startPromptRouteHarness, ROUTE_USER_ID } from "./simulationPromptRoutes.testSupport.js";

test("existing TTS route serves actual MP3 through Realtime and sanitizes provider failures", async () => {
  const require = createRequire(import.meta.url);
  require("ws");
  const wsModule = require.cache[require.resolve("ws")]!;
  const original = wsModule.exports;
  let fail = false;
  let connections = 0;
  let closed = 0;
  class FakeSocket extends EventEmitter {
    constructor() { super(); connections++; queueMicrotask(() => this.emit("open")); }
    terminate() { closed++; this.emit("close"); }
    event(event: unknown) { this.emit("message", Buffer.from(JSON.stringify(event)), false); }
    send(raw: string) {
      const event = JSON.parse(raw);
      if (event.type === "session.update") queueMicrotask(() => this.event({ type: "session.updated" }));
      if (event.type === "response.create") queueMicrotask(() => {
        if (fail) return this.event({ type: "error", error: { message: "PRIVATE_PROVIDER_ERROR" } });
        this.event({ type: "response.output_audio.delta", delta: Buffer.alloc(24000).toString("base64") });
        this.event({ type: "response.output_audio.done" });
        this.event({ type: "response.output_audio_transcript.done", transcript: event.response.input[0].content[0].text });
        this.event({ type: "response.done", response: { status: "completed", usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 } } });
      });
    }
  }
  wsModule.exports = FakeSocket;
  const harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false, remoteTtsEnabled: true });
  try {
    // This test exercises the migrated default even if other route fixtures pin legacy HTTP mocks.
    const request = () => harness.request(`/mobile/users/${ROUTE_USER_ID}/ai/tts`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: "female-warm", text: "A synthetic response." }) });
    const success = await request();
    assert.equal(success.status, 200, await success.clone().text());
    assert.equal(success.headers.get("content-type"), "audio/mpeg");
    assert.equal(success.headers.get("cache-control"), "no-store");
    const mp3 = new Uint8Array(await success.arrayBuffer());
    assert.equal(mp3[0], 0xff);
    assert.equal(mp3[1] & 0xe0, 0xe0);
    fail = true;
    const failed = await request();
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes("PRIVATE_PROVIDER_ERROR"), false);
    assert.equal(connections, 2);
    assert.equal(closed, 2);
  } finally {
    wsModule.exports = original;
    await harness.close();
  }
});
