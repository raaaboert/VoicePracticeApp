import assert from "node:assert/strict";
import test from "node:test";
import { button, nodes, settle, textOf, workspaceHarness } from "./topicWorkspace.testSupport";

function topic(id: string, name: string, status = "active") {
  return { id, name, status, description: "Original notes", divisionId: null, createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-02T12:00:00Z", attachedTrainingPackIds: ["pack"], attachedCustomScenarioIds: ["custom"],
    attachedTrainingPackCount: 1, attachedCustomScenarioCount: 1 };
}
function fixture(mode = "assignments") {
  let topics = [topic("a", "Alpha"), topic("b", "Beta")];
  const requests: { path: string; init: any }[] = [];
  let failSave = false;
  let deferredRead: (() => Promise<any>) | null = null;
  let leave: (fn: () => void) => void = (fn) => fn();
  const props = { orgId: "org-a", config: null, orgUsers: [], registerLeaveGuard: (guard: any) => { if (guard) leave = guard; } };
  const h = workspaceHarness("./EnterpriseTrainingsWorkspace.tsx", "EnterpriseTrainingsWorkspace", props, async (path, init) => {
    requests.push({ path, init });
    if (path.endsWith("/order")) {
      const ids = JSON.parse(init.body).trainingIds;
      topics = ids.map((id: string) => topics.find((item) => item.id === id));
    } else if (init?.method === "PATCH") {
      if (failSave) throw new Error("Save conflict. Retry.");
      const id = path.split("/").pop();
      topics = topics.map((item) => item.id === id ? { ...item, ...JSON.parse(init.body) } : item);
      return topics.find((item) => item.id === id);
    } else if (init?.method === "POST") {
      const created = { ...topic("new", "New"), ...JSON.parse(init.body) }; topics.push(created); return created;
    }
    if (!init && deferredRead) return deferredRead();
    return { trainings: topics, orderRevision: "rev-1", authorityMode: mode, generatedAt: "2026-10-20T12:00:00Z" };
  });
  return { h, requests, get topics() { return topics; }, set failSave(value: boolean) { failSave = value; },
    defer(fn: () => Promise<any>) { deferredRead = fn; }, leave: (fn: () => void) => leave(fn) };
}
function field(tree: any, id: string) { return nodes(tree, (node) => node.props?.id === id)[0]; }
async function loaded(f: ReturnType<typeof fixture>) { f.h.render(); await settle(); return f.h.render(); }
function edit(f: ReturnType<typeof fixture>, tree: any, value = "Edited Alpha") {
  field(tree, "topic-name").props.onChange({ target: { value } }); return f.h.render();
}

