import {
  DashboardCoachingInsights,
  DashboardCoachingNormalizationCategoryDiagnostics,
  DashboardCoachingNormalizationDiagnostics,
  DashboardCoachingThemeSummary,
  DashboardUnmappedCoachingPhraseSummary,
  SimulationScoreCoachingArtifact,
  SimulationScoreCoachingThemeTag,
  SimulationScoreNormalizedThemes,
  SimulationScoreRecord,
} from "@voicepractice/shared";

interface CoachingThemeDefinition {
  id: string;
  label: string;
  matchers: RegExp[];
}

export const COACHING_THEME_DEFINITIONS: CoachingThemeDefinition[] = [
  {
    id: "objection_handling",
    label: "Objection handling",
    matchers: [/objection/, /pushback/, /concern/, /skeptic/, /resistan/],
  },
  {
    id: "active_listening",
    label: "Active listening",
    matchers: [/listen/, /listening/, /\bheard\b/, /understand/, /acknowledg/],
  },
  {
    id: "empathy_rapport",
    label: "Empathy and rapport",
    matchers: [/empath/, /rapport/, /validate/, /emotion/, /connect/],
  },
  {
    id: "clarity_structure",
    label: "Clarity and structure",
    matchers: [/clarity/, /\bclear\b/, /structure/, /organi[sz]/, /concis/, /simple/],
  },
  {
    id: "confidence_conviction",
    label: "Confidence and conviction",
    matchers: [/confiden/, /conviction/, /hesitan/, /certainty/],
  },
  {
    id: "assertiveness_boundaries",
    label: "Assertiveness and boundaries",
    matchers: [/assertive/, /direct/, /boundary/, /\bfirm\b/],
  },
  {
    id: "evidence_examples",
    label: "Evidence and examples",
    matchers: [/evidence/, /example/, /\bproof\b/, /\bdata\b/, /supporting detail/],
  },
  {
    id: "next_steps_closing",
    label: "Next steps and closing",
    matchers: [/next step/, /follow-?up/, /closing/, /\bclose\b/, /commitment/, /action plan/],
  },
  {
    id: "questioning_discovery",
    label: "Questioning and discovery",
    matchers: [/question/, /discovery/, /probe/, /curious/],
  },
  {
    id: "de_escalation_tone",
    label: "De-escalation and tone",
    matchers: [/de-?escal/, /\btone\b/, /\bcalm\b/, /escalation/, /defens/],
  },
  {
    id: "value_articulation",
    label: "Value articulation",
    matchers: [/\bvalue\b/, /benefit/, /impact/, /why it matters/],
  },
  {
    id: "brevity_pacing",
    label: "Brevity and pacing",
    matchers: [/brevity/, /pacing/, /rambl/, /too long/, /wordy/],
  },
];

function normalizeCoachingThemeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCoachingPhrase(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function canonicalizeCoachingTheme(value: string): SimulationScoreCoachingThemeTag | null {
  const normalized = normalizeCoachingThemeKey(value);
  if (!normalized) {
    return null;
  }

  const matched = COACHING_THEME_DEFINITIONS.find((theme) => theme.matchers.some((matcher) => matcher.test(normalized)));
  if (!matched) {
    return null;
  }

  return {
    id: matched.id,
    label: matched.label,
  };
}

export function dedupeCoachingThemeTags(tags: SimulationScoreCoachingThemeTag[]): SimulationScoreCoachingThemeTag[] {
  const unique = new Map<string, SimulationScoreCoachingThemeTag>();
  for (const tag of tags) {
    if (!unique.has(tag.id)) {
      unique.set(tag.id, tag);
    }
  }
  return Array.from(unique.values());
}

export function buildNormalizedSimulationScoreThemesFromArtifact(
  artifact: SimulationScoreCoachingArtifact | null | undefined
): SimulationScoreNormalizedThemes | null {
  if (!artifact) {
    return null;
  }

  const strengths = dedupeCoachingThemeTags(
    artifact.strengths
      .map((entry) => canonicalizeCoachingTheme(entry))
      .filter((entry): entry is SimulationScoreCoachingThemeTag => Boolean(entry))
  );
  const improvementAreas = dedupeCoachingThemeTags(
    artifact.improvementAreas
      .map((entry) => canonicalizeCoachingTheme(entry))
      .filter((entry): entry is SimulationScoreCoachingThemeTag => Boolean(entry))
  );
  const coachingPriority = artifact.coachingPriority ? canonicalizeCoachingTheme(artifact.coachingPriority) : null;

  if (strengths.length === 0 && improvementAreas.length === 0 && !coachingPriority) {
    return null;
  }

  return {
    strengths,
    improvementAreas,
    coachingPriority,
  };
}

export function getEffectiveNormalizedCoachingThemes(record: SimulationScoreRecord): SimulationScoreNormalizedThemes | null {
  return record.normalizedCoachingThemes ?? buildNormalizedSimulationScoreThemesFromArtifact(record.coachingArtifact);
}

function hasPersistedCoachingArtifact(
  record: SimulationScoreRecord
): record is SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> } {
  return Boolean(record.coachingArtifact);
}

