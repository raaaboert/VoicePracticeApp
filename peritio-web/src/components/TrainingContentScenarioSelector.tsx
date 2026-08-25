"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { DashboardTrainingContentScenarioOption } from "@voicepractice/shared";

import {
  addTrainingContentScenarioSelection,
  filterTrainingContentScenarioOptions,
  listTrainingContentScenarioFocusTopicFilters,
  listTrainingContentScenarioRoleFilters,
  removeTrainingContentScenarioSelection,
  type TrainingContentScenarioSourceFilter,
  type TrainingContentScenarioSelectionItem,
} from "@/src/lib/trainingContentScenarioSelection";

export function TrainingContentScenarioSelector({
  options,
  selected,
  disabled = false,
  onChange,
}: {
  options: DashboardTrainingContentScenarioOption[];
  selected: TrainingContentScenarioSelectionItem[];
  disabled?: boolean;
  onChange: (selected: TrainingContentScenarioSelectionItem[]) => void;
}) {
  const searchId = useId();
  const roleFilterId = useId();
  const sourceFilterId = useId();
  const focusTopicFilterId = useId();
  const descriptionId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [roleId, setRoleId] = useState("");
  const [source, setSource] = useState<TrainingContentScenarioSourceFilter>("all");
  const [focusTopicId, setFocusTopicId] = useState("");
  const roleOptions = useMemo(
    () => listTrainingContentScenarioRoleFilters(options),
    [options]
  );
  const focusTopicOptions = useMemo(
    () => listTrainingContentScenarioFocusTopicFilters(options),
    [options]
  );
  const filteredOptions = useMemo(
    () => filterTrainingContentScenarioOptions(options, selected, query, {
      roleId,
      source,
      focusTopicId,
    }),
    [focusTopicId, options, query, roleId, selected, source]
  );
  const filtersActive = Boolean(query.trim() || roleId || source !== "all");

  const returnFocusToSearch = () => searchInput.current?.focus();

  return (
    <fieldset className="training-content-scenario-selector full-span" disabled={disabled}>
      <legend className="field-label">Related Scenarios</legend>
      <div className="scenario-selector-heading">
        <div>
          <p id={descriptionId} className="muted-copy">
            Optional. Select any standard or custom scenarios this Learning Resource supports.
          </p>
        </div>
        {selected.length > 0 ? (
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={disabled}
            onClick={() => {
              onChange([]);
              returnFocusToSearch();
            }}
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="scenario-selection-summary" aria-live="polite">
        <strong>Selected scenarios ({selected.length})</strong>
        {selected.length === 0 ? (
          <span className="muted-copy">No related scenarios selected.</span>
        ) : (
          <div className="assignment-chips">
            {selected.map((scenario) => (
              <span
                key={scenario.id}
                className={`assignment-chip scenario-selection-chip${
                  scenario.available ? "" : " unavailable"
                }`}
              >
                <span className="scenario-selection-chip-copy">
                  <strong>{scenario.title}</strong>
                  <small>
                    {scenario.available
                      ? scenario.source === "custom"
                        ? "Custom"
                        : scenario.source === "standard"
                          ? "Standard"
                          : "Selected"
                      : "Unavailable"}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${scenario.title}${scenario.available ? "" : " (unavailable)"}`}
                  title={`Remove ${scenario.title}`}
                  onClick={() => {
                    onChange(removeTrainingContentScenarioSelection(selected, scenario.id));
                    returnFocusToSearch();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <label className="field-label" htmlFor={searchId}>
        Search scenarios
      </label>
      <div className="scenario-selector-search">
        <Search size={17} aria-hidden="true" />
        <input
          ref={searchInput}
          id={searchId}
          className="text-input"
          type="search"
          value={query}
          disabled={disabled}
          aria-describedby={descriptionId}
          placeholder="Search by scenario, source, role, or Focus Topic"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="scenario-selector-filters">
        <label className="scenario-selector-filter" htmlFor={roleFilterId}>
          <span className="field-label">Role</span>
          <select
            id={roleFilterId}
            className="text-input"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">All Roles</option>
            {roleOptions.map((role) => (
              <option key={role.id} value={role.id}>{role.label}</option>
            ))}
          </select>
        </label>
        <label className="scenario-selector-filter" htmlFor={sourceFilterId}>
          <span className="field-label">Source</span>
          <select
            id={sourceFilterId}
            className="text-input"
            value={source}
            onChange={(event) => {
              const nextSource = event.target.value as TrainingContentScenarioSourceFilter;
              setSource(nextSource);
              if (nextSource !== "custom") {
                setFocusTopicId("");
              }
            }}
          >
            <option value="all">All</option>
            <option value="standard">Standard</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {source === "custom" ? (
          <label className="scenario-selector-filter" htmlFor={focusTopicFilterId}>
            <span className="field-label">Focus Topic</span>
            <select
              id={focusTopicFilterId}
              className="text-input"
              value={focusTopicId}
              onChange={(event) => setFocusTopicId(event.target.value)}
            >
              <option value="">All Focus Topics</option>
              {focusTopicOptions.map((focusTopic) => (
                <option key={focusTopic.id} value={focusTopic.id}>{focusTopic.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <strong>Available scenarios ({filteredOptions.length})</strong>

      <div className="scenario-option-list" aria-label="Available scenarios">
        {filteredOptions.map((option) => (
          <label key={option.id} className="scenario-option-row">
            <input
              type="checkbox"
              checked={false}
              disabled={disabled}
              aria-label={`Add ${option.title}`}
              onChange={() => {
                onChange(addTrainingContentScenarioSelection(selected, option));
                returnFocusToSearch();
              }}
            />
            <span>
              <strong>{option.title}</strong>
              <small>
                {option.source === "custom" ? "Custom" : "Standard"}
                {option.role ? ` · ${option.role.label}` : ""}
              </small>
            </span>
          </label>
        ))}
        {filteredOptions.length === 0 ? (
          <p className="muted-copy scenario-option-empty">
            {filtersActive
              ? "No matching available scenarios."
              : options.length === 0
                ? "No scenarios are currently available."
                : "All available scenarios are selected."}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
