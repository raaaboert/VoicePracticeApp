"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardDivisionScope } from "@voicepractice/shared";

import {
  buildDashboardDivisionSearch,
  canRenderSingleScopeDivisionFilter,
  formatDashboardDivisionOptionLabel,
} from "@/src/components/dashboardDivisionFilterState";

export function DashboardDivisionFilter({
  divisionScope,
  title = "Reporting lens",
  description = "Company Total keeps the default account-wide view. Division filters narrow the view to historically attributed activity only.",
}: {
  divisionScope?: DashboardDivisionScope | null;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!canRenderSingleScopeDivisionFilter(divisionScope)) {
    return null;
  }

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Division lens</p>
          <h2>{title}</h2>
          <p className="section-copy">{description}</p>
        </div>
      </div>

      <div className="dashboard-selector-grid">
        <div className="dashboard-selector-field">
          <label className="field-label" htmlFor="division-filter">
            View
          </label>
          <select
            id="division-filter"
            className="text-input"
            value={divisionScope?.appliedDivisionId ?? ""}
            onChange={(event) => {
              const nextDivisionId = event.target.value || null;
              router.replace(`${pathname}${buildDashboardDivisionSearch(searchParams.toString(), nextDivisionId)}`);
            }}
          >
            <option value="">Company Total</option>
            {(divisionScope?.divisions ?? []).map((division) => (
              <option key={division.id} value={division.id}>
                {formatDashboardDivisionOptionLabel(division)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