export function buildDashboardCoachingThemeSummaries(
  currentRecords: SimulationScoreRecord[],
  previousRecords: SimulationScoreRecord[],
  selectThemes: (themes: SimulationScoreNormalizedThemes) => SimulationScoreCoachingThemeTag[]
): DashboardCoachingThemeSummary[] {
  const buckets = new Map<
    string,
    {
      id: string;
      label: string;
      currentCount: number;
      previousCount: number;
    }
  >();

  const accumulate = (records: SimulationScoreRecord[], key: "currentCount" | "previousCount") => {
    for (const record of records) {
      const themes = getEffectiveNormalizedCoachingThemes(record);
      if (!themes) {
        continue;
      }

      const deduped = new Set<string>();
      for (const theme of selectThemes(themes)) {
        if (deduped.has(theme.id)) {
          continue;
        }
        deduped.add(theme.id);
        const current = buckets.get(theme.id);
        if (current) {
          current[key] += 1;
          if (key === "currentCount") {
            current.label = theme.label;
          }
          continue;
        }

        buckets.set(theme.id, {
          id: theme.id,
          label: theme.label,
          currentCount: key === "currentCount" ? 1 : 0,
          previousCount: key === "previousCount" ? 1 : 0,
        });
      }
    }
  };

  accumulate(currentRecords, "currentCount");
  accumulate(previousRecords, "previousCount");

  return Array.from(buckets.values())
    .filter((entry) => entry.currentCount > 0)
    .sort((left, right) => {
      if (right.currentCount !== left.currentCount) {
        return right.currentCount - left.currentCount;
      }
      const leftDelta = left.currentCount - left.previousCount;
      const rightDelta = right.currentCount - right.previousCount;
      if (rightDelta !== leftDelta) {
        return rightDelta - leftDelta;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, 3)
    .map((entry) => ({
      themeId: entry.id,
      theme: entry.label,
      countLast30Days: entry.currentCount,
      countPrior30Days: entry.previousCount,
      deltaCount: entry.currentCount - entry.previousCount,
    }));
}

export function buildDashboardUnmappedPhraseDiagnostics(
  currentRecords: Array<SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> }>,
  previousRecords: Array<SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> }>,
  selectPhrases: (artifact: NonNullable<SimulationScoreRecord["coachingArtifact"]>) => Array<string | null | undefined>
): DashboardCoachingNormalizationCategoryDiagnostics {
  const buckets = new Map<
    string,
    {
      phrase: string;
      currentCount: number;
      previousCount: number;
    }
  >();
  let totalPhrasesLast30Days = 0;
  let mappedPhrasesLast30Days = 0;

  const accumulate = (
    records: Array<SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> }>,
    key: "currentCount" | "previousCount"
  ) => {
    for (const record of records) {
      const seenPhrases = new Set<string>();
      for (const rawPhrase of selectPhrases(record.coachingArtifact)) {
        const phrase = normalizeCoachingPhrase(rawPhrase);
        if (!phrase) {
          continue;
        }

        const normalizedPhrase = normalizeCoachingThemeKey(phrase);
        if (seenPhrases.has(normalizedPhrase)) {
          continue;
        }
        seenPhrases.add(normalizedPhrase);

        const mappedTheme = canonicalizeCoachingTheme(phrase);
        if (key === "currentCount") {
          totalPhrasesLast30Days += 1;
          if (mappedTheme) {
            mappedPhrasesLast30Days += 1;
          }
        }

        if (mappedTheme) {
          continue;
        }

        const current = buckets.get(normalizedPhrase);
        if (current) {
          current[key] += 1;
          if (key === "currentCount") {
            current.phrase = phrase;
          }
          continue;
        }

        buckets.set(normalizedPhrase, {
          phrase,
          currentCount: key === "currentCount" ? 1 : 0,
          previousCount: key === "previousCount" ? 1 : 0,
        });
      }
    }
  };

  accumulate(currentRecords, "currentCount");
  accumulate(previousRecords, "previousCount");

  const topUnmappedPhrases: DashboardUnmappedCoachingPhraseSummary[] = Array.from(buckets.values())
    .filter((entry) => entry.currentCount > 0)
    .sort((left, right) => {
      if (right.currentCount !== left.currentCount) {
        return right.currentCount - left.currentCount;
      }
      const leftDelta = left.currentCount - left.previousCount;
      const rightDelta = right.currentCount - right.previousCount;
      if (rightDelta !== leftDelta) {
        return rightDelta - leftDelta;
      }
      return left.phrase.localeCompare(right.phrase);
    })
    .slice(0, 5)
    .map((entry) => ({
      phrase: entry.phrase,
      countLast30Days: entry.currentCount,
      countPrior30Days: entry.previousCount,
      deltaCount: entry.currentCount - entry.previousCount,
    }));

  return {
    totalPhrasesLast30Days,
    mappedPhrasesLast30Days,
    unmappedPhrasesLast30Days: Math.max(0, totalPhrasesLast30Days - mappedPhrasesLast30Days),
    mappingCoveragePercentLast30Days:
      totalPhrasesLast30Days > 0 ? Math.round((mappedPhrasesLast30Days / totalPhrasesLast30Days) * 1000) / 10 : null,
    topUnmappedPhrases,
  };
}

