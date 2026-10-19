import assert from "node:assert/strict";
import test from "node:test";
import { createTtsPlaybackHarness as harness, deferred, flush, ready } from "./ttsPlayback.testSupport";

test("an already-loaded player starts without another loaded event, but completes only after real playback", async () => {
  const h = harness(); const run = h.make(); await flush();
  const sound = h.sounds[0]; assert.equal(sound.reads, 1); assert.equal(sound.plays, 1); assert.equal(run.started(), 0);
  sound.emit({ playing: true }); sound.emit({ playing: false, didJustFinish: true });
  assert.equal((await run.promise).outcome, "remote_tts_completed"); assert.equal(run.started(), 1);
  assert.equal(sound.removedListeners, 1); assert.equal(sound.removed, 1); assert.equal(h.refs.remoteTtsSoundRef.current, null);
});

test("a player loading after subscription resolves readiness once despite duplicate loaded events", async () => {
  const h = harness(); h.configure((sound) => { sound.status.isLoaded = false; });
  const run = h.make(); await flush(); const sound = h.sounds[0]; assert.equal(sound.plays, 0);
  sound.emit({ isLoaded: true }); sound.emit({ isLoaded: true }); await flush(); assert.equal(sound.plays, 1);
  sound.emit({ playing: true }); sound.emit({ playing: false, didJustFinish: true });
  assert.equal((await run.promise).outcome, "remote_tts_completed"); assert.equal(run.started(), 1);
});

test("loaded event during snapshot read is not lost or undone by an older unloaded snapshot", async () => {
  const h = harness(); h.configure((sound) => {
    sound.status.isLoaded = false;
    sound.read = () => { const older = { ...sound.status }; sound.emit({ isLoaded: true }); return older; };
  });
  const run = h.make(); await flush(); const sound = h.sounds[0]; assert.equal(sound.plays, 1);
  sound.emit({ playing: true }); sound.emit({ playing: false, didJustFinish: true });
  assert.equal((await run.promise).outcome, "remote_tts_completed");
});

for (const phase of ["snapshot", "event", "read-throws", "ready-then-failed"] as const) {
  test(`native load failure via ${phase} rejects without playing, waiting for timeout or logging native text`, async () => {
    const h = harness(); h.configure((sound) => {
      sound.status.isLoaded = false;
      const failure = { isLoaded: false, error: "PRIVATE_NATIVE_PATH_SENTINEL", playbackState: "failed" };
      if (phase === "snapshot") Object.assign(sound.status, failure);
      if (phase === "read-throws") sound.read = () => { throw Error("PRIVATE_NATIVE_PATH_SENTINEL"); };
      if (phase === "ready-then-failed") sound.read = () => {
        sound.emit({ isLoaded: true }); sound.emit(failure); return { ...ready };
      };
    });
    const run = h.make(); const rejected = assert.rejects(run.promise, /native_audio_failure/);
    await flush(); const sound = h.sounds[0];
    if (phase === "event") sound.emit({ error: "PRIVATE_NATIVE_PATH_SENTINEL", playbackState: "failed" });
    await rejected; assert.equal(sound.plays, 0); assert.equal(sound.removed, 1); assert.equal(sound.removedListeners, 1);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_NATIVE_PATH_SENTINEL|PRIVATE_SPEECH_SENTINEL|PRIVATE_TOKEN_SENTINEL/);
  });
}

test("cancellation during loading settles promptly, removes listener and never starts playback", async () => {
  const h = harness(); h.configure((sound) => { sound.status.isLoaded = false; });
  const run = h.make(); await flush(); const sound = h.sounds[0]; run.abort.abort();
  assert.equal((await run.promise).outcome, "tts_cancelled");
  sound.emit({ isLoaded: true, playing: true, didJustFinish: true });
  assert.equal(sound.plays, 0); assert.equal(run.started(), 0); assert.equal(sound.removedListeners, 1);
});

