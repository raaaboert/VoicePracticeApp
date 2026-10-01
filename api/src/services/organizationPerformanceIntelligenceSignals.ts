import type { OrganizationPerformanceIntelligenceFacts } from "./organizationPerformanceIntelligenceFacts.js";
import {
  derivePerformanceIntelligenceSignalCore,
  type PerformanceIntelligenceSignalCore,
} from "./teamPerformanceIntelligenceSignals.js";

export interface DeriveOrganizationPerformanceIntelligenceSignalsInput {
  readonly facts: OrganizationPerformanceIntelligenceFacts;
  /** An explicit instant. No ambient clock is read by this service. */
  readonly asOf: Date;
}

export interface OrganizationPerformanceIntelligenceSignals
  extends PerformanceIntelligenceSignalCore {
  readonly scope: "organization";
  readonly populationBasis: "current_members";
  readonly population: OrganizationPerformanceIntelligenceFacts["population"];
}

export class OrganizationPerformanceIntelligenceSignalInputError extends Error {
  constructor() {
    super("Organization performance intelligence signals require a valid explicit asOf date.");
    this.name = "OrganizationPerformanceIntelligenceSignalInputError";
  }
}

/**
 * INTERNAL - NOT ROUTE-SAFE. Purely derives deterministic organization signals
 * from approved identity-free facts and an explicit instant. It performs no
 * evidence reads, population resolution, aggregation, writes, or clock reads.
 */
export function deriveOrganizationPerformanceIntelligenceSignals(
  input: DeriveOrganizationPerformanceIntelligenceSignalsInput,
): OrganizationPerformanceIntelligenceSignals {
  if (!Number.isFinite(input.asOf.getTime())) {
    throw new OrganizationPerformanceIntelligenceSignalInputError();
  }
  const core = derivePerformanceIntelligenceSignalCore(input);
  return {
    scope: "organization",
    populationBasis: "current_members",
    population: { ...input.facts.population },
    currentMonth: core.currentMonth,
    comparisonMonth: core.comparisonMonth,
    monthCompleteness: core.monthCompleteness,
    activityMovement: core.activityMovement,
    metricMovement: core.metricMovement,
    relativeDimensions: core.relativeDimensions,
    completionMovement: core.completionMovement,
    focus: core.focus,
  };
}
