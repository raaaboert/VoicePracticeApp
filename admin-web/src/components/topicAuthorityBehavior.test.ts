import assert from "node:assert/strict";
import test from "node:test";
import { button, nodes, settle, textOf, workspaceHarness } from "./topicWorkspace.testSupport";

function fixture() {
  let assignments: {id:string;audience:string;subjectUserId:string;grantsManagement:boolean;revokedAt:string|null;revokedBy?:string}[] = [
    {id:"learner",audience:"individual",subjectUserId:"u",grantsManagement:false,revokedAt:null},
    {id:"manager",audience:"manager_only",subjectUserId:"u",grantsManagement:true,revokedAt:null},
    {id:"old",audience:"individual",subjectUserId:"u",grantsManagement:false,revokedAt:"2026-10-01T12:00:00Z",revokedBy:"admin"},
  ];
  let attachments = [{id:"attached",contentId:"c1",detachedAt:null}, {id:"detached",contentId:"c2",detachedAt:"2026-10-02T12:00:00Z"}];
  const requests: {path:string;init:any}[] = [];
  let rejectAttach = false;
  const props = {orgId:"org-a",topic:{id:"topic-a",status:"active"},users:[{userId:"u",email:"learner@example.test",status:"active"}],view:"access",config:null};
  const h = workspaceHarness("./EnterpriseFocusTopicAuthorityCard.tsx","EnterpriseFocusTopicAuthorityCard",props,async(path,init)=>{
    requests.push({path,init});
    if(path.endsWith("custom-scenarios")) return {scenarios:[{id:"custom",title:"Customer negotiation",segmentId:"sales",enabled:true,applicableIndustryIds:[]}]};
    if(path.endsWith("standard-scenarios/divisions")) return {rows:[{scenarioId:"standard",title:"Standard discovery",segmentLabel:"Sales",enabled:true}]};
    if(init?.method==="DELETE") {
      const id=path.split("/").pop();
      assignments=assignments.map(row=>row.id===id?{...row,revokedAt:"2026-10-20T12:00:00Z"}:row);
      attachments=attachments.map(row=>row.id===id?{...row,detachedAt:"2026-10-20T12:00:00Z"}:row);
      return {};
    }
    if(init?.method==="POST" && path.endsWith("direct-attachments")) {
      if(rejectAttach) throw new Error("Request failed (409): relationship already exists");
      attachments.push({id:"new",...JSON.parse(init.body),detachedAt:null}); return {};
    }
    if(init?.method==="POST") {assignments.push({id:"new",...JSON.parse(init.body),grantsManagement:false,revokedAt:null});return {};}
    if(path.endsWith("assignments")) return {assignments};
    return {scenarios:[],content:attachments,contentItems:[
      {id:"c1",title:"Product guide",description:"How to explain the product",contentType:"pdf",publicationState:"published",archivedAt:null,availableToAttach:true},
      {id:"c2",title:"Archived video",description:"Historical",contentType:"video",publicationState:"draft",archivedAt:"2026-10-01",availableToAttach:false},
      {id:"c3",title:"Practice notes",description:"Useful guidance",contentType:"native_text",publicationState:"published",archivedAt:null,availableToAttach:true},
    ]};
  });
  return {h,props,requests,set rejectAttach(value:boolean){rejectAttach=value;}};
}
async function loaded(f: ReturnType<typeof fixture>) { f.h.render(); await settle(); return f.h.render(); }
function panel(tree:any,id:string) {return nodes(tree,node=>node.props?.id===`topic-workspace-panel-${id}`)[0];}
function row(tree:any,title:string) {return nodes(tree,node=>node.type==="li" && textOf(node).includes(title))[0];}