test("native play exceptions become safe categorical failures without leaking native descriptions", async () => {
  const h = harness(); h.configure((sound) => { sound.onPlay = () => { throw Error("PRIVATE_NATIVE_PATH_SENTINEL"); }; });
  await assert.rejects(h.make().promise, /native_audio_failure/);
  assert.equal(h.sounds[0].removed, 1); assert.equal(h.sounds[0].removedListeners, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_NATIVE_PATH_SENTINEL/);
});

test("abort during listener registration cleans the newly attached listener too", async () => {
  const h = harness(); const abort = new AbortController();
  h.configure((sound) => { sound.onSubscribe = () => abort.abort(); });
  const run = h.make(abort); assert.equal((await run.promise).outcome, "tts_cancelled");
  assert.equal(h.sounds[0].removedListeners, 1); assert.equal(h.sounds[0].plays, 0);
});

test("snapshot playing/finish flags and volume zero cannot stand in for actual playback completion", async () => {
  const h = harness(); h.configure((sound) => { sound.volume = 0; sound.status.playing = true; sound.status.didJustFinish = true; });
  const run = h.make(); await flush(); const sound = h.sounds[0];
  assert.equal(sound.plays, 1); assert.equal(run.started(), 0);
  sound.emit({ playing: false, didJustFinish: true }); assert.equal(run.started(), 0);
  sound.emit({ playing: true, didJustFinish: false }); sound.emit({ playing: false, didJustFinish: true });
  assert.equal((await run.promise).outcome, "remote_tts_completed"); assert.equal(run.started(), 1);
});

test("native interruption without a finish event remains incomplete until bounded playback timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(); const run = h.make(); await flush(); const sound = h.sounds[0];
  sound.emit({ playing: true }); sound.emit({ playing: false, didJustFinish: false });
  t.mock.timers.tick(60_000);
  const result = await run.promise;
  assert.equal(result.outcome, "remote_started_then_failed_unblocked"); assert.equal(result.reason, "playback_timeout");
  assert.equal(result.timedOut, true); assert.equal(sound.removed, 1);
});

test("audio load timeout keeps its bound and distinct diagnostic", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(); h.configure((sound) => { sound.status.isLoaded = false; });
  const run = h.make(); const rejected = assert.rejects(run.promise, /audio_load_timeout/); await flush();
  t.mock.timers.tick(20_000); await rejected;
  assert.equal(h.sounds[0].removedListeners, 1); assert.equal(h.sounds[0].plays, 0);
});

test("old cleanup overlapping a replacement cannot delete its file, stop its player or deliver stale playback", async () => {
  const h = harness(); const old = h.make(); await flush(); const first = h.sounds[0];
  const deletion = deferred(); h.delayDeletion(deletion.promise); old.abort.abort(); await flush();
  const replacement = h.make(); await flush(); const second = h.sounds[1];
  assert.equal(second.plays, 1); const replacementFile = h.refs.remoteTtsFileRef.current;
  deletion.resolve(); await old.promise; await flush();
  first.emit({ playing: true, didJustFinish: true });
  assert.equal(second.removed, 0); assert.equal(h.refs.remoteTtsSoundRef.current, second);
  assert.equal(h.deleted.includes(replacementFile!), false); assert.equal(replacement.started(), 0);
  second.emit({ playing: true }); second.emit({ playing: false, didJustFinish: true });
  assert.equal((await replacement.promise).outcome, "remote_tts_completed");
});

test("provider fetch failures remain separate from native/load/playback failures", async () => {
  const h = harness(); h.failFetch(new Error("Safe service unavailable"));
  await assert.rejects(h.make().promise, /fetch/);
  assert.equal(h.sounds.length, 0); assert.match(JSON.stringify(h.logs), /foreground_tts_failed/);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_SPEECH_SENTINEL|PRIVATE_TOKEN_SENTINEL/);
});
