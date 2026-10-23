"use client";

import { useEffect, useRef, useState } from "react";
import { adminFetch } from "../lib/api";

type Scenario = { id: string; kind: "standard" | "org"; title: string; role: string;
  industries: string[]; available: boolean; availability: string; attached?: boolean;
  lifecycleManaged?: boolean; isHomeTopic?: boolean };
type Relationship = { id: string; attachedAt: string; attachedBy: string; scenario: Scenario };
type Result = { topicId: string; attached: Relationship[]; items: Scenario[]; page: number;
  pageSize: number; total: number; canManage: boolean; topicActive: boolean;
  topicStatus?: "draft" | "active" | "archived" };

async function request<T>(orgId: string, topicId: string, operation: string, data: Record<string, unknown> = {}): Promise<T> {
  const base = `/orgs/${encodeURIComponent(orgId)}/trainings/${encodeURIComponent(topicId)}`;
  if (operation === "list_scenario_attachments") {
    return adminFetch<T>(`${base}/scenario-options?${new URLSearchParams({ q: String(data.search ?? ""), page: String(data.page ?? 1) })}`);
  }
  if (operation === "detach_scenario") return adminFetch<T>(`${base}/direct-attachments/${encodeURIComponent(String(data.attachmentId))}`, { method: "DELETE" });
  return adminFetch<T>(`${base}/direct-attachments`, { method: "POST", body: JSON.stringify({ kind: "scenario", ...data }) });
}