test("active learner access and management grants stay separate; revoked records live in collapsed History",async()=>{
  const f=fixture();const tree=await loaded(f);
  const access=panel(tree,"access"),history=panel(tree,"history");
  assert.equal(access.props.hidden,false);assert.equal(history.props.hidden,true);
  assert.ok(textOf(access).includes("1 active assignments"));
  const management=nodes(access,node=>node.type==="details" && textOf(node).includes("Management grants"))[0];
  assert.equal(management.props.open,undefined);assert.equal(nodes(management,node=>node.type==="button").length,1);
  assert.ok(textOf(history).includes("Revoked learner assignments (1)"));assert.ok(textOf(history).includes("admin"));
  assert.equal(nodes(history,node=>node.type==="button" && textOf(node)==="Revoke").length,0);
  assert.ok(nodes(history,node=>node.type==="details").every(node=>!node.props.open));f.h.unmount();
});
test("assignment creation uses existing scoped endpoint and management revoke uses its distinct endpoint",async()=>{
  const f=fixture();let tree=await loaded(f);
  nodes(tree,node=>node.props?.id==="topic-authority-audience")[0].props.onChange({target:{value:"individual"}});tree=f.h.render();
  nodes(tree,node=>node.props?.id==="topic-authority-subject")[0].props.onChange({target:{value:"u"}});tree=f.h.render();
  button(tree,"Add assignment").props.onClick();await settle();tree=f.h.render();
  const create=f.requests.find(request=>request.init?.method==="POST");
  assert.equal(create!.path,"/orgs/org-a/trainings/topic-a/assignments");
  assert.deepEqual(JSON.parse(create!.init.body),{audience:"individual",subjectUserId:"u"});
  const manager=nodes(panel(tree,"access"),node=>node.type==="details" && textOf(node).includes("Management grants"))[0];
  button(manager,"Revoke").props.onClick();await settle();tree=f.h.render();
  assert.equal(f.requests.find(request=>request.init?.method==="DELETE")!.path,"/orgs/org-a/trainings/topic-a/management-grants/manager");
  assert.ok(textOf(panel(tree,"history")).includes("Revoked management grants (1)"));f.h.unmount();
});
test("authorized attachment search finds names/types, disables archived/already attached items, and refreshes after attach",async()=>{
  const f=fixture();await loaded(f);f.props.view="content";let tree=f.h.render();await settle();tree=f.h.render();
  assert.ok(textOf(panel(tree,"content")).includes("Product guide"));
  const candidates=nodes(tree,node=>node.props?.className==="topic-compact-list topic-attachment-options")[0];
  assert.equal(button(row(candidates,"Product guide"),"Already attached").props.disabled,true);
  assert.equal(button(row(candidates,"Archived video"),"Unavailable").props.disabled,true);
  const search=nodes(tree,node=>node.props?.id==="topic-attachment-search")[0];search.props.onChange({target:{value:"NATIVE_TEXT"}});tree=f.h.render();
  const picker=nodes(tree,node=>node.props?.className==="topic-compact-list topic-attachment-options")[0];
  assert.ok(textOf(picker).includes("Practice notes"));assert.ok(!textOf(picker).includes("Standard discovery"));
  button(picker,"Attach").props.onClick();await settle();tree=f.h.render();
  const create=f.requests.find(request=>request.init?.method==="POST");assert.deepEqual(JSON.parse(create!.init.body),{kind:"content",contentId:"c3"});
  assert.equal(nodes(tree,node=>node.props?.id==="topic-attachment-search")[0].props.value,"NATIVE_TEXT");
  assert.equal(button(nodes(tree,node=>node.props?.className==="topic-compact-list topic-attachment-options")[0],"Already attached").props.disabled,true);
  assert.ok(f.requests.every(request=>request.path.startsWith("/orgs/org-a/")));f.h.unmount();
});
test("cancelled detach makes no request; confirmed detach retains a historical relationship",async()=>{
  const f=fixture();await loaded(f);f.props.view="content";let tree=f.h.render();await settle();tree=f.h.render();
  f.h.window.confirm=()=>false;button(panel(tree,"content"),"Detach").props.onClick();await settle();
  assert.equal(f.requests.some(request=>request.init?.method==="DELETE"),false);
  f.h.window.confirm=()=>true;button(panel(tree,"content"),"Detach").props.onClick();await settle();tree=f.h.render();
  assert.equal(f.requests.find(request=>request.init?.method==="DELETE")!.path,"/orgs/org-a/trainings/topic-a/direct-attachments/attached");
  assert.ok(textOf(panel(tree,"history")).includes("Detached attachments (2)"));f.h.unmount();
});
test("attachment conflict is surfaced and re-reads server relationships without optimistic persistence",async()=>{
  const f=fixture();await loaded(f);f.props.view="content";let tree=f.h.render();await settle();tree=f.h.render();
  const search=nodes(tree,node=>node.props?.id==="topic-attachment-search")[0];search.props.onChange({target:{value:"Practice notes"}});tree=f.h.render();
  const before=f.requests.filter(request=>request.path.endsWith("direct-attachments")).length;f.rejectAttach=true;
  button(nodes(tree,node=>node.props?.className==="topic-compact-list topic-attachment-options")[0],"Attach").props.onClick();await settle();tree=f.h.render();
  assert.ok(textOf(tree).includes("409"));assert.equal(f.requests.filter(request=>!request.init && request.path.endsWith("direct-attachments")).length,before+1);
  assert.ok(textOf(panel(tree,"content")).includes("Direct content attachments (1)"));f.h.unmount();
});
test("archived Topics disable assignment and attachment mutations, and search exposes an honest empty state",async()=>{
  const f=fixture();f.props.topic.status="archived";let tree=await loaded(f);assert.equal(button(tree,"Add assignment").props.disabled,true);
  f.props.view="content";tree=f.h.render();await settle();tree=f.h.render();
  nodes(tree,node=>node.props?.id==="topic-attachment-search")[0].props.onChange({target:{value:"not-found"}});tree=f.h.render();
  assert.ok(textOf(tree).includes("No authorized items match"));assert.equal(button(tree,"Attach by ID").props.disabled,true);f.h.unmount();
});
