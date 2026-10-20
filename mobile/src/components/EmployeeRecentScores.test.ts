import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as model from "../lib/employeeRecentScores";

const source=readFileSync(new URL("./EmployeeRecentScores.tsx",import.meta.url),"utf8");
const app=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
const ast=ts.createSourceFile("App.tsx",app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name:string) {
  let result:ts.VariableDeclaration|undefined;
  function visit(node:ts.Node) {if(ts.isVariableDeclaration(node) && node.name.getText(ast)===name) result=node;else ts.forEachChild(node,visit);}
  visit(ast);assert.ok(result,`Missing ${name}`);return result!;
}
const palettes=new Function(`return (${declaration("APP_THEME_TOKENS").initializer!.getText(ast)})`)();
function nodes(tree:any, matches:(node:any)=>boolean):any[] {
  if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,matches));
  if(!tree || typeof tree!=="object")return [];
  return [...(matches(tree)?[tree]:[]),...nodes(tree.props?.children,matches)];
}
function text(tree:any):string {
  if(Array.isArray(tree))return tree.map(text).join("");
  if(tree===null || tree===undefined || typeof tree==="boolean")return "";
  return typeof tree==="object"?text(tree.props?.children):String(tree);
}
function fixture(count=12) {
  return {org:{id:"org-a",name:"Company"},user:{userId:"employee-a"},period:{startAt:"2026-09-20T12:00:00Z",endAt:"2026-10-20T12:00:00Z",days:30},
    scores:{sessions:35,avgOverallScore:84,recent:Array.from({length:count},(_,i)=>({id:`score-${i}`,endedAt:new Date(Date.parse("2026-10-20T12:00:00Z")-i*86400000).toISOString(),
      scenarioId:i%2?"s2":"s1",segmentId:"sales",industryId:i%2?null:"industry",overallScore:80+i}))}};
}
function harness(detail=fixture(), theme=palettes.soft_light) {
  let cursor=0;let slots:any[]=[];let identity="org-a:employee-a";
  const props:any={detail,theme,scenarioTitles:new Map([["s1","A very long scenario title that must remain readable on narrow phones"],["s2","Second scenario"]]),
    segmentLabels:new Map([["sales","Sales role"]]),industryLabels:new Map([["industry","Industry label"]]),renderScenarioFilter:(value:any)=>({type:"ScenarioFilter",props:value})};
  const require=createRequire(import.meta.url), exported:any={};
  const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","exports",code)((id:string)=>{
    if(id==="react")return {
      useState:(initial:any)=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],(next:any)=>{slots[index]=typeof next==="function"?next(slots[index]):next;}];},
      useMemo:(fn:()=>any)=>{cursor++;return fn();},
    };
    if(id==="react-native")return {Pressable:"Pressable",Text:"Text",View:"View",StyleSheet:{create:(styles:any)=>styles}};
    if(id.startsWith("@expo/vector-icons"))return {__esModule:true,default:"Icon"};
    if(id==="../lib/employeeRecentScores")return model;
    return require(id);
  },exported);
  return {props,render(){cursor=0;return exported.EmployeeRecentScores(props);},mountScope(key:string,next:any){if(key!==identity){slots=[];identity=key;}props.detail=next;}};
}
function control(tree:any,label:string) {const found=nodes(tree,node=>node.type==="Pressable" && text(node)===label);assert.equal(found.length,1,label);return found[0];}
function rows(tree:any) {return nodes(tree,node=>node.props?.testID?.startsWith("employee-score-"));}

