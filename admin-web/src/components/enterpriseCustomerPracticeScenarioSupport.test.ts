import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodes, settle, textOf, workspaceHarness } from "./topicWorkspace.testSupport";

const source = readFileSync(new URL("./EnterpriseCustomScenariosCard.tsx", import.meta.url), "utf8");

test("Master Utility exposes canonical customer Practice Scenario lifecycle read-only", () => {
  for (const copy of [
    "Customer Practice Scenario Lifecycle",
    "Stable scenario:",
    "Home Focus Topic:",
    "Approved version:",
    "Published version:",
    "Source references:",
    "Review comment:",
    "History:",
  ]) assert.equal(source.includes(copy), true, copy);
  assert.match(source, /practiceScenarios: CustomerPracticeScenario\[\]/);
  assert.match(source, /setPracticeScenarios\(payload\.practiceScenarios/);
  assert.match(source, /Read-only canonical scenario identities/);
});

test("Master Utility leaves lifecycle-managed legacy projections read-only", () => {
  assert.match(source, /const lifecycleManaged = Boolean\(scenario\.customerScenarioVersionId\)/);
  assert.match(source, /Managed in Focus Topic workspace/);
  assert.equal(source.includes("onClick={() => openEditEditor(scenario)}"), true);
  assert.equal(source.includes("!lifecycleManaged ? <button"), true);
  assert.equal(source.includes(">\n                              Delete\n                            </button> : null"), true);
});

test("canonical lifecycle renders discrete newest-first history, multiline comments and collapsed version detail without mutation actions",async()=>{
  const calls:string[]=[];
  const version={id:"v1",title:"Practice",status:"published",versionNumber:1,provenance:{creationMethod:"manual",sourceMode:"scratch"},sourceReferences:[],reviewNote:null};
  const h=workspaceHarness("./EnterpriseCustomScenariosCard.tsx","EnterpriseCustomScenariosCard",{orgId:"org-a",config:null},async(path,init)=>{
    calls.push(init?.method??"GET");return {orgId:"org-a",scenarios:[],effectiveIndustryIds:[],practiceScenarios:[{id:"stable",homeFocusTopicId:"topic-a",status:"published",currentVersion:version,currentVersionId:"v1",approvedVersionId:"v1",publishedVersionId:"v1",versions:[version],history:[
      {id:"old",eventType:"created",status:"draft",actorId:"author",createdAt:"2026-10-01T12:00:00Z",comment:null},
      {id:"new",eventType:"published",status:"published",actorId:"reviewer",createdAt:"2026-10-02T12:00:00Z",comment:"Line one\nLine two"},
    ]}]};
  });
  h.render();await settle();const tree=h.render();
  const section=nodes(tree,node=>node.props?.["aria-label"]==="Customer Practice Scenario lifecycle")[0];
  const history=nodes(section,node=>node.type==="ol")[0];const events=nodes(history,node=>node.type==="li");
  assert.equal(events.length,2);assert.ok(textOf(events[0]).includes("published"));assert.ok(textOf(events[1]).includes("created"));
  assert.ok(textOf(events[0]).includes("reviewer"));assert.ok(textOf(events[0]).includes("Line one\nLine two"));
  assert.ok(nodes(section,node=>node.type==="details").every(node=>!node.props.open));
  assert.ok(textOf(nodes(section,node=>node.type==="summary")[0]).includes("Published v1"));
  assert.equal(nodes(section,node=>node.type==="button").length,0);assert.deepEqual(calls,["GET"]);h.unmount();
});