export function FocusTopicScenarioAttachments({ orgId, topicId, active = true, revision = 0 }: { orgId: string; topicId: string; active?: boolean; revision?: number }) {
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [picker, setPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const scope = `${orgId}/${topicId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  async function refresh() {
    const ticket = ++sequence.current;
    setLoading(true);
    try {
      const next = await request<Result>(orgId, topicId, "list_scenario_attachments", { search, page });
      if (!mounted.current || currentScope.current !== scope || ticket !== sequence.current) return;
      setResult(next);
    } catch (caught) {
      if (mounted.current && currentScope.current === scope && ticket === sequence.current) throw caught;
    } finally {
      if (mounted.current && currentScope.current === scope && ticket === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setResult(null); setSearch(""); setPage(1); setPicker(false); setNotice(null); setError(null);
    return () => { mounted.current = false; sequence.current++; };
  }, [scope]);
  useEffect(() => {
    if (!active) return;
    setError(null);
    const timer = setTimeout(() => { void refresh().catch(caught => {
      if (mounted.current && currentScope.current === scope) setError(caught instanceof Error ? caught.message : "Could not load attached scenarios.");
    }); }, 150);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [scope, active, search, page, revision]);

  async function change(operation: string, data: Record<string, unknown>, message: string) {
    if (mutation.current || !result?.canManage) return;
    mutation.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await request(orgId, topicId, operation, data);
      if (!mounted.current || currentScope.current !== scope) return;
      await refresh();
      if (mounted.current && currentScope.current === scope) setNotice(message);
    } catch (caught) {
      // Re-read after conflicts, but never turn a failed action/refresh into a success.
      try { if (mounted.current && currentScope.current === scope) await refresh(); } catch { /* Show the original error. */ }
      if (mounted.current && currentScope.current === scope) setError(caught instanceof Error ? caught.message : "Scenario attachment action failed.");
    } finally {
      mutation.current = false;
      if (mounted.current && currentScope.current === scope) setBusy(false);
    }
  }
  const metadata = (item: Scenario) => <>
    <span>{item.kind === "standard" ? "Standard scenario" : item.lifecycleManaged
      ? "Published from Create & Review" : "Organization custom scenario"} · {item.role}</span>
    {item.industries.length ? <span> · {item.industries.join(", ")}</span> : null}
  </>;
  return <section className="topic-scenario-attachments" aria-label="Attached Practice Scenarios">
    <h3>Attached Practice Scenarios{result ? ` (${result.attached.length})` : ""}</h3>
    <p className="topic-scenario-copy">Existing scenarios linked to this Topic. These relationships are separate from authoring and review records.</p>
    {loading ? <p role="status">Loading scenarios…</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={loading || busy} onClick={() => {
      setError(null); void refresh().catch(caught => setError(caught instanceof Error ? caught.message : "Could not load scenarios."));
    }}>Retry scenarios</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {result && !result.topicActive ? <p className="topic-scenario-copy">This Topic is not Active. Its attached scenarios are unavailable to learners through this Topic.</p> : null}
    {result ? result.attached.length ? <ul className="topic-scenario-list">{result.attached.map(row => <li key={row.id}>
      <div><strong>{row.scenario.title}</strong><p className="topic-scenario-copy">{metadata(row.scenario)}</p>
        <p className="topic-scenario-copy">{row.scenario.availability}</p>
        {row.scenario.lifecycleManaged && row.scenario.isHomeTopic ? <p className="topic-scenario-copy">
          Home Focus Topic. Detaching removes learner access through this Topic; it does not unpublish or delete the scenario.
        </p> : null}
        <details><summary>Relationship details</summary><p className="topic-scenario-copy">Attached {new Date(row.attachedAt).toLocaleString()} · {row.attachedBy}<br />Relationship: {row.id}</p></details>
      </div>
      {result.canManage ? <button type="button" disabled={busy || loading} aria-label={`Detach ${row.scenario.title}`}
        onClick={() => {
          if (window.confirm(row.scenario.lifecycleManaged && row.scenario.isHomeTopic
            ? `Detach ${row.scenario.title} from its home Focus Topic? This removes learner access through this Topic but does not unpublish or delete the scenario. Its published version and review history remain unchanged.`
            : `Detach ${row.scenario.title} from this Topic? Other Topics and the scenario itself are unchanged.`))
            void change("detach_scenario", { attachmentId: row.id }, "Scenario detached from this Topic; history retained.");
        }}>Detach</button> : null}
    </li>)}</ul> : <p>No practice scenarios are attached to this Topic.</p> : null}
    {result?.canManage ? <>
      <button type="button" aria-expanded={picker} aria-controls={`scenario-picker-${topicId}`}
        onClick={() => setPicker(value => !value)}>{picker ? "Close scenario search" : "Attach existing scenario"}</button>
      <div id={`scenario-picker-${topicId}`} hidden={!picker}>
        <label htmlFor={`scenario-search-${topicId}`}>Search authorized scenarios</label>
        <input id={`scenario-search-${topicId}`} type="search" maxLength={200} value={search} disabled={busy}
          onChange={event => { sequence.current++; setLoading(true); setSearch(event.target.value); setPage(1); }} />
        {!loading && !error ? <>
          <p className="topic-scenario-copy">{result.total ? `Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total}` : "No eligible scenarios match your search."}</p>
          <ul className="topic-scenario-list">{result.items.map(item => <li key={`${item.kind}/${item.id}`}>
            <div><strong>{item.title}</strong><p className="topic-scenario-copy">{metadata(item)}</p></div>
            <button type="button" disabled={busy || item.attached} aria-label={item.attached ? `Already attached: ${item.title}` : `Attach ${item.title}`}
              onClick={() => void change("attach_scenario", { scenarioKind: item.kind, scenarioId: item.id }, "Scenario attached to this Topic.")}>
              {item.attached ? "Already attached" : "Attach"}</button>
          </li>)}</ul>
          <div className="topic-scenario-paging">
            <button type="button" disabled={busy || result.page <= 1} onClick={() => { setLoading(true); setPage(result.page - 1); }}>Previous</button>
            <button type="button" disabled={busy || result.page * result.pageSize >= result.total} onClick={() => { setLoading(true); setPage(result.page + 1); }}>Next</button>
          </div>
        </> : null}
      </div>
    </> : result ? <p className="topic-scenario-copy">{result.topicStatus === "archived"
      ? "Attachments cannot be changed while this Focus Topic is archived."
      : "An Organization Admin manages existing scenario attachments. Your scenario authoring permissions are unchanged."}</p> : null}
  </section>;
}
