import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual effect body without loading native screen dependencies.
const source = readFileSync(new URL("./PerformanceScreen.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("PerformanceScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effectBody = "";
function findEffect(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
    const effect = node.arguments[0];
    if (effect && ts.isArrowFunction(effect) && ts.isBlock(effect.body)
      && effect.body.getText(parsed).includes("consumedInitialPlanIdRef.current")) {
      effectBody = effect.body.statements.map((statement) => statement.getText(parsed)).join("\n");
    }
  }
  ts.forEachChild(node, findEffect);
}
findEffect(parsed);
assert.ok(effectBody, "Notification navigation must have a consumption guard");
const runEffect = new Function("loadState", "initialPlanId", "consumedInitialPlanIdRef", "openPlan", effectBody) as (
  state: string, id: string | null, consumed: { current: string | null }, open: (id: string) => void,
) => void;

test("notification goal target is consumed once despite closing refreshing creating or reloading", () => {
  const consumed = { current: null as string | null };
  const requests: string[] = [];
  const open = (id: string) => { requests.push(id); };
  runEffect("loading", "goal-a", consumed, open);
  assert.deepEqual(requests, []);
  runEffect("ready", "goal-a", consumed, open);
  runEffect("ready", "goal-a", consumed, open); // repeated effect / closed detail
  for (let reload = 0; reload < 3; reload++) { // Refresh, Create Goal, reload
    runEffect("loading", "goal-a", consumed, open);
    runEffect("ready", "goal-a", consumed, open);
  }
  assert.deepEqual(requests, ["goal-a"]);
  assert.match(source, /const consumedInitialPlanIdRef = useRef<string \| null>\(null\)/);
});

test("new incoming goal opens once when ready and is consumed before its detail request", () => {
  const consumed = { current: "goal-a" as string | null };
  const requests: string[] = [];
  const open = (id: string) => {
    assert.equal(consumed.current, id, "must consume synchronously before starting a request");
    requests.push(id);
  };
  runEffect("loading", "goal-b", consumed, open);
  runEffect("error", "goal-b", consumed, open);
  runEffect("ready", "goal-b", consumed, open);
  runEffect("ready", "goal-b", consumed, open);
  runEffect("ready", null, consumed, open);
  assert.deepEqual(requests, ["goal-b"]);
  const remounted = { current: null };
  runEffect("ready", "goal-b", remounted, (id) => requests.push(id));
  assert.deepEqual(requests, ["goal-b", "goal-b"], "a new mounted target has its own consumption state");
});
