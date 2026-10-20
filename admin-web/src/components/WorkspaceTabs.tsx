"use client";

export function WorkspaceTabs<T extends string>({ id, label, tabs, value, onChange }: {
  id: string; label: string; tabs: readonly { id: T; label: string }[];
  value: T; onChange: (value: T) => void;
}) {
  return <div className="tab-row" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
      id={`${id}-tab-${tab.id}`} aria-selected={value === tab.id}
      aria-controls={`${id}-panel-${tab.id}`} tabIndex={value === tab.id ? 0 : -1}
      className={`tab-button ${value === tab.id ? "active" : ""}`}
      onClick={() => onChange(tab.id)} onKeyDown={(event) => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
        if (next === null) return;
        event.preventDefault();
        onChange(tabs[next].id);
        // Focus follows the requested tab even when navigation awaits a dirty-editor decision.
        document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
      }}>{tab.label}</button>)}
  </div>;
}
