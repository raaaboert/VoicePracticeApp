"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { contentTopicChoices, type TopicChoice } from "@/src/lib/trainingContentTopicSelection";

export function TrainingContentTopicSelector({ options, existing = [], selectedIds, onChange, disabled = false,
  loading = false, error, onRetry }: {
  options: readonly TopicChoice[]; existing?: readonly TopicChoice[]; selectedIds: string[];
  onChange: (ids: string[]) => void; disabled?: boolean; loading?: boolean; error?: string; onRetry?: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const all = contentTopicChoices(options, existing, "");
  const matches = contentTopicChoices(options, existing, query);
  const selectable = (topic: TopicChoice) => topic.status === "active" && topic.available !== false;
  const remove = (topicId: string) => onChange(selectedIds.filter((value) => value !== topicId));
  return <fieldset className="training-content-topic-selector" disabled={disabled || loading}
    aria-describedby={`${id}-help`}>
    <legend>Related Focus Topics</legend>
    <p className="muted-copy" id={`${id}-help`}>Select one or more Active Topics. Draft Topics must be changed to Active and saved before attaching content. Existing unavailable attachments are retained.</p>
    <div className="assignment-chips" aria-label="Selected Focus Topics">
      {all.filter((topic) => selectedIds.includes(topic.id)).map((topic) => <span className="assignment-chip" key={topic.id}>
        <span>{topic.name}{!selectable(topic) ? ` (${topic.status === "draft" ? "Draft" : "Unavailable"}; retained)` : ""}</span>
        <button type="button" disabled={!selectable(topic) || Boolean(error)} onClick={() => remove(topic.id)}
          aria-label={`Remove ${topic.name}`}><X aria-hidden="true" size={14} /></button>
      </span>)}
      {selectedIds.length === 0 ? <span className="muted-copy">No Focus Topics selected.</span> : null}
    </div>
    <label className="field-label" htmlFor={`${id}-search`}>Search Focus Topics
      <input id={`${id}-search`} className="text-input" type="search" value={query} disabled={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)} placeholder="Search by Topic name" />
    </label>
    {loading ? <p role="status">Loading Focus Topics…</p> : error ? <p role="alert">{error}</p>
      : all.length === 0 ? <p className="muted-copy">No Focus Topics are available.</p>
      : matches.length === 0 ? <p className="muted-copy" role="status">No Focus Topics match your search.</p>
      : <div className="training-content-topic-options">{matches.map((topic) => <label key={topic.id}
        className={`training-content-topic-option${selectedIds.includes(topic.id) ? " is-selected" : ""}`}>
        <input type="checkbox" checked={selectedIds.includes(topic.id)} disabled={!selectable(topic) || Boolean(error)}
          onChange={(event) => event.target.checked ? onChange([...new Set([...selectedIds, topic.id])]) : remove(topic.id)} />
        <span><strong>{topic.name}</strong>{!selectable(topic) ? <small>{topic.status === "draft"
          ? "Draft — change this Topic to Active and save before attaching." : "Unavailable — existing relationship is preserved."}</small> : null}</span>
      </label>)}</div>}
    {error && onRetry ? <button type="button" onClick={onRetry} disabled={false}>Retry loading Topics</button> : null}
  </fieldset>;
}
