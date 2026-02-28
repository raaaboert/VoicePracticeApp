"use client";

import { ReactNode, useMemo, useState } from "react";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch, getApiBaseUrl } from "../../src/lib/api";

type Difficulty = "easy" | "medium" | "hard";

interface PromptDebugResponse {
  effectiveFlags?: Record<string, unknown>;
  trainingPack?: {
    applied?: boolean;
    id?: string;
    title?: string;
  } | null;
  roleplayPrompt?: {
    includedSections?: string[];
    systemPromptPreview?: string;
  } | null;
  evaluationPrompt?: {
    scoringWeights?: Record<string, number>;
    systemPromptPreview?: string;
  } | null;
  warnings?: string[];
  [key: string]: unknown;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function CollapsiblePanel(props: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details
      open={props.defaultOpen ?? false}
      style={{
        border: "1px solid rgba(129, 206, 166, 0.25)",
        borderRadius: 10,
        marginBottom: 10,
        background: "rgba(5, 30, 18, 0.45)"
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700, padding: "10px 12px" }}>{props.title}</summary>
      <div style={{ padding: "0 12px 12px" }}>{props.children}</div>
    </details>
  );
}

export default function PromptPreviewPage() {
  useRequireAdminToken();
  const [apiBase] = useState(() => getApiBaseUrl());

  const [userId, setUserId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [industryId, setIndustryId] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [personaId, setPersonaId] = useState("");
  const [includeFull, setIncludeFull] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromptDebugResponse | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const canPreview = useMemo(
    () => userId.trim().length > 0 && scenarioId.trim().length > 0 && industryId.trim().length > 0,
    [industryId, scenarioId, userId]
  );

  const runPreview = async () => {
    if (!canPreview) {
      setError("userId, scenarioId, and industryId are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setCopyNotice(null);

    try {
      const query = new URLSearchParams();
      query.set("userId", userId.trim());
      query.set("scenarioId", scenarioId.trim());
      query.set("industryId", industryId.trim());
      query.set("difficulty", difficulty);

      if (personaId.trim()) {
        query.set("personaId", personaId.trim());
      }

      if (includeFull) {
        query.set("includeFull", "true");
      }

      const payload = await adminFetch<PromptDebugResponse>(
        `/internal/ai/debug-prompt?${query.toString()}`,
        {
          method: "GET",
          requestAttemptTimeoutMs: 15_000,
          requestTotalTimeoutMs: 30_000,
          requestMaxAttempts: 1
        }
      );

      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load prompt preview.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const copyJson = async () => {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pretty(result));
      setCopyNotice("Copied JSON.");
      setTimeout(() => setCopyNotice(null), 1500);
    } catch {
      setCopyNotice("Clipboard copy failed.");
      setTimeout(() => setCopyNotice(null), 2000);
    }
  };

  return (
    <AdminShell title="Prompt Preview">
      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 4 }}>Inputs</h3>
            <p className="small" style={{ margin: 0 }}>
              API base: {apiBase}
            </p>
          </div>
          <div className="card-actions">
            <button className="primary" onClick={() => void runPreview()} disabled={loading || !canPreview}>
              {loading ? "Loading..." : "Preview"}
            </button>
          </div>
        </div>

        <div className="grid">
          <div>
            <label htmlFor="prompt-preview-user-id">userId</label>
            <input
              id="prompt-preview-user-id"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="usr_..."
            />
          </div>
          <div>
            <label htmlFor="prompt-preview-scenario-id">scenarioId</label>
            <input
              id="prompt-preview-scenario-id"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
              placeholder="scenario_..."
            />
          </div>
          <div>
            <label htmlFor="prompt-preview-industry-id">industryId</label>
            <input
              id="prompt-preview-industry-id"
              value={industryId}
              onChange={(event) => setIndustryId(event.target.value)}
              placeholder="sales"
            />
          </div>
          <div>
            <label htmlFor="prompt-preview-difficulty">difficulty</label>
            <select
              id="prompt-preview-difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as Difficulty)}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </div>
          <div>
            <label htmlFor="prompt-preview-persona-id">personaId</label>
            <input
              id="prompt-preview-persona-id"
              value={personaId}
              onChange={(event) => setPersonaId(event.target.value)}
              placeholder="skeptical"
            />
          </div>
          <div>
            <label htmlFor="prompt-preview-include-full">includeFull</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40 }}>
              <input
                id="prompt-preview-include-full"
                type="checkbox"
                checked={includeFull}
                onChange={(event) => setIncludeFull(event.target.checked)}
                style={{ width: 18, minHeight: 18 }}
              />
              <span className="small">Include full baseline and prompt content.</span>
            </div>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>

      {result ? (
        <div className="card">
          <div className="card-header">
            <h3 style={{ marginBottom: 0 }}>Preview Result</h3>
            <div className="card-actions">
              <button onClick={() => void copyJson()}>Copy JSON</button>
            </div>
          </div>
          {copyNotice ? <p className="small">{copyNotice}</p> : null}

          <CollapsiblePanel title="effectiveFlags" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty(result.effectiveFlags ?? {})}</pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="trainingPack" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {pretty({
                applied: result.trainingPack?.applied ?? false,
                id: result.trainingPack?.id ?? null,
                title: result.trainingPack?.title ?? null
              })}
            </pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="includedSections" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty(result.roleplayPrompt?.includedSections ?? [])}</pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="scoringWeights" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {pretty(result.evaluationPrompt?.scoringWeights ?? null)}
            </pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="roleplayPrompt.systemPromptPreview" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result.roleplayPrompt?.systemPromptPreview ?? ""}</pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="evaluationPrompt.systemPromptPreview" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result.evaluationPrompt?.systemPromptPreview ?? ""}</pre>
          </CollapsiblePanel>

          <CollapsiblePanel title="warnings" defaultOpen>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty(result.warnings ?? [])}</pre>
          </CollapsiblePanel>
        </div>
      ) : null}
    </AdminShell>
  );
}
