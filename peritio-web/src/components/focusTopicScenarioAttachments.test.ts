import assert from "node:assert/strict";
import test from "node:test";
import { workspaceHarness, nodes, textOf, button, settle } from "../../../admin-web/src/components/topicWorkspace.testSupport";

const wait = () => new Promise(resolve => setTimeout(resolve, 180));
for (const surface of ["dashboard", "master"] as const) {
  function fixture() {
    const calls: Array<{ scope: string; operation: string; data: any }> = [];
    let lifecycleManaged = false, isHomeTopic = false;
    let topicStatus: "active" | "draft" | "archived" = "active";
    const scenario = (id: string, kind = "org") => ({ id, kind, title: `Scenario ${id}`, role: "Seller",
      industries: ["Sales"], available: true, availability: "Eligible for learners with this Role and industry",
      lifecycleManaged: id === "a" && lifecycleManaged, isHomeTopic: id === "a" && isHomeTopic });
    let attached = [{ id: "rel-a", scenario: scenario("a"), attachedAt: "2026-10-01T00:00:00Z", attachedBy: "platform_admin" }];
    let failMutation = false, failRead = false, canManage = true;
    let pending: (() => Promise<any>) | null = null;
    const props = { orgId: "org-a", topicId: "topic-a", active: true };
    const file = surface === "master" ? "./FocusTopicScenarioAttachments.tsx" : "../../../peritio-web/src/components/FocusTopicScenarioAttachments.tsx";
    const h = workspaceHarness(file, "FocusTopicScenarioAttachments", props, async (path, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      const url = new URL(path, "http://local.test");
      const operation = surface === "dashboard" ? body.action
        : init?.method === "DELETE" ? "detach_scenario" : init?.method === "POST" ? "attach_scenario" : "list_scenario_attachments";
      const data = surface === "dashboard" ? body : { ...body, page: Number(url.searchParams.get("page") ?? 1), search: url.searchParams.get("q") ?? "", attachmentId: path.split("/").pop() };
      calls.push({ scope: surface === "dashboard" ? body.orgId : path, operation, data });
      if (operation !== "list_scenario_attachments") {
        if (failMutation) throw new Error("Forbidden or duplicate attachment (409)");
        if (operation === "attach_scenario") attached = [...attached, { ...attached[0], id: "rel-b", scenario: scenario(data.scenarioId) }];
        else attached = attached.filter(row => row.id !== data.attachmentId);
        return {};
      }
      if (pending) return pending();
      if (failRead) throw new Error("Scenario search unavailable");
      const page = data.page ?? 1;
      return { topicId: props.topicId, attached: structuredClone(attached), items: data.search === "nothing" ? [] : [
        { ...scenario(page === 2 ? "c" : "b", "standard"), attached: attached.some(row => row.scenario.id === "b") },
      ], page, pageSize: 10, total: data.search === "nothing" ? 0 : 12,
        canManage: canManage && topicStatus !== "archived", topicActive: topicStatus === "active", topicStatus };
    });
    return { h, props, calls, set failMutation(value: boolean) { failMutation = value; }, set failRead(value: boolean) { failRead = value; },
      set canManage(value: boolean) { canManage = value; },
      set topicStatus(value: typeof topicStatus) { topicStatus = value; },
      set lifecycle(value: { managed: boolean; home: boolean }) {
        lifecycleManaged = value.managed; isHomeTopic = value.home;
        attached = attached.map(row => ({ ...row, scenario: scenario(row.scenario.id, row.scenario.kind) }));
      },
      set pending(value: (() => Promise<any>) | null) { pending = value; } };
  }
  async function loaded(f: ReturnType<typeof fixture>) { f.h.render(); await wait(); return f.h.render(); }

  test(`${surface}: attached count/title/type and mounted accessible search, attach refresh, scoped detach`, async () => {
    const f = fixture(); let tree = await loaded(f);
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (1)"));
    assert.ok(textOf(tree).includes("Scenario a")); assert.ok(textOf(tree).includes("Organization custom scenario"));
    assert.ok(textOf(tree).includes("Standard scenario"));
    const toggle = button(tree, "Attach existing scenario");
    assert.equal(toggle.props["aria-expanded"], false);
    assert.ok(nodes(tree, n => n.props?.id === toggle.props["aria-controls"])[0].props.hidden);
    toggle.props.onClick(); tree = f.h.render();
    assert.equal(button(tree, "Close scenario search").props["aria-expanded"], true);
    nodes(tree, n => n.props?.["aria-label"] === "Attach Scenario b")[0].props.onClick();
    await settle(); tree = f.h.render();
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (2)"));
    assert.ok(textOf(tree).includes("Scenario attached to this Topic."));
    const alreadyAttached = nodes(tree, n => n.props?.["aria-label"] === "Already attached: Scenario b")[0];
    assert.equal(alreadyAttached.props.disabled, true);
    assert.equal(textOf(alreadyAttached), "Already attached");
    assert.equal(nodes(tree, n => n.props?.["aria-label"] === "Attach Scenario b").length, 0);
    assert.equal(button(tree, "Close scenario search").props["aria-expanded"], true);
    const before = f.calls.length;
    nodes(tree, n => n.props?.["aria-label"] === "Detach Scenario a")[0].props.onClick(); await settle(); tree = f.h.render();
    assert.equal(f.calls[before].operation, "detach_scenario");
    assert.equal(f.calls[before].data.attachmentId, "rel-a");
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (1)")); f.h.unmount();
  });

  test(`${surface}: search/page changes request scoped ten-row server pages; no-results and read/mutation errors stay honest`, async () => {
    const f = fixture(); let tree = await loaded(f);
    button(tree, "Attach existing scenario").props.onClick(); tree = f.h.render();
    button(tree, "Next").props.onClick(); tree = f.h.render(); await wait(); tree = f.h.render();
    assert.equal(f.calls.at(-1)?.data.page, 2); assert.ok(textOf(tree).includes("Showing 11–12 of 12"));
    nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "nothing" } });
    tree = f.h.render(); await wait(); tree = f.h.render();
    assert.equal(f.calls.at(-1)?.data.page, 1); assert.ok(textOf(tree).includes("No eligible scenarios match"));
    nodes(tree, n => n.type === "input")[0].props.onChange({ target: { value: "" } });
    tree = f.h.render(); await wait(); tree = f.h.render();
    f.failMutation = true;
    nodes(tree, n => n.props?.["aria-label"] === "Attach Scenario b")[0].props.onClick(); await settle(); tree = f.h.render();
    assert.ok(textOf(tree).includes("409")); assert.ok(!textOf(tree).includes("Scenario attached to this Topic."));
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (1)"));
    f.failRead = true;
    button(tree, "Retry scenarios").props.onClick(); await settle(); tree = f.h.render();
    assert.ok(textOf(tree).includes("Scenario search unavailable"));
    assert.ok(f.calls.every(call => call.scope.includes("org-a"))); f.h.unmount();
  });

  test(`${surface}: late responses from an old organization cannot replace the new Topic data`, async () => {
    const f = fixture(); let resolve!: (data: any) => void;
    f.pending = () => new Promise(next => { resolve = next; });
    f.h.render(); await wait();
    f.props.orgId = "org-b"; f.props.topicId = "topic-b"; f.pending = null;
    f.h.render(); f.h.render(); await wait(); let tree = f.h.render();
    resolve({ attached: [{ scenario: { title: "PRIVATE OLD ORG" } }], items: [], total: 0, page: 1, pageSize: 10 });
    await settle(); tree = f.h.render();
    assert.equal(textOf(tree).includes("PRIVATE OLD ORG"), false); f.h.unmount();
  });

  test(`${surface}: scoped managers see relationships without full-catalog or mutation controls`, async () => {
    const f = fixture(); f.canManage = false; const tree = await loaded(f);
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (1)"));
    assert.equal(nodes(tree, n => n.type === "input" || n.type === "button").length, 0);
    assert.ok(textOf(tree).includes("An Organization Admin manages existing scenario attachments")); f.h.unmount();
  });

  test(`${surface}: Create & Review home-Topic detach explains access loss, supports Cancel and only changes the association`, async () => {
    const f = fixture(); f.lifecycle = { managed: true, home: true }; let tree = await loaded(f);
    assert.ok(textOf(tree).includes("Published from Create & Review"));
    assert.ok(!textOf(tree).includes("Organization custom scenario"));
    assert.ok(textOf(tree).includes("Home Focus Topic. Detaching removes learner access through this Topic"));
    const confirmations: string[] = [];
    f.h.window.confirm = (...args: unknown[]) => { confirmations.push(String(args[0])); return false; };
    const before = f.calls.length;
    nodes(tree, n => n.props?.["aria-label"] === "Detach Scenario a")[0].props.onClick(); await settle();
    assert.equal(f.calls.length, before);
    assert.match(confirmations[0], /home Focus Topic/);
    assert.match(confirmations[0], /does not unpublish or delete/);
    assert.match(confirmations[0], /published version and review history remain unchanged/);
    f.h.window.confirm = () => true;
    nodes(tree, n => n.props?.["aria-label"] === "Detach Scenario a")[0].props.onClick(); await settle(); tree = f.h.render();
    assert.deepEqual(f.calls.slice(before).map(call => call.operation), ["detach_scenario", "list_scenario_attachments"]);
    assert.ok(textOf(tree).includes("Attached Practice Scenarios (0)")); f.h.unmount();
  });

  test(`${surface}: a lifecycle scenario attached elsewhere is labeled without falsely calling this its home Topic`, async () => {
    const f = fixture(); f.lifecycle = { managed: true, home: false }; const tree = await loaded(f);
    assert.ok(textOf(tree).includes("Published from Create & Review"));
    assert.ok(!textOf(tree).includes("Home Focus Topic. Detaching")); f.h.unmount();
  });

  test(`${surface}: archived Topics explain the restriction without implying missing organization permissions`, async () => {
    const f = fixture(); f.topicStatus = "archived"; const tree = await loaded(f);
    assert.ok(textOf(tree).includes("Attachments cannot be changed while this Focus Topic is archived."));
    assert.ok(!textOf(tree).includes("An Organization Admin manages existing scenario attachments"));
    assert.equal(nodes(tree, n => n.type === "button" || n.type === "input").length, 0); f.h.unmount();
  });

  test(`${surface}: relationship details show customer-safe information while Master Utility retains audit identifiers`, async () => {
    const f = fixture(); const tree = await loaded(f);
    const details = nodes(tree, n => n.type === "details")[0];
    assert.ok(textOf(details).includes("Attached "));
    assert.equal(textOf(details).includes("rel-a"), surface === "master");
    assert.equal(textOf(details).includes("platform_admin"), surface === "master");
    if (surface === "dashboard") assert.ok(textOf(details).includes("Only this Topic's association"));
    f.h.unmount();
  });
}
