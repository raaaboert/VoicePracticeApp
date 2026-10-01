import Link from "next/link";

import { buildPerformanceViewHref, type PerformanceView } from "@/src/components/performanceViewRoutes";

export function PerformanceNavigation({
  activeView,
  orgId,
  divisionId,
}: {
  activeView: PerformanceView;
  orgId?: string | null;
  divisionId?: string | null;
}) {
  const views: readonly { view: PerformanceView; label: string }[] = [
    { view: "group", label: "Group Summary" },
    { view: "individuals", label: "Individuals" },
    { view: "goals", label: "Goals" },
  ];
  return (
    <nav className="tab-row performance-navigation" aria-label="Performance views">
      {views.map(({ view, label }) => (
        <Link
          key={view}
          className={`tab-button${activeView === view ? " active" : ""}`}
          href={buildPerformanceViewHref(view, { orgId, divisionId })}
          aria-current={activeView === view ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