test("Topic selection opens Overview with metadata, mounted views and no company catalogs in assignments mode", async () => {
  const f = fixture(); let tree = await loaded(f);
  button(tree, "Alpha").props.onClick(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Alpha");
  assert.equal(field(tree, "topic-workspace-panel-overview").props.hidden, false);
  const authority = nodes(tree, (node) => node.type === "EnterpriseFocusTopicAuthorityCard")[0];
  assert.equal(authority.props.topic.id, "a");
  assert.equal(nodes(tree, (node) => node.type === "EnterpriseTrainingPacksCard").length, 0);
  assert.ok(textOf(tree).includes("Legacy scenarios"));
  assert.equal(nodes(tree, (node) => node.type === "tr" && node.props?.tabIndex === 0).length, 0);
  f.h.unmount();
});
test("dirty Topic switching supports Cancel, Discard, and Save before proceeding", async () => {
  const f = fixture(); let tree = await loaded(f);
  button(tree, "Alpha").props.onClick(); tree = edit(f, f.h.render());
  button(tree, "Beta").props.onClick(); tree = f.h.render();
  button(tree, "Cancel").props.onClick(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Edited Alpha");
  button(tree, "Beta").props.onClick(); tree = f.h.render();
  button(tree, "Discard").props.onClick(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Beta");
  tree = edit(f, tree, "Saved Beta"); button(tree, "Alpha").props.onClick(); tree = f.h.render();
  await button(tree, "Save").props.onClick(); tree = f.h.render();
  assert.equal(f.topics[1].name, "Saved Beta");
  assert.equal(field(tree, "topic-name").props.value, "Alpha");
  assert.equal(f.requests.filter((request) => request.init?.method === "PATCH").length, 1);
  f.h.unmount();
});
test("failed dirty Save retains metadata and navigation target with recoverable feedback", async () => {
  const f = fixture(); let tree = await loaded(f); button(tree, "Alpha").props.onClick(); tree = edit(f, f.h.render());
  f.failSave = true; button(tree, "Beta").props.onClick(); tree = f.h.render();
  await button(tree, "Save").props.onClick(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Edited Alpha");
  assert.ok(textOf(tree).includes("Your changes are retained"));
  f.failSave = false; await button(tree, "Save").props.onClick(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Beta"); f.h.unmount();
});
test("routine refresh cannot overwrite dirty metadata or reset a newer Topic selection", async () => {
  const f = fixture(); let tree = await loaded(f); button(tree, "Alpha").props.onClick(); tree = edit(f, f.h.render());
  await button(tree, "Refresh Workspace").props.onClick(); await settle(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Edited Alpha");
  button(tree, "Beta").props.onClick(); tree = f.h.render(); button(tree, "Discard").props.onClick(); tree = f.h.render();
  let release: (data: any) => void = () => {};
  f.defer(() => new Promise((resolve) => { release = resolve; }));
  button(tree, "Refresh Workspace").props.onClick(); tree = f.h.render();
  button(tree, "Alpha").props.onClick(); f.h.render();
  release({ trainings: f.topics, orderRevision: "new", authorityMode: "assignments" }); await settle(); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Alpha"); f.h.unmount();
});
test("company navigation and unload protect drafts, while view changes preserve mounted form state", async () => {
  const f = fixture(); let tree = await loaded(f); button(tree, "Alpha").props.onClick(); tree = edit(f, f.h.render());
  let navigated = false; f.leave(() => { navigated = true; }); tree = f.h.render();
  assert.equal(navigated, false); button(tree, "Cancel").props.onClick(); tree = f.h.render();
  const tabs = nodes(tree, (node) => node.props?.id === "topic-workspace")[0];
  tabs.props.onChange("content"); tree = f.h.render();
  assert.equal(field(tree, "topic-name").props.value, "Edited Alpha");
  assert.equal(field(tree, "topic-workspace-panel-overview").props.hidden, true);
  let prevented = false; f.h.listeners.get("beforeunload")({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  f.leave(() => {
    navigated = true;
    let promptedAgain = false;
    f.h.listeners.get("beforeunload")({preventDefault(){promptedAgain=true;}});
    assert.equal(promptedAgain,false,"accepted Discard must not trigger a second native leave prompt");
  }); tree = f.h.render(); button(tree, "Discard").props.onClick(); assert.equal(navigated, true);
  f.h.unmount();
});
test("company order saves the complete active list without overwriting a dirty draft", async () => {
  const f = fixture(); let tree = await loaded(f); button(tree, "Alpha").props.onClick(); tree = edit(f, f.h.render());
  nodes(tree, (node) => node.props?.["aria-label"] === "Move Beta up")[0].props.onClick({stopPropagation(){}}); tree = f.h.render();
  await button(tree, "Save Company Order").props.onClick(); tree = f.h.render();
  const request = f.requests.find((entry) => entry.path.endsWith("/order"));
  assert.deepEqual(JSON.parse(request!.init.body), {expectedOrderRevision:"rev-1",trainingIds:["b","a"]});
  assert.equal(field(tree, "topic-name").props.value, "Edited Alpha"); f.h.unmount();
});
test("legacy mode retains Topic-scoped pack/scenario ownership callbacks and separate company catalogs", async () => {
  const f = fixture("legacy"); let tree = await loaded(f); button(tree, "Alpha").props.onClick(); tree = f.h.render();
  const pack = nodes(tree, (node) => node.type === "EnterpriseTrainingPacksCard")[0];
  const scenario = nodes(tree, (node) => node.type === "EnterpriseCustomScenariosCard")[0];
  assert.equal(pack.props.trainingScope.trainingId,"a"); assert.equal(scenario.props.trainingScope.trainingId,"a");
  assert.equal(typeof pack.props.trainingScope.onTrainingPackOwnershipChange,"function");
  assert.equal(typeof scenario.props.trainingScope.onScenarioOwnershipChange,"function");
  assert.equal(field(tree, "topic-workspace-panel-access").props.hidden,true); f.h.unmount();
  const company = workspaceHarness("./EnterpriseContentWorkspace.tsx","EnterpriseContentWorkspace",{orgId:"org-a",config:null,users:[],divisions:[],divisionsEnabled:false},async()=>({})).render();
  assert.equal(nodes(company,(node)=>node.type==="EnterpriseTrainingPacksCard")[0].props.trainingScope,undefined);
  assert.equal(nodes(company,(node)=>node.type==="EnterpriseCustomScenariosCard")[0].props.trainingScope,undefined);
  const routing = nodes(company,(node)=>node.type==="details" && textOf(node).includes("Advanced:"))[0]; assert.equal(routing.props.open,undefined);
});
test("Topic metadata create/save uses existing endpoints and retryable loading failure", async () => {
  const f = fixture(); let tree = await loaded(f); button(tree,"Create Focus Topic").props.onClick(); tree = edit(f,f.h.render(),"New Topic");
  await nodes(tree,(node)=>node.type==="button" && textOf(node)==="Create Focus Topic").at(-1).props.onClick(); await settle(); tree=f.h.render();
  assert.equal(f.topics[2].name,"New Topic"); assert.equal(field(tree,"topic-name").props.value,"New Topic"); f.h.unmount();
  const failed = workspaceHarness("./EnterpriseTrainingsWorkspace.tsx","EnterpriseTrainingsWorkspace",{orgId:"org-a",config:null},async()=>{throw new Error("Unavailable");});
  failed.render(); await settle(); const failTree=failed.render(); assert.ok(textOf(failTree).includes("Unavailable")); assert.equal(button(failTree,"Refresh Workspace").props.disabled,false); failed.unmount();
});
test("tab keyboard navigation wraps and uses mounted-panel ARIA targets", () => {
  const changes: string[]=[];
  const h=workspaceHarness("./WorkspaceTabs.tsx","WorkspaceTabs",{id:"test",label:"Views",value:"a",tabs:[{id:"a",label:"A"},{id:"b",label:"B"}],onChange:(id:string)=>changes.push(id)},async()=>({}));
  const tree=h.render();const a=button(tree,"A"),b=button(tree,"B");
  assert.equal(a.props.tabIndex,0);assert.equal(b.props.tabIndex,-1);assert.equal(a.props["aria-controls"],"test-panel-a");
  a.props.onKeyDown({key:"ArrowLeft",preventDefault(){}}); b.props.onKeyDown({key:"Home",preventDefault(){}});
  assert.deepEqual(changes,["b","a"]);
});

test("a late legacy ownership response updates relationships without switching back to an older Topic or replacing metadata",async()=>{
  const f=fixture("legacy");let tree=await loaded(f);button(tree,"Alpha").props.onClick();tree=f.h.render();
  const pack=nodes(tree,node=>node.type==="EnterpriseTrainingPacksCard")[0];
  button(tree,"Beta").props.onClick();tree=edit(f,f.h.render(),"Unsaved Beta");
  await pack.props.trainingScope.onTrainingPackOwnershipChange(["replacement"]);tree=f.h.render();
  assert.equal(field(tree,"topic-name").props.value,"Unsaved Beta");
  assert.equal(nodes(tree,node=>node.type==="EnterpriseTrainingPacksCard")[0].props.trainingScope.trainingId,"b");f.h.unmount();
});

test("removed Topic refresh preserves the draft without fabricating a catalog row or saving a missing record",async()=>{
  const f=fixture();let tree=await loaded(f);button(tree,"Alpha").props.onClick();tree=edit(f,f.h.render());
  f.defer(async()=>({trainings:[f.topics[1]],authorityMode:"assignments",orderRevision:"rev-new"}));
  button(tree,"Refresh Workspace").props.onClick();await settle();tree=f.h.render();
  assert.equal(field(tree,"topic-name").props.value,"Edited Alpha");
  assert.equal(nodes(tree,node=>node.type==="button" && textOf(node)==="Alpha").length,0);
  await button(tree,"Save Focus Topic").props.onClick();tree=f.h.render();
  assert.ok(textOf(tree).includes("no longer available"));assert.equal(f.requests.some(request=>request.init?.method==="PATCH"),false);f.h.unmount();
});
