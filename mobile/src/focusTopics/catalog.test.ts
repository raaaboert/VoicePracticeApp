import assert from "node:assert/strict";
import test from "node:test";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import { createFocusTopicCatalogController, homeFocusTopicPreview } from "./catalog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const topics = Array.from({ length: 6 }, (_, i) => ({ id: `topic_${i}`, name: `Topic ${i}`,
  description: "Authorized description", createdAt: "2026-01-01T00:00:00.000Z", scenarioCount: i, resourceCount: 6 - i }));

test("Home previews only two company-ordered Topics while the shared catalog retains every Topic", async () => {
  const catalog = createFocusTopicCatalogController(async () => ({ topics }));
  await catalog.refresh();
  assert.deepEqual(homeFocusTopicPreview(catalog.getSnapshot()), topics.slice(0, 2));
  assert.deepEqual(catalog.getSnapshot().topics, topics);
});

test("missing learner activity uses deterministic company order, never global Topic creation as practice/assignment recency", () => {
  const ordered = [
    { ...topics[3]!, createdAt: "2020-01-01T00:00:00.000Z" },
    { ...topics[1]!, createdAt: "2024-01-01T00:00:00.000Z" },
    { ...topics[0]!, createdAt: "2026-10-20T00:00:00.000Z" },
  ];
  const state = { topics: ordered, loading: false, error: null };
  assert.deepEqual(homeFocusTopicPreview(state), ordered.slice(0, 2));
  assert.deepEqual(homeFocusTopicPreview(state), homeFocusTopicPreview(state));
  assert.deepEqual(state.topics, ordered, "Home must not reorder the full catalog");
  assert.deepEqual(homeFocusTopicPreview({ ...state, topics: [ordered[2]!] }), [ordered[2]]);
});

test("Home selects the latest applicable assignment or completed practice, with stable ties and unchanged full catalog", () => {
  const assignment = { ...topics[0]!, latestAssignmentAt: "2026-10-19T12:00:00.000Z" };
  const practiced = { ...topics[1]!, lastCompletedPracticeAt: "2026-10-18T12:00:00.000Z" };
  const missing = topics[2]!;
  const preview = (rows: MobileFocusTopicCatalogItem[]) => homeFocusTopicPreview({ topics: rows, loading: false, error: null });
  assert.deepEqual(preview([practiced, missing, assignment]), [assignment, practiced], "new assignment outranks older practice");
  const recent = { ...practiced, lastCompletedPracticeAt: "2026-10-20T12:00:00.000Z" };
  assert.deepEqual(preview([assignment, missing, recent]), [recent, assignment], "new practice outranks assignment");
  const both = { ...recent, latestAssignmentAt: "2026-10-21T12:00:00.000Z" };
  assert.deepEqual(preview([assignment, both]), [both, assignment], "latest qualifying event wins");
  const tie = { ...practiced, lastCompletedPracticeAt: assignment.latestAssignmentAt };
  assert.deepEqual(preview([tie, assignment]), [tie, assignment]);
  const rows = [missing, assignment, recent];
  preview(rows);
  assert.deepEqual(rows, [missing, assignment, recent], "no mutation of company catalog order");
});

test("loading, empty, error and retry remain distinct and never retain stale Topics", async () => {
  let fail = false;
  const catalog = createFocusTopicCatalogController(async () => { if (fail) throw new Error("private error"); return { topics }; });
  assert.equal(catalog.getSnapshot().loading, true);
  await catalog.refresh();
  fail = true;
  const request = catalog.refresh();
  assert.equal(catalog.getSnapshot().topics, null);
  await request;
  assert.equal(catalog.getSnapshot().loading, false);
  assert.match(catalog.getSnapshot().error!, /could not be loaded/);
  assert.doesNotMatch(catalog.getSnapshot().error!, /private error/);
  fail = false; await catalog.refresh();
  assert.deepEqual(homeFocusTopicPreview(catalog.getSnapshot()), topics.slice(0, 2));
  const empty = createFocusTopicCatalogController(async () => ({ topics: [] }));
  await empty.refresh();
  assert.deepEqual(empty.getSnapshot(), { topics: [], loading: false, error: null });
});

test("Home and View All join one catalog request rather than starting independent catalogs", async () => {
  const response = deferred<{ topics: typeof topics }>();
  let calls = 0;
  const catalog = createFocusTopicCatalogController(() => { calls++; return response.promise; });
  const home = catalog.refresh(), viewAll = catalog.refresh();
  assert.equal(home, viewAll);
  assert.equal(calls, 1);
  response.resolve({ topics }); await home;
  assert.equal(catalog.getSnapshot().topics?.length, 6);
});

test("account/organization disposal aborts requests and ignores late success or failure", async () => {
  for (const outcome of ["success", "failure"]) {
    const response = deferred<{ topics: typeof topics }>();
    let signal!: AbortSignal;
    const previous = createFocusTopicCatalogController((next) => { signal = next; return response.promise; });
    const pending = previous.refresh();
    previous.invalidate();
    const current = createFocusTopicCatalogController(async () => ({ topics: [topics[4]!] }));
    assert.equal(current.getSnapshot().topics, null);
    await current.refresh();
    if (outcome === "success") response.resolve({ topics }); else response.reject(new Error("late error"));
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(previous.getSnapshot().topics, null);
    assert.deepEqual(current.getSnapshot().topics, [topics[4]!]);
  }
});

test("return refresh replaces revoked Topics and invalidated requests cannot overwrite a newer response", async () => {
  const response = deferred<{ topics: typeof topics }>();
  let calls = 0;
  const catalog = createFocusTopicCatalogController(async () => ++calls === 1 ? response.promise : { topics: [] });
  const old = catalog.refresh(); catalog.invalidate();
  await catalog.refresh(); response.resolve({ topics }); await old;
  assert.deepEqual(catalog.getSnapshot().topics, []);
  await catalog.refresh(); assert.equal(calls, 3);
});
