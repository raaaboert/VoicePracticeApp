import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeScenarioOptions, employeeScoreDate, employeeScoreLabel, filterEmployeeScores, type EmployeeScore,
} from "./employeeRecentScores";

const end = "2026-10-20T12:00:00Z";
const row = (id: string, endedAt: string, scenarioId = "s1"): EmployeeScore => ({
  id, endedAt, scenarioId, segmentId: "sales", industryId: null, overallScore: 80,
});
const filters = {date:"all",scenarioId:"",sort:"newest",periodEndAt:end} as const;

test("employee score date filters use the delivered window, include boundaries, and exclude invalid/future dates", () => {
  const rows=[row("today",end),row("7","2026-10-13T12:00:00Z"),row("8","2026-10-12T12:00:00Z"),
    row("30","2026-09-20T12:00:00Z"),row("31","2026-09-19T12:00:00Z"),row("future","2026-10-21T00:00:00Z"),row("bad","bad")];
  assert.deepEqual(filterEmployeeScores(rows,{...filters,date:"7"}).map(row=>row.id),["today","7"]);
  assert.deepEqual(filterEmployeeScores(rows,{...filters,date:"30"}).map(row=>row.id),["today","7","8","30"]);
  assert.equal(filterEmployeeScores(rows,filters).length,rows.length);
  assert.deepEqual(filterEmployeeScores(rows,{...filters,date:"7",periodEndAt:"invalid"}),[]);
});
test("scenario and date filters combine using exact scenario identity rather than title or role", () => {
  const rows=[row("1",end,"s1"),row("2",end,"s2"),row("3","2026-10-01T00:00:00Z","s1")];
  assert.deepEqual(filterEmployeeScores(rows,{...filters,date:"7",scenarioId:"s1"}).map(row=>row.id),["1"]);
  assert.deepEqual(filterEmployeeScores(rows,{...filters,scenarioId:"missing"}),[]);
});
test("newest/oldest ordering has deterministic ID ties and never mutates loaded scores", () => {
  const rows=[row("b",end),row("a",end),row("old","2026-10-01T00:00:00Z"),row("undated","invalid")];
  const before=structuredClone(rows);
  assert.deepEqual(filterEmployeeScores(rows,filters).map(row=>row.id),["a","b","old","undated"]);
  assert.deepEqual(filterEmployeeScores(rows,{...filters,sort:"oldest"}).map(row=>row.id),["old","a","b","undated"]);
  assert.deepEqual(rows,before);
});
test("scenario options come only from the authorized loaded subset, with honest unavailable labels", () => {
  const titles=new Map([["s1","Known title"],["unloaded","Not supplied"]]);
  const options=employeeScenarioOptions([row("1",end,"s1"),row("2",end,"s1"),row("3",end,"retired")],titles);
  assert.equal(options[0].label,"All scenarios");assert.equal(options.length,3);
  assert.ok(options.some(option=>option.value==="retired" && option.label.includes("Unavailable")));
  assert.ok(!options.some(option=>option.value==="unloaded"));
  assert.deepEqual(employeeScenarioOptions([],titles),[{value:"",label:"All scenarios"}]);
});
test("missing optional display values do not invent scores or dates, and zero remains a real score", () => {
  assert.equal(employeeScoreLabel(0),"0");assert.equal(employeeScoreLabel(82.5),"82.5");
  for(const value of [null,undefined,Number.NaN,Infinity]) assert.equal(employeeScoreLabel(value),"Not available");
  assert.equal(employeeScoreDate("bad"),"Date unavailable");
  assert.equal(employeeScoreDate(end),new Date(end).toLocaleString());
});
