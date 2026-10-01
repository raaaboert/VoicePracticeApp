"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DashboardAdminManagerOption } from "@voicepractice/shared";

export type ManagerComboboxOption = DashboardAdminManagerOption;

const UNASSIGNED_OPTION: ManagerComboboxOption = {
  userId: "",
  email: "",
  firstName: null,
  lastName: null,
  displayName: "Unassigned",
};

export function normalizeManagerSearch(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function filterManagerOptions(
  options: readonly DashboardAdminManagerOption[],
  query: string
): ManagerComboboxOption[] {
  const normalizedQuery = normalizeManagerSearch(query);
  const allOptions = [UNASSIGNED_OPTION, ...options];
  if (!normalizedQuery) return allOptions;

  return allOptions.filter((option) => normalizeManagerSearch([
    option.firstName ?? "",
    option.lastName ?? "",
    `${option.firstName ?? ""} ${option.lastName ?? ""}`,
    option.displayName,
    option.email,
  ].join(" ")).includes(normalizedQuery));
}

export function moveManagerHighlight(current: number, direction: 1 | -1, optionCount: number): number {
  if (optionCount <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : optionCount - 1;
  return (current + direction + optionCount) % optionCount;
}

export function managerSelectionLabel(
  options: readonly DashboardAdminManagerOption[],
  value: string,
  fallbackLabel?: string
): string {
  if (!value) return UNASSIGNED_OPTION.displayName;
  const selected = options.find((option) => option.userId === value);
  return selected?.displayName ?? fallbackLabel ?? "Manager unavailable";
}

export function ManagerCombobox({
  value,
  options,
  disabled,
  ariaLabel,
  fallbackLabel,
  onChange,
}: {
  value: string;
  options: readonly DashboardAdminManagerOption[];
  disabled: boolean;
  ariaLabel: string;
  fallbackLabel?: string;
  onChange: (managerUserId: string) => void;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLabel = managerSelectionLabel(options, value, fallbackLabel);
  const [query, setQuery] = useState(selectedLabel);
  const [isOpen, setIsOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const visibleOptions = useMemo(
    () => filterManagerOptions(options, isFiltering ? query : ""),
    [isFiltering, options, query]
  );

  useEffect(() => {
    setQuery(selectedLabel);
    setIsFiltering(false);
    setIsOpen(false);
    setActiveIndex(-1);
  }, [selectedLabel]);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen]);

  const openOptions = () => {
    if (disabled) return;
    setIsOpen(true);
    setIsFiltering(false);
    setActiveIndex(Math.max(0, visibleOptions.findIndex((option) => option.userId === value)));
  };

  const selectOption = (option: ManagerComboboxOption) => {
    onChange(option.userId);
    setQuery(option.displayName);
    setIsFiltering(false);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      className="manager-combobox"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setQuery(selectedLabel);
        setIsFiltering(false);
        setIsOpen(false);
        setActiveIndex(-1);
      }}
    >
      <input
        ref={inputRef}
        className="text-input compact-input manager-combobox-input"
        type="search"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && visibleOptions[activeIndex]
          ? `${listboxId}-option-${activeIndex}`
          : undefined}
        autoComplete="off"
        disabled={disabled}
        value={query}
        onFocus={(event) => {
          openOptions();
          event.currentTarget.select();
        }}
        onClick={(event) => {
          openOptions();
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsFiltering(true);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!isOpen) {
              openOptions();
              return;
            }
            setActiveIndex((current) => moveManagerHighlight(
              current,
              event.key === "ArrowDown" ? 1 : -1,
              visibleOptions.length
            ));
            return;
          }
          if (event.key === "Enter" && isOpen && activeIndex >= 0 && visibleOptions[activeIndex]) {
            event.preventDefault();
            selectOption(visibleOptions[activeIndex]);
            return;
          }
          if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            setQuery(selectedLabel);
            setIsFiltering(false);
            setIsOpen(false);
            setActiveIndex(-1);
          }
        }}
      />
      {isOpen ? (
        visibleOptions.length > 0 ? (
          <div id={listboxId} className="manager-combobox-listbox" role="listbox" aria-label="Eligible managers">
            {visibleOptions.map((option, index) => (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                id={`${listboxId}-option-${index}`}
                key={option.userId || "unassigned"}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.userId === value}
                className={`manager-combobox-option${index === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span>{option.displayName}</span>
                {option.email ? <small>{option.email}</small> : null}
              </button>
            ))}
          </div>
        ) : (
          <div id={listboxId} className="manager-combobox-empty" role="status">No matching managers</div>
        )
      ) : null}
    </div>
  );
}