export function buildDashboardCoachingNormalizationDiagnostics(
  currentRecords: Array<SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> }>,
  previousRecords: Array<SimulationScoreRecord & { coachingArtifact: NonNullable<SimulationScoreRecord["coachingArtifact"]> }>
): DashboardCoachingNormalizationDiagnostics {
  return {
    mode: "platform_admin_internal",
    canonicalThemeCount: COACHING_THEME_DEFINITIONS.length,
    strengths: buildDashboardUnmappedPhraseDiagnostics(currentRecords, previousRecords, (artifact) => artifact.strengths),
    improvementAreas: buildDashboardUnmappedPhraseDiagnostics(currentRecords, previousRecords, (artifact) => artifact.improvementAreas),
    coachingPriorities: buildDashboardUnmappedPhraseDiagnostics(currentRecords, previousRecords, (artifact) => [
      artifact.coachingPriority,
    ]),
  };
}

export function buildDashboardCoachingInsights(params: {
  currentScores: SimulationScoreRecord[];
  previousScores: SimulationScoreRecord[];
  includeNormalizationDiagnostics?: boolean;
}): DashboardCoachingInsights {
  const currentArtifactScores = params.currentScores.filter(hasPersistedCoachingArtifact);
  const previousArtifactScores = params.previousScores.filter(hasPersistedCoachingArtifact);
  const currentNormalizedThemeScores = params.currentScores.filter((record) => Boolean(getEffectiveNormalizedCoachingThemes(record)));
  const topImprovementAreas = buildDashboardCoachingThemeSummaries(
    params.currentScores,
    params.previousScores,
    (themes) => themes.improvementAreas
  );
  const topStrengths = buildDashboardCoachingThemeSummaries(
    params.currentScores,
    params.previousScores,
    (themes) => themes.strengths
  );
  const topCoachingPriorities = buildDashboardCoachingThemeSummaries(
    params.currentScores,
    params.previousScores,
    (themes) => (themes.coachingPriority ? [themes.coachingPriority] : [])
  );
  const artifactCoveragePercentLast30Days =
    params.currentScores.length > 0
      ? Math.round((currentArtifactScores.length / params.currentScores.length) * 1000) / 10
      : null;
  const normalizedThemeCoveragePercentLast30Days =
    params.currentScores.length > 0
      ? Math.round((currentNormalizedThemeScores.length / params.currentScores.length) * 1000) / 10
      : null;

  return {
    mode: "artifact_only",
    totalScoredAttemptsLast30Days: params.currentScores.length,
    artifactBackedScoresLast30Days: currentArtifactScores.length,
    artifactCoveragePercentLast30Days,
    normalizedThemeScoresLast30Days: currentNormalizedThemeScores.length,
    normalizedThemeCoveragePercentLast30Days,
    topImprovementAreas,
    topStrengths,
    topCoachingPriorities,
    repeatedFocusArea: topCoachingPriorities[0]?.theme ?? null,
    normalizationDiagnostics: params.includeNormalizationDiagnostics
      ? buildDashboardCoachingNormalizationDiagnostics(currentArtifactScores, previousArtifactScores)
      : null,
  };
}
