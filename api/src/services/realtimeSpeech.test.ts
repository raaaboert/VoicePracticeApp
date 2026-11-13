import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { pcmToMp3, synthesizeRealtimeSpeech } from "./realtimeSpeech.js";

class FakeSocket extends EventEmitter {
  sent: any[] = [];
  terminated = 0;
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.terminated++; this.emit("close"); }
  event(event: unknown) { this.emit("message", Buffer.from(JSON.stringify(event)), false); }
}
const params = { apiKey: "offline-test-key", model: "gpt-realtime-2.1-mini", voice: "cedar",
  text: "Thank you for watching.", speed: 1.03, instructions: "Professional tone.", timeoutMs: 1000 };
function start(overrides = {}) {
  const socket = new FakeSocket();
  const promise = synthesizeRealtimeSpeech({ ...params, ...overrides }, (url, options) => {
    assert.equal(url, "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini");
    assert.equal(options.headers.Authorization, "Bearer offline-test-key");
    assert.equal(options.perMessageDeflate, false);
    assert.ok(options.maxPayload <= 1_048_576);
    return socket;
  });
  socket.emit("open");
  return { socket, promise };
}
function complete(socket: FakeSocket, transcript = params.text, status = "completed") {
  socket.event({ type: "session.updated" });
  const pcm = Buffer.alloc(24000);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 2 * 440 / 24000)), i * 2);
  socket.event({ type: "response.output_audio.delta", delta: pcm.toString("base64") });
  socket.event({ type: "response.output_audio.done" });
  socket.event({ type: "response.output_audio_transcript.done", transcript });
  socket.event({ type: "response.done", response: { status, usage: { input_tokens: 30, output_tokens: 50, total_tokens: 80,
    input_token_details: { text_tokens: 30 }, output_token_details: { text_tokens: 10, audio_tokens: 40 } } } });
}
test("Realtime waits for session configuration, preserves persona/speed, and returns MP3 plus actual usage", async () => {
  const { socket, promise } = start();
  assert.equal(socket.sent.length, 1);
  const session = socket.sent[0].session;
  assert.deepEqual(session.audio.output, { format: { type: "audio/pcm", rate: 24000 }, voice: "cedar", speed: 1.03 });
  assert.equal(session.audio.input.turn_detection, null);
  complete(socket);
  const response = socket.sent[1].response;
  assert.equal(response.conversation, "none");
  assert.deepEqual(response.output_modalities, ["audio"]);
  assert.equal(response.input[0].content[0].text, params.text);
  assert.match(response.instructions, /VERBATIM/);
  assert.match(response.instructions, /Professional tone/);
  const result = await promise;
  assert.equal(result.contentType, "audio/mpeg");
  assert.ok(result.audioBuffer.length > 1000);
  assert.equal(result.audioBuffer[0], 0xff);
  assert.equal(result.audioBuffer[1] & 0xe0, 0xe0, "actual MPEG frame sync, not PCM with a misleading MIME type");
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 10, totalTokens: 40 }, "audio tokens stay separate from the existing text-token allowance");
  assert.equal(socket.terminated, 1);
});
test("altered spoken content and truncated responses fail closed without leaking text", async () => {
  for (const [transcript, status] of [["I rewrote your answer", "completed"], [params.text, "incomplete"]]) {
    const { socket, promise } = start();
    complete(socket, transcript, status);
    await assert.rejects(promise, error => error instanceof Error && !error.message.includes(transcript));
    assert.equal(socket.terminated, 1);
  }
});

test("natural English numbers, USD amounts and percentages do not discard completed paid audio", async () => {
  for (const [text, spoken] of [
    ["We need 2 items.", "We need two items."],
    ["I can offer 25% off.", "I can offer twenty-five percent off."],
    ["It costs $1,250.50.", "It costs one thousand two hundred and fifty dollars and fifty cents."],
    ["Pay $0.50.", "Pay fifty cents."],
    ["You saved $25.00.", "You saved twenty-five dollars."],
    ["You saved $25.00.", "You saved twenty-five dollars and zero cents."],
    ["The rate is 3.5%.", "The rate is three point five per cent."],
  ]) {
    const { socket, promise } = start({ text });
    complete(socket, spoken);
    assert.equal((await promise).contentType, "audio/mpeg");
    assert.equal(socket.terminated, 1);
  }
});

test("numeric equivalence preserves changed amounts, units and negative signs as mismatches", async () => {
  for (const [text, spoken] of [
    ["Offer 25% off.", "Offer thirty-five percent off."],
    ["It is $100.", "It is one hundred percent."],
    ["It costs $19.99.", "It costs nineteen dollars and nine cents."],
    ["The change is -25%.", "The change is twenty-five percent."],
    ["Visit Dollar Tree.", "Visit Dollars Tree."],
  ]) {
    const { socket, promise } = start({ text });
    complete(socket, spoken);
    await assert.rejects(promise);
    assert.equal(socket.terminated, 1);
  }
});

test("completion after elapsed deadline cannot win a delayed timer callback", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const { socket, promise } = start();
  now = params.timeoutMs + 1;
  complete(socket);
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(socket.terminated, 1);
});
test("provider errors, malformed audio and early close release the socket", async () => {
  for (const scenario of ["provider", "base64", "close", "no-audio", "oversize"] as const) {
    const { socket, promise } = start();
    socket.event({ type: "session.updated" });
    if (scenario === "provider") socket.event({ type: "error", error: { message: "PRIVATE_PROVIDER_CONTENT" } });
    if (scenario === "base64") socket.event({ type: "response.output_audio.delta", delta: "!!!" });
    if (scenario === "close") socket.emit("close");
    if (scenario === "no-audio") socket.event({ type: "response.done", response: { status: "completed" } });
    if (scenario === "oversize") socket.emit("message", Buffer.alloc(1_048_577), false);
    await assert.rejects(promise, error => error instanceof Error && !error.message.includes("PRIVATE_PROVIDER_CONTENT"));
    assert.equal(socket.terminated, 1);
  }
});
test("bounded timeout terminates an unresponsive provider", async () => {
  const { socket, promise } = start({ timeoutMs: 1 });
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(socket.terminated, 1);
});
test("invalid local requests never connect and PCM bounds are enforced", async () => {
  await assert.rejects(synthesizeRealtimeSpeech({ ...params, text: "" }, () => { throw new Error("must not connect"); }), /text length/);
  assert.throws(() => pcmToMp3(Buffer.alloc(1)), /PCM length/);
  assert.throws(() => pcmToMp3(Buffer.alloc(24000 * 2 * 300 + 2)), /PCM length/);
});