test("employee results are compact, collapsed by default, capped at five per page and explicitly partial",()=>{
  const h=harness();const tree=h.render();assert.equal(rows(tree).length,5);
  assert.ok(rows(tree).every(row=>row.props.accessibilityState.expanded===false));
  assert.ok(text(tree).includes("12 loaded of 35"));assert.ok(text(tree).includes("latest 20"));
  assert.ok(text(tree).includes("summary totals above are unchanged"));assert.ok(!text(tree).includes("Sales role"));
  assert.ok(!text(tree).includes("90 days"));assert.ok(!text(tree).includes("Complete history"));
  assert.equal(h.props.detail.scores.avgOverallScore,84);
});
test("expansion retains existing score/date/role, exposes available industry and never expands every card",()=>{
  const h=harness();let tree=h.render();rows(tree)[0].props.onPress();tree=h.render();
  assert.equal(rows(tree)[0].props.accessibilityState.expanded,true);assert.ok(text(tree).includes("Sales role"));
  assert.ok(text(tree).includes("Industry label"));assert.ok(text(tree).includes("Score: 80"));
  rows(tree)[1].props.onPress();tree=h.render();assert.equal(rows(tree).filter(row=>row.props.accessibilityState.expanded).length,1);
  rows(tree)[1].props.onPress();tree=h.render();assert.ok(rows(tree).every(row=>!row.props.accessibilityState.expanded));
});
test("combined date/scenario filters and sorting reset paging/expansion and clear restores the loaded subset",()=>{
  const h=harness();let tree=h.render();control(tree,"Next results").props.onPress();tree=h.render();assert.ok(text(tree).includes("Showing 6-10"));
  rows(tree)[0].props.onPress();tree=h.render();control(tree,"7 days").props.onPress();tree=h.render();
  assert.ok(text(tree).includes("Showing 1-5 of 8"));assert.ok(rows(tree).every(row=>!row.props.accessibilityState.expanded));
  nodes(tree,node=>node.type==="ScenarioFilter")[0].props.onChange("s2");tree=h.render();
  assert.equal(rows(tree).length,4);assert.ok(rows(tree).every(row=>row.props.accessibilityLabel.includes("Second scenario")));
  control(tree,"Newest first").props.onPress();tree=h.render();assert.equal(rows(tree)[0].props.testID,"employee-score-score-7");
  control(tree,"Clear filters").props.onPress();tree=h.render();assert.equal(rows(tree)[0].props.testID,"employee-score-score-0");
});
test("paging has no duplicate/missing loaded rows and adapts when a refresh supplies fewer results",()=>{
  const h=harness();const ids:string[]=[];let tree=h.render();
  for(let page=0;page<3;page++){ids.push(...rows(tree).map(row=>row.props.testID));if(page<2){control(tree,"Next results").props.onPress();tree=h.render();}}
  assert.equal(ids.length,12);assert.equal(new Set(ids).size,12);assert.equal(control(tree,"Next results").props.disabled,true);
  h.props.detail=fixture(1);tree=h.render();assert.equal(rows(tree).length,1);assert.ok(text(tree).includes("Showing 1-1 of 1"));
});
test("empty datasets and no matching loaded records have distinct recoverable messages",()=>{
  const empty=harness(fixture(0)).render();assert.ok(text(empty).includes("No scored sessions are available"));assert.equal(rows(empty).length,0);
  const h=harness();let tree=h.render();nodes(tree,node=>node.type==="ScenarioFilter")[0].props.onChange("not-loaded");tree=h.render();
  assert.ok(text(tree).includes("No loaded results match"));assert.equal(rows(tree).length,0);
  control(tree,"Clear filters").props.onPress();assert.equal(rows(h.render()).length,5);
});
test("employee and organization remount boundaries reset filters, page and expanded results",()=>{
  const h=harness();let tree=h.render();nodes(tree,node=>node.type==="ScenarioFilter")[0].props.onChange("s2");tree=h.render();rows(tree)[0].props.onPress();tree=h.render();
  const other=fixture(1);other.org.id="org-b";other.user.userId="employee-b";other.scores.recent[0].id="other-org-score";
  h.mountScope("org-b:employee-b",other);tree=h.render();assert.equal(rows(tree).length,1);assert.equal(rows(tree)[0].props.testID,"employee-score-other-org-score");
  assert.equal(nodes(tree,node=>node.type==="ScenarioFilter")[0].props.value,"");assert.equal(rows(tree)[0].props.accessibilityState.expanded,false);
});
test("light/dark cards retain theme tokens, scalable untruncated titles, labels and accessible touch targets",()=>{
  for(const palette of Object.values(palettes) as any[]){
    const h=harness(fixture(),palette);const tree=h.render();const row=rows(tree)[0];
    assert.equal(row.props.accessibilityRole,"button");assert.ok(row.props.accessibilityLabel.includes("Score: 80"));assert.ok(row.props.accessibilityLabel.includes("Completed"));
    assert.ok(row.props.style.minHeight>=44);const title=nodes(row,node=>node.type==="Text")[0];
    assert.equal(title.props.numberOfLines,undefined);assert.equal(title.props.allowFontScaling,undefined);assert.equal(title.props.maxFontSizeMultiplier,undefined);
    assert.equal(title.props.style[1].color,palette.text);assert.equal(row.props.style.height,undefined);
    const date=control(tree,"7 days");assert.ok(date.props.style({pressed:false})[0].minHeight>=44);
    assert.equal(tree.props.style[1].backgroundColor,palette.panel);
  }
});
test("retired scenarios and missing optional score values remain inspectable without invented Topic attribution",()=>{
  const detail=fixture(1);detail.scores.recent[0]={...detail.scores.recent[0],scenarioId:"retired",industryId:null,overallScore:NaN,endedAt:"bad"};
  const h=harness(detail);let tree=h.render();assert.ok(text(tree).includes("Unavailable scenario"));assert.ok(text(tree).includes("Not available"));
  rows(tree)[0].props.onPress();tree=h.render();assert.ok(text(tree).includes("Scenario reference: retired"));assert.ok(text(tree).includes("Date unavailable"));assert.ok(!text(tree).includes("Focus Topic:"));
});

