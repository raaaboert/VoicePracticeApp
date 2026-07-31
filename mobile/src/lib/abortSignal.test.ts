import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToAbort } from "./abortSignal";

test("subscribeToAbort delivers an in-progress cancellation exactly once", () => {
  const controller = new AbortController();
  let cancellationCount = 0;
  const unsubscribe = subscribeToAbort(controller.signal, () => {
    cancellationCount += 1;
  });

  controller.abort();
  controller.abort();
  unsubscribe();

  assert.equal(cancellationCount, 1);
});

test("subscribeToAbort immediately settles work whose signal was already cancelled", () => {
  const controller = new AbortController();
  controller.abort();
  let cancellationCount = 0;

  subscribeToAbort(controller.signal, () => {
    cancellationCount += 1;
  });

  assert.equal(cancellationCount, 1);
});

test("subscribeToAbort can detach before cancellation", () => {
  const controller = new AbortController();
  let cancellationCount = 0;
  const unsubscribe = subscribeToAbort(controller.signal, () => {
    cancellationCount += 1;
  });

  unsubscribe();
  controller.abort();

  assert.equal(cancellationCount, 0);
});