function appCallback(name:string,bindings:Record<string,any>) {
  const node=declaration(name);const code=ts.transpileModule(`const callback = ${node.initializer!.getText(ast)};`,{fileName:"App.tsx",compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  return new Function("require","exports",...Object.keys(bindings),code+"\nreturn callback;")(createRequire(import.meta.url),{},...Object.values(bindings));
}
function loaderHarness(fetch:(actor:string,target:string,...args:any[])=>Promise<any>) {
  const state:Record<string,any>={};const bindings:Record<string,any>={user:{id:"admin",orgId:"org-a",accountType:"enterprise",orgRole:"org_admin"},mobileAuthToken:"local-test-token",
    identityScopedRequestGenerationRef:{current:0},adminUserDetailRequestRef:{current:0},useCallback:(fn:any)=>fn,fetchOrgAdminUserDetail:fetch,
    submitAutoErrorReport:async()=>{},getErrorMessage:(error:Error)=>error.message};
  for(const setter of new Set(declaration("refreshOrgAdminUserDetail").getText(ast).match(/\bset[A-Z]\w+/g))) bindings[setter]=(value:any)=>{state[setter]=value;};
  return {state,bindings,load:appCallback("refreshOrgAdminUserDetail",bindings)};
}
test("actual employee loader ignores out-of-order employee responses and stale failures",async()=>{
  const pending:Record<string,{resolve:(v:any)=>void;reject:(error:Error)=>void}>={};
  const h=loaderHarness(async(_actor,target)=>new Promise((resolve,reject)=>{pending[target]={resolve,reject};}));
  const first=h.load("old"),second=h.load("new");
  pending.new.resolve({org:{id:"org-a"},user:{userId:"new"}});await second;
  pending.old.reject(new Error("Old failure"));await first;
  assert.equal(h.state.setOrgAdminUserDetail.user.userId,"new");assert.equal(h.state.setAdminError,null);assert.equal(h.state.setAdminLoading,false);
});
test("actual employee loader fails closed on mismatched org/user data and ignores identity-switch results",async()=>{
  for(const data of [{org:{id:"org-b"},user:{userId:"target"}},{org:{id:"org-a"},user:{userId:"another"}}]){
    const h=loaderHarness(async()=>data);await h.load("target");assert.equal(h.state.setOrgAdminUserDetail,null);assert.ok(h.state.setAdminError.includes("selected employee"));
  }
  let resolve!:(value:any)=>void;const h=loaderHarness(async()=>new Promise(yes=>{resolve=yes;}));const request=h.load("old");
  h.bindings.identityScopedRequestGenerationRef.current++;resolve({org:{id:"org-a"},user:{userId:"old"}});await request;
  assert.equal(h.state.setOrgAdminUserDetail,undefined);
});
test("employee loading/error presentation retains Retry, authorized identity keys and unchanged summary expressions",()=>{
  const screen=declaration("renderAdminUserDetail").getText(ast);
  assert.match(screen,/accessibilityLabel="Loading employee details"/);assert.match(screen,/accessibilityLabel="Retry employee details"/);
  assert.match(screen,/orgAdminUserDetail\.org\.id === user\.orgId/);assert.ok(screen.includes('key={`${user.id}:${user.orgId}:${targetUserId}`}'));
  assert.match(screen,/detail\.usage\.sessions/);assert.match(screen,/secondsToWholeMinutes\(detail\.usage\.billedSeconds\)/);
  assert.match(screen,/detail\.scores\.avgOverallScore\.toFixed\(1\)/);assert.match(screen,/detail\.scores\.sessions/);
  assert.match(declaration("refreshOrgAdminUserDetail").getText(ast),/days: 30/);
});

function screenHarness(overrides:Record<string,any>={}) {
  const requests:string[]=[];
  const bindings:Record<string,any>={hasAdminAccess:true,user:{id:"admin",orgId:"org-a",orgRole:"user_admin"},selectedAdminUserId:"employee-a",
    orgAdminUserDetail:null,adminLoading:true,adminError:null,theme:palettes.soft_light,styles:new Proxy({},{get:(_target,key)=>String(key)}),
    View:"View",Text:"Text",Pressable:"Pressable",ScrollView:"ScrollView",ActivityIndicator:"ActivityIndicator",TextInput:"TextInput",
    Platform:{OS:"ios"},EmployeeRecentScores:"EmployeeRecentScores",SearchableSelectionDropdown:"SearchableSelectionDropdown",
    adminEmployeeIdInput:"",ORG_USER_ROLE_LABELS:{user:"User"},
    formatDateLabel:(date:string)=>date,formatSecondsAsClock:(value:number)=>String(value),secondsToWholeMinutes:(value:number)=>value/60,
    scenarioTitleById:new Map(),segmentLabelById:new Map(),industryLabelById:new Map(),
    refreshOrgAdminUserDetail:async(id:string)=>{requests.push(id);},...overrides};
  for(const setter of new Set(declaration("renderAdminUserDetail").getText(ast).match(/\bset[A-Z]\w+/g))) if(!bindings[setter])bindings[setter]=()=>{};
  return {requests,render:appCallback("renderAdminUserDetail",bindings)};
}
test("actual employee screen distinguishes loading from failed loading and retries the selected employee once",()=>{
  const loading=screenHarness().render();assert.equal(nodes(loading,node=>node.type==="ActivityIndicator").length,1);
  assert.ok(text(loading).includes("Loading user details"));
  const h=screenHarness({adminLoading:false,adminError:"Network unavailable"});const failed=h.render();
  assert.equal(nodes(failed,node=>node.type==="ActivityIndicator").length,0);assert.ok(text(failed).includes("could not be loaded"));
  control(failed,"Retry").props.onPress();assert.deepEqual(h.requests,["employee-a"]);
});
test("actual employee screen hides foreign/stale detail and preserves authorized widget scope keys and summary data",()=>{
  const data={...fixture(1),usage:{sessions:3,billedSeconds:120}};
  const tree=screenHarness({orgAdminUserDetail:data,adminLoading:false}).render();
  const widget=nodes(tree,node=>node.type==="EmployeeRecentScores")[0];
  assert.equal(widget.key,"admin:org-a:employee-a");assert.equal(widget.props.detail,data);assert.ok(text(tree).includes("Avg Score"));
  const picker=widget.props.renderScenarioFilter({value:"",options:[],onChange(){}});
  assert.equal(picker.props.styles.dropdownTrigger[1].height,"auto");
  assert.equal(picker.props.styles.dropdownOption[1].minHeight,44);
  for(const update of [{user:{userId:"employee-b"}},{org:{id:"org-b"}}]){
    const stale=screenHarness({orgAdminUserDetail:{...data,...update}}).render();assert.equal(nodes(stale,node=>node.type==="EmployeeRecentScores").length,0);
  }
  const denied=screenHarness({hasAdminAccess:false,orgAdminUserDetail:data}).render();
  assert.ok(text(denied).includes("Admin access required"));assert.equal(nodes(denied,node=>node.type==="EmployeeRecentScores").length,0);
});
test("current network failure clears stale employee detail and ends loading without inventing results",async()=>{
  const h=loaderHarness(async()=>{throw new Error("Network unavailable");});await h.load("employee-a");
  assert.equal(h.state.setOrgAdminUserDetail,null);assert.equal(h.state.setAdminError,"Network unavailable");assert.equal(h.state.setAdminLoading,false);
});
