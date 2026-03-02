"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppConfig,
  buildDefaultScoringGuidance,
  CreateOrgCustomScenarioRequest,
  GenerateOrgCustomScenarioRequest,
  GenerateOrgCustomScenarioResponse,
  IndustryDefinition,
  OrgCustomScenario,
  OrgCustomScenarioGenerationInputs,
  OrgCustomScenarioCreationMethod,
  OrgCustomScenarioSourceMode,
  UpdateOrgCustomScenarioRequest,
} from "@voicepractice/shared";
import { adminFetch } from "../lib/api";

interface EnterpriseCustomScenariosCardProps {
  orgId: string;
  orgName?: string;
  config: AppConfig | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface OrgCustomScenariosListResponse {
  generatedAt: string;
  orgId: string;
  scenarios: OrgCustomScenario[];
}

interface BaseScenarioOption {
  id: string;
  title: string;
  description: string;
  aiRole: string;
  enabled: boolean;
  segmentId: string;
  segmentLabel: string;
}

interface GenerationInputsForm {
  companyName: string;
  productOrService: string;
  targetPersona: string;
  keyObjectionsText: string;
  tone: string;
  difficulty: string;
  mustInclude: string;
  mustAvoid: string;
  complianceConstraints: string;
  specialInstructions: string;
}

interface EditorFormState {
  id: string | null;
  sourceMode: OrgCustomScenarioSourceMode;
  creationMethod: OrgCustomScenarioCreationMethod;
  baseScenarioId: string;
  segmentId: string;
  applicableIndustryIds: string[];
  title: string;
  description: string;
  aiRole: string;
  scoringGuidance: string;
  enabled: boolean;
  generationInputs: GenerationInputsForm;
  provenanceBaseScenarioTitle: string;
  provenanceBaseScenarioSegmentId: string;
  provenanceBaseScenarioVersion: string;
  provenanceGeneratedPrompt: string;
  provenanceModelUsed: string;
  provenanceGeneratedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

type EditorMode = "create" | "edit";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(",")).join("\n");
}

function downloadCsv(rows: string[][], fileName: string): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function emptyGenerationInputs(): GenerationInputsForm {
  return {
    companyName: "",
    productOrService: "",
    targetPersona: "",
    keyObjectionsText: "",
    tone: "",
    difficulty: "",
    mustInclude: "",
    mustAvoid: "",
    complianceConstraints: "",
    specialInstructions: "",
  };
}

function parseKeyObjectionsText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function toGenerationInputsPayload(value: GenerationInputsForm): OrgCustomScenarioGenerationInputs | undefined {
  const payload: OrgCustomScenarioGenerationInputs = {};
  const companyName = value.companyName.trim();
  if (companyName) payload.companyName = companyName;
  const productOrService = value.productOrService.trim();
  if (productOrService) payload.productOrService = productOrService;
  const targetPersona = value.targetPersona.trim();
  if (targetPersona) payload.targetPersona = targetPersona;
  const keyObjections = parseKeyObjectionsText(value.keyObjectionsText);
  if (keyObjections.length > 0) payload.keyObjections = keyObjections;
  const tone = value.tone.trim();
  if (tone) payload.tone = tone;
  const mustInclude = value.mustInclude.trim();
  if (mustInclude) payload.mustInclude = mustInclude;
  const mustAvoid = value.mustAvoid.trim();
  if (mustAvoid) payload.mustAvoid = mustAvoid;
  const complianceConstraints = value.complianceConstraints.trim();
  if (complianceConstraints) payload.complianceConstraints = complianceConstraints;
  const specialInstructions = value.specialInstructions.trim();
  if (specialInstructions) payload.specialInstructions = specialInstructions;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function toScoringIndustryContexts(industries: IndustryDefinition[], selectedIndustryIds: string[]) {
  const selected = new Set(selectedIndustryIds);
  const source = selected.size > 0 ? industries.filter((industry) => selected.has(industry.id)) : industries;
  return source.map((industry) => ({
    id: industry.id,
    label: industry.label,
    aiBaseline: industry.aiBaseline ?? ""
  }));
}

function createEmptyEditorForm(config: AppConfig | null): EditorFormState {
  const defaultIndustryContexts = toScoringIndustryContexts(config?.industries ?? [], []);
  return {
    id: null,
    sourceMode: "scratch",
    creationMethod: "manual",
    baseScenarioId: "",
    segmentId: config?.segments?.[0]?.id ?? "",
    applicableIndustryIds: [],
    title: "",
    description: "",
    aiRole: "",
    scoringGuidance: buildDefaultScoringGuidance({ industryContexts: defaultIndustryContexts }),
    enabled: false,
    generationInputs: emptyGenerationInputs(),
    provenanceBaseScenarioTitle: "",
    provenanceBaseScenarioSegmentId: "",
    provenanceBaseScenarioVersion: "",
    provenanceGeneratedPrompt: "",
    provenanceModelUsed: "",
    provenanceGeneratedAt: "",
    createdBy: "",
    createdAt: "",
    updatedAt: "",
  };
}

function editorFormFromScenario(scenario: OrgCustomScenario): EditorFormState {
  return {
    id: scenario.id,
    sourceMode: scenario.provenance.sourceMode,
    creationMethod: scenario.provenance.creationMethod,
    baseScenarioId: scenario.provenance.baseScenarioId ?? "",
    segmentId: scenario.segmentId,
    applicableIndustryIds: [...(scenario.applicableIndustryIds ?? [])],
    title: scenario.title,
    description: scenario.description,
    aiRole: scenario.aiRole,
    scoringGuidance: scenario.scoringGuidance ?? "",
    enabled: scenario.enabled === true,
    generationInputs: {
      companyName: scenario.provenance.customizationParams?.companyName ?? "",
      productOrService: scenario.provenance.customizationParams?.productOrService ?? "",
      targetPersona: scenario.provenance.customizationParams?.targetPersona ?? "",
      keyObjectionsText: (scenario.provenance.customizationParams?.keyObjections ?? []).join("\n"),
      tone: scenario.provenance.customizationParams?.tone ?? "",
      difficulty: scenario.provenance.customizationParams?.difficulty ?? "",
      mustInclude: scenario.provenance.customizationParams?.mustInclude ?? "",
      mustAvoid: scenario.provenance.customizationParams?.mustAvoid ?? "",
      complianceConstraints: scenario.provenance.customizationParams?.complianceConstraints ?? "",
      specialInstructions: scenario.provenance.customizationParams?.specialInstructions ?? "",
    },
    provenanceBaseScenarioTitle: scenario.provenance.baseScenarioTitle ?? "",
    provenanceBaseScenarioSegmentId: scenario.provenance.baseScenarioSegmentId ?? "",
    provenanceBaseScenarioVersion: scenario.provenance.baseScenarioVersion ?? "",
    provenanceGeneratedPrompt: scenario.provenance.generatedPrompt ?? "",
    provenanceModelUsed: scenario.provenance.modelUsed ?? "",
    provenanceGeneratedAt: scenario.provenance.generatedAt ?? "",
    createdBy: scenario.createdBy ?? "",
    createdAt: scenario.createdAt ?? "",
    updatedAt: scenario.updatedAt ?? "",
  };
}

export function EnterpriseCustomScenariosCard({
  orgId,
  orgName,
  config,
  collapsed = false,
  onToggleCollapse,
}: EnterpriseCustomScenariosCardProps) {
  const [scenarios, setScenarios] = useState<OrgCustomScenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editorForm, setEditorForm] = useState<EditorFormState>(() => createEmptyEditorForm(config));
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [baseScenarioSearch, setBaseScenarioSearch] = useState("");
  const [generationPreview, setGenerationPreview] = useState<GenerateOrgCustomScenarioResponse | null>(null);
  const [generatingPreview, setGeneratingPreview] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [togglingScenarioId, setTogglingScenarioId] = useState<string | null>(null);

  const roles = useMemo(
    () => [...(config?.segments ?? [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [config?.segments],
  );
  const industries = useMemo(
    () => [...(config?.industries ?? [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [config?.industries],
  );

  const roleLabelById = useMemo(() => new Map((config?.segments ?? []).map((role) => [role.id, role.label])), [config?.segments]);
  const industryById = useMemo(
    () => new Map<string, IndustryDefinition>((config?.industries ?? []).map((industry) => [industry.id, industry])),
    [config?.industries],
  );

  const baseScenarioOptions = useMemo<BaseScenarioOption[]>(() => {
    const result: BaseScenarioOption[] = [];
    for (const segment of config?.segments ?? []) {
      for (const scenario of segment.scenarios ?? []) {
        result.push({
          id: scenario.id,
          title: scenario.title,
          description: scenario.description,
          aiRole: scenario.aiRole,
          enabled: scenario.enabled !== false,
          segmentId: segment.id,
          segmentLabel: segment.label,
        });
      }
    }
    return result.sort((a, b) => {
      const byRole = a.segmentLabel.localeCompare(b.segmentLabel, undefined, { sensitivity: "base" });
      return byRole !== 0 ? byRole : a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }, [config?.segments]);

  const selectedBaseScenario = useMemo(
    () => baseScenarioOptions.find((item) => item.id === editorForm.baseScenarioId) ?? null,
    [baseScenarioOptions, editorForm.baseScenarioId],
  );

  const filteredBaseScenarioOptions = useMemo(() => {
    const needle = baseScenarioSearch.trim().toLowerCase();
    if (!needle) return baseScenarioOptions;
    return baseScenarioOptions.filter((item) =>
      [item.title, item.description, item.aiRole, item.segmentLabel].join(" ").toLowerCase().includes(needle),
    );
  }, [baseScenarioOptions, baseScenarioSearch]);

  const filteredScenarios = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return scenarios.filter((scenario) => {
      if (roleFilter && scenario.segmentId !== roleFilter) return false;
      if (!needle) return true;
      const industriesText = (scenario.applicableIndustryIds ?? []).map((id) => industryById.get(id)?.label ?? id).join(" ");
      return [scenario.title, scenario.description, scenario.aiRole, scenario.scoringGuidance, industriesText]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [scenarios, searchText, roleFilter, industryById]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await adminFetch<OrgCustomScenariosListResponse>(`/orgs/${orgId}/custom-scenarios`);
        if (cancelled) return;
        setScenarios(payload.scenarios ?? []);
        setGeneratedAt(payload.generatedAt ?? null);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not load custom scenarios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const refreshScenarios = async (options?: { preserveNotice?: boolean }) => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }
    try {
      const payload = await adminFetch<OrgCustomScenariosListResponse>(`/orgs/${orgId}/custom-scenarios`);
      setScenarios(payload.scenarios ?? []);
      setGeneratedAt(payload.generatedAt ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load custom scenarios.");
    } finally {
      setLoading(false);
    }
  };

  const openCreateEditor = () => {
    setEditorMode("create");
    setEditorForm(createEmptyEditorForm(config));
    setEditorError(null);
    setGenerationPreview(null);
    setBaseScenarioSearch("");
    setEditorOpen(true);
  };

  const openEditEditor = (scenario: OrgCustomScenario) => {
    setEditorMode("edit");
    setEditorForm(editorFormFromScenario(scenario));
    setEditorError(null);
    setGenerationPreview(null);
    setBaseScenarioSearch("");
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorError(null);
    setGenerationPreview(null);
    setGeneratingPreview(false);
  };

  const resetDeleteDialog = () => {
    setDeleteTargetId(null);
    setDeleteStep(1);
    setDeleteText("");
  };

  const getScenarioById = (scenarioId: string | null): OrgCustomScenario | null =>
    scenarioId ? scenarios.find((entry) => entry.id === scenarioId) ?? null : null;

  const setSourceMode = (sourceMode: OrgCustomScenarioSourceMode) => {
    setEditorForm((prev) => ({
      ...prev,
      sourceMode,
      baseScenarioId: sourceMode === "standard_base" ? prev.baseScenarioId : "",
      provenanceBaseScenarioTitle: sourceMode === "standard_base" ? prev.provenanceBaseScenarioTitle : "",
      provenanceBaseScenarioSegmentId: sourceMode === "standard_base" ? prev.provenanceBaseScenarioSegmentId : "",
      provenanceBaseScenarioVersion: sourceMode === "standard_base" ? prev.provenanceBaseScenarioVersion : "",
    }));
    setGenerationPreview(null);
  };

  const prefillFromBaseScenario = (base: BaseScenarioOption) => {
    setEditorForm((prev) => {
      const currentGuidance = prev.scoringGuidance.trim();
      const currentTemplate = buildDefaultScoringGuidance({
        industryContexts: toScoringIndustryContexts(industries, prev.applicableIndustryIds)
      });
      const nextTemplate = buildDefaultScoringGuidance({
        scenarioTitle: base.title,
        segmentLabel: base.segmentLabel,
        industryContexts: toScoringIndustryContexts(industries, prev.applicableIndustryIds)
      });

      return {
        ...prev,
        baseScenarioId: base.id,
        segmentId: base.segmentId,
        title: base.title,
        description: base.description,
        aiRole: base.aiRole,
        scoringGuidance: !currentGuidance || currentGuidance === currentTemplate ? nextTemplate : prev.scoringGuidance,
        provenanceBaseScenarioTitle: base.title,
        provenanceBaseScenarioSegmentId: base.segmentId,
        provenanceBaseScenarioVersion: config?.updatedAt ?? prev.provenanceBaseScenarioVersion,
      };
    });
    setGenerationPreview(null);
  };

  const handleBaseScenarioSelection = (scenarioId: string) => {
    const base = baseScenarioOptions.find((item) => item.id === scenarioId);
    if (!base) {
      setEditorForm((prev) => ({
        ...prev,
        baseScenarioId: "",
        provenanceBaseScenarioTitle: "",
        provenanceBaseScenarioSegmentId: "",
        provenanceBaseScenarioVersion: "",
      }));
      setGenerationPreview(null);
      return;
    }
    prefillFromBaseScenario(base);
  };

  const toggleIndustrySelection = (industryId: string) => {
    setEditorForm((prev) => {
      const next = new Set(prev.applicableIndustryIds);
      if (next.has(industryId)) next.delete(industryId);
      else next.add(industryId);
      return { ...prev, applicableIndustryIds: Array.from(next) };
    });
    setGenerationPreview(null);
  };

  const downloadAllScenariosCsv = () => {
    const rows: string[][] = [
      [
        "Org Id",
        "Org Name",
        "Custom Scenario Id",
        "Scenario Title",
        "Role",
        "Role Id",
        "Applicable Industries",
        "Applicable Industry Ids",
        "Description",
        "AI Role",
        "Scoring Guidance",
        "Status",
        "Source Mode",
        "Creation Method",
        "Base Scenario Title",
        "Base Scenario Id",
        "Base Scenario Role Id",
        "Created By",
        "Created At",
        "Updated At",
      ],
    ];

    for (const scenario of [...scenarios].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))) {
      rows.push([
        orgId,
        orgName ?? "",
        scenario.id,
        scenario.title,
        roleLabelById.get(scenario.segmentId) ?? scenario.segmentId,
        scenario.segmentId,
        (scenario.applicableIndustryIds ?? []).map((id) => industryById.get(id)?.label ?? id).join(" | "),
        (scenario.applicableIndustryIds ?? []).join(" | "),
        scenario.description,
        scenario.aiRole,
        scenario.scoringGuidance ?? "",
        scenario.enabled === true ? "active" : "inactive",
        scenario.provenance.sourceMode,
        scenario.provenance.creationMethod,
        scenario.provenance.baseScenarioTitle ?? "",
        scenario.provenance.baseScenarioId ?? "",
        scenario.provenance.baseScenarioSegmentId ?? "",
        scenario.createdBy ?? "",
        scenario.createdAt ?? "",
        scenario.updatedAt ?? "",
      ]);
    }

    downloadCsv(rows, `voicepractice-custom-scenarios-${orgId}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const downloadSingleScenarioCsv = (scenario: OrgCustomScenario | null) => {
    if (!scenario) return;
    downloadCsv(
      [
        [
          "Org Id",
          "Org Name",
          "Custom Scenario Id",
          "Scenario Title",
          "Role",
          "Role Id",
          "Applicable Industries",
          "Applicable Industry Ids",
          "Description",
          "AI Role",
          "Scoring Guidance",
          "Status",
          "Source Mode",
          "Creation Method",
          "Base Scenario Title",
          "Base Scenario Id",
          "Base Scenario Role Id",
        ],
        [
          orgId,
          orgName ?? "",
          scenario.id,
          scenario.title,
          roleLabelById.get(scenario.segmentId) ?? scenario.segmentId,
          scenario.segmentId,
          (scenario.applicableIndustryIds ?? []).map((id) => industryById.get(id)?.label ?? id).join(" | "),
          (scenario.applicableIndustryIds ?? []).join(" | "),
          scenario.description,
          scenario.aiRole,
          scenario.scoringGuidance ?? "",
          scenario.enabled === true ? "active" : "inactive",
          scenario.provenance.sourceMode,
          scenario.provenance.creationMethod,
          scenario.provenance.baseScenarioTitle ?? "",
          scenario.provenance.baseScenarioId ?? "",
          scenario.provenance.baseScenarioSegmentId ?? "",
        ],
      ],
      `custom-scenario-${scenario.id}.csv`,
    );
  };

  const buildProvenancePayload = (): NonNullable<CreateOrgCustomScenarioRequest["provenance"]> => ({
    sourceMode: editorForm.sourceMode,
    creationMethod: editorForm.creationMethod,
    baseScenarioId: editorForm.sourceMode === "standard_base" ? (editorForm.baseScenarioId || null) : null,
    baseScenarioTitle:
      editorForm.sourceMode === "standard_base" ? (editorForm.provenanceBaseScenarioTitle || null) : null,
    baseScenarioSegmentId:
      editorForm.sourceMode === "standard_base" ? (editorForm.provenanceBaseScenarioSegmentId || null) : null,
    baseScenarioVersion:
      editorForm.sourceMode === "standard_base" ? (editorForm.provenanceBaseScenarioVersion || config?.updatedAt || null) : null,
    customizationParams: toGenerationInputsPayload(editorForm.generationInputs) ?? null,
    generatedPrompt: editorForm.provenanceGeneratedPrompt.trim() || null,
    modelUsed: editorForm.provenanceModelUsed.trim() || null,
    generatedAt: editorForm.provenanceGeneratedAt.trim() || null,
  });

  const validateEditor = (): string | null => {
    if (!editorForm.segmentId.trim()) return "Select a role.";
    if (editorForm.applicableIndustryIds.length === 0) return "Select at least one applicable industry.";
    if (editorForm.sourceMode === "standard_base" && !editorForm.baseScenarioId.trim()) {
      return "Select a standard base scenario or switch to scratch mode.";
    }
    if (!editorForm.title.trim()) return "Scenario title is required.";
    if (!editorForm.description.trim()) return "Scenario context/description is required.";
    if (!editorForm.aiRole.trim()) return "AI Role is required.";
    if (!editorForm.scoringGuidance.trim()) return "Scoring Guidance is required.";
    return null;
  };

  const saveEditor = async () => {
    const validationError = validateEditor();
    if (validationError) {
      setEditorError(validationError);
      return;
    }

    setEditorSaving(true);
    setEditorError(null);
    setError(null);
    setNotice(null);

    try {
      if (editorMode === "create") {
        const payload: CreateOrgCustomScenarioRequest = {
          title: editorForm.title.trim(),
          description: editorForm.description.trim(),
          aiRole: editorForm.aiRole.trim(),
          scoringGuidance: editorForm.scoringGuidance.trim(),
          segmentId: editorForm.segmentId,
          applicableIndustryIds: editorForm.applicableIndustryIds,
          enabled: false,
          provenance: buildProvenancePayload(),
        };
        const created = await adminFetch<OrgCustomScenario>(`/orgs/${orgId}/custom-scenarios`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setScenarios((prev) =>
          [...prev.filter((entry) => entry.id !== created.id), created].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
          ),
        );
        setNotice(`Saved "${created.title}" as inactive.`);
      } else if (editorForm.id) {
        const payload: UpdateOrgCustomScenarioRequest = {
          title: editorForm.title.trim(),
          description: editorForm.description.trim(),
          aiRole: editorForm.aiRole.trim(),
          scoringGuidance: editorForm.scoringGuidance.trim(),
          segmentId: editorForm.segmentId,
          applicableIndustryIds: editorForm.applicableIndustryIds,
          enabled: editorForm.enabled,
          provenance: buildProvenancePayload(),
        };
        const updated = await adminFetch<OrgCustomScenario>(`/orgs/${orgId}/custom-scenarios/${editorForm.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setScenarios((prev) =>
          [...prev.filter((entry) => entry.id !== updated.id), updated].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
          ),
        );
        setNotice(`Saved "${updated.title}".`);
      }

      closeEditor();
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "Could not save custom scenario.");
    } finally {
      setEditorSaving(false);
    }
  };

  const generatePreview = async () => {
    const validationError =
      !editorForm.segmentId.trim()
        ? "Select a role before generating."
        : editorForm.applicableIndustryIds.length === 0
          ? "Select at least one applicable industry before generating."
          : editorForm.sourceMode === "standard_base" && !editorForm.baseScenarioId.trim()
            ? "Select a base scenario before generating."
            : null;
    if (validationError) {
      setEditorError(validationError);
      return;
    }

    setGeneratingPreview(true);
    setEditorError(null);
    setGenerationPreview(null);
    try {
      const payload: GenerateOrgCustomScenarioRequest = {
        sourceMode: editorForm.sourceMode,
        creationMethod: "ai",
        baseScenarioId: editorForm.sourceMode === "standard_base" ? editorForm.baseScenarioId : null,
        segmentId: editorForm.segmentId,
        applicableIndustryIds: editorForm.applicableIndustryIds,
        draft: {
          title: editorForm.title.trim() || undefined,
          description: editorForm.description.trim() || undefined,
          aiRole: editorForm.aiRole.trim() || undefined,
          scoringGuidance: editorForm.scoringGuidance.trim() || undefined,
        },
        generationInputs: toGenerationInputsPayload(editorForm.generationInputs),
      };
      const preview = await adminFetch<GenerateOrgCustomScenarioResponse>(`/orgs/${orgId}/custom-scenarios/generate`, {
        method: "POST",
        body: JSON.stringify(payload),
        // AI preview can exceed standard admin request timeouts (Render cold start + model latency).
        requestAttemptTimeoutMs: 25_000,
        requestTotalTimeoutMs: 75_000,
        requestMaxAttempts: 3,
      });
      setGenerationPreview(preview);
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "Could not generate preview.");
    } finally {
      setGeneratingPreview(false);
    }
  };

  const applyGenerationPreview = () => {
    if (!generationPreview) return;
    setEditorForm((prev) => ({
      ...prev,
      title: generationPreview.generated.title,
      description: generationPreview.generated.description,
      aiRole: generationPreview.generated.aiRole,
      scoringGuidance: generationPreview.generated.scoringGuidance,
      creationMethod: "ai",
      provenanceBaseScenarioTitle: generationPreview.source.baseScenarioTitle ?? prev.provenanceBaseScenarioTitle,
      provenanceBaseScenarioSegmentId:
        generationPreview.source.baseScenarioSegmentId ?? prev.provenanceBaseScenarioSegmentId,
      provenanceBaseScenarioVersion: generationPreview.source.baseScenarioVersion ?? prev.provenanceBaseScenarioVersion,
      provenanceGeneratedPrompt: generationPreview.promptPreview,
      provenanceModelUsed: generationPreview.model,
      provenanceGeneratedAt: new Date().toISOString(),
    }));
  };

  const toggleScenarioStatus = async (scenario: OrgCustomScenario, nextEnabled: boolean) => {
    setTogglingScenarioId(scenario.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await adminFetch<OrgCustomScenario>(`/orgs/${orgId}/custom-scenarios/${scenario.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled } satisfies UpdateOrgCustomScenarioRequest),
      });
      setScenarios((prev) =>
        [...prev.filter((entry) => entry.id !== updated.id), updated].sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
      );
      setNotice(`"${updated.title}" set to ${updated.enabled === true ? "active" : "inactive"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update scenario status.");
    } finally {
      setTogglingScenarioId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    if (deleteStep === 1) {
      setDeleteStep(2);
      return;
    }
    if (deleteText !== "Delete") {
      setError('Type "Delete" exactly to confirm.');
      return;
    }

    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const target = getScenarioById(deleteTargetId);
      await adminFetch<{ deleted: boolean }>(`/orgs/${orgId}/custom-scenarios/${deleteTargetId}`, {
        method: "DELETE",
      });
      setScenarios((prev) => prev.filter((entry) => entry.id !== deleteTargetId));
      if (editorOpen && editorForm.id === deleteTargetId) {
        closeEditor();
      }
      setNotice(target ? `Deleted "${target.title}".` : "Custom scenario deleted.");
      resetDeleteDialog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete custom scenario.");
    } finally {
      setDeleting(false);
    }
  };

  const deleteTargetScenario = getScenarioById(deleteTargetId);

  const renderDeleteModal = () => {
    if (!deleteTargetScenario) return null;

    return (
      <div className="content-modal-backdrop">
        <div className="card content-modal-card">
          <h3>Confirm Delete</h3>
          <p className="content-modal-copy">
            Delete <strong>{deleteTargetScenario.title}</strong>?
          </p>
          {deleteStep === 1 ? (
            <p className="small content-modal-copy">
              This action permanently removes the custom scenario. Recommended: download a CSV backup before deleting.
            </p>
          ) : (
            <>
              <p className="small content-modal-copy">
                Type <code>Delete</code> exactly, then confirm.
              </p>
              <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} />
            </>
          )}
          <div className="content-modal-actions">
            <button type="button" onClick={resetDeleteDialog} disabled={deleting}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void confirmDelete()}
              disabled={deleting || (deleteStep === 2 && deleteText !== "Delete")}
            >
              {deleting ? "Deleting..." : deleteStep === 1 ? "Continue" : "Confirm Delete"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEditorModal = () => {
    if (!editorOpen) return null;

    return (
      <div className="content-modal-backdrop" style={{ alignItems: "flex-start", paddingTop: 110, paddingBottom: 20 }}>
        <div
          className="card content-modal-card"
          style={{ maxWidth: 1100, maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}
        >
          <div className="content-section-header content-header-actions" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>
                {editorMode === "create" ? "Create Custom Scenario" : "Edit Custom Scenario"}
              </h3>
              <div className="small">
                Review inside this layover, then click <strong>Save Scenario</strong>. New scenarios save as inactive by default.
              </div>
            </div>
            <div className="content-actions content-actions-wrap">
              {editorMode === "edit" ? (
                <button type="button" onClick={() => downloadSingleScenarioCsv(getScenarioById(editorForm.id))}>
                  Download This Scenario
                </button>
              ) : null}
              <button type="button" onClick={closeEditor} disabled={editorSaving || generatingPreview}>
                Close
              </button>
            </div>
          </div>

          {editorError ? <p className="error">{editorError}</p> : null}

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Source & Creation Method</h3>
            <div className="tab-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={`tab-button ${editorForm.sourceMode === "scratch" ? "active" : ""}`}
                onClick={() => setSourceMode("scratch")}
                disabled={editorSaving || generatingPreview}
              >
                Start Custom Scenario From Scratch
              </button>
              <button
                type="button"
                className={`tab-button ${editorForm.sourceMode === "standard_base" ? "active" : ""}`}
                onClick={() => setSourceMode("standard_base")}
                disabled={editorSaving || generatingPreview}
              >
                Create Custom Scenario Using Standard Scenario As Base
              </button>
            </div>
            <div className="tab-row">
              <button
                type="button"
                className={`tab-button ${editorForm.creationMethod === "manual" ? "active" : ""}`}
                onClick={() => {
                  setEditorForm((prev) => ({ ...prev, creationMethod: "manual" }));
                  setGenerationPreview(null);
                }}
                disabled={editorSaving || generatingPreview}
              >
                Manual
              </button>
              <button
                type="button"
                className={`tab-button ${editorForm.creationMethod === "ai" ? "active" : ""}`}
                onClick={() => {
                  setEditorForm((prev) => ({ ...prev, creationMethod: "ai" }));
                  setGenerationPreview(null);
                }}
                disabled={editorSaving || generatingPreview}
              >
                Generate With AI
              </button>
            </div>
          </div>

          {editorForm.sourceMode === "standard_base" ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Select Standard Base Scenario</h3>
              <div className="content-grid content-grid-two">
                <div>
                  <label>Search Standard Scenarios</label>
                  <input
                    value={baseScenarioSearch}
                    onChange={(event) => setBaseScenarioSearch(event.target.value)}
                    placeholder="Search title, role, description, AI role"
                  />
                </div>
                <div>
                  <label>Base Scenario</label>
                  <select
                    value={editorForm.baseScenarioId}
                    onChange={(event) => handleBaseScenarioSelection(event.target.value)}
                    disabled={editorSaving || generatingPreview}
                  >
                    <option value="">Select a standard scenario</option>
                    {filteredBaseScenarioOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.segmentLabel} | {option.title} {option.enabled ? "" : "(inactive)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedBaseScenario ? (
                <p className="small content-pill" style={{ marginTop: 12 }}>
                  Selected base: <strong>{selectedBaseScenario.title}</strong> ({selectedBaseScenario.segmentLabel})
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Role & Applicable Industries</h3>
            <div className="content-grid content-grid-two">
              <div>
                <label>Role</label>
                <select
                  value={editorForm.segmentId}
                  onChange={(event) => {
                    setEditorForm((prev) => ({ ...prev, segmentId: event.target.value }));
                    setGenerationPreview(null);
                  }}
                  disabled={editorSaving || generatingPreview}
                >
                  <option value="">Select role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label} {role.enabled === false ? "(inactive role)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Status</label>
                {editorMode === "create" ? (
                  <div className="small" style={{ paddingTop: 10 }}>
                    Saves as <strong>inactive</strong> by default.
                  </div>
                ) : (
                  <select
                    value={editorForm.enabled ? "active" : "inactive"}
                    onChange={(event) =>
                      setEditorForm((prev) => ({ ...prev, enabled: event.target.value === "active" }))
                    }
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                )}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label>Applicable Industries (master list from Content tab)</label>
              <div
                style={{
                  border: "1px solid rgba(129, 206, 166, 0.22)",
                  borderRadius: 10,
                  padding: 10,
                  maxHeight: 180,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {industries.map((industry) => (
                  <label
                    key={industry.id}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 0, color: "inherit" }}
                  >
                    <input
                      type="checkbox"
                      checked={editorForm.applicableIndustryIds.includes(industry.id)}
                      onChange={() => toggleIndustrySelection(industry.id)}
                      disabled={editorSaving || generatingPreview}
                      style={{ width: 18, minHeight: 18, marginTop: 2 }}
                    />
                    <span>
                      {industry.label} {industry.enabled ? "" : "(inactive)"}
                      <span className="small" style={{ display: "block" }}>
                        {industry.id}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Scenario Content (Editable)</h3>
            <div className="content-grid content-grid-two">
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Scenario Title</label>
                <input
                  value={editorForm.title}
                  onChange={(event) => {
                    setEditorForm((prev) => ({ ...prev, title: event.target.value }));
                    setGenerationPreview(null);
                  }}
                  disabled={editorSaving}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Scenario Context / Description</label>
                <textarea
                  rows={5}
                  value={editorForm.description}
                  onChange={(event) => {
                    setEditorForm((prev) => ({ ...prev, description: event.target.value }));
                    setGenerationPreview(null);
                  }}
                  disabled={editorSaving}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>AI Role</label>
                <textarea
                  rows={4}
                  value={editorForm.aiRole}
                  onChange={(event) => {
                    setEditorForm((prev) => ({ ...prev, aiRole: event.target.value }));
                    setGenerationPreview(null);
                  }}
                  disabled={editorSaving}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <label style={{ marginBottom: 0 }}>Scoring Guidance</label>
                  <button
                    type="button"
                    disabled={editorSaving || generatingPreview}
                    onClick={() => {
                      setEditorForm((prev) => ({
                        ...prev,
                        scoringGuidance: buildDefaultScoringGuidance({
                          scenarioTitle: prev.title.trim() || selectedBaseScenario?.title || null,
                          segmentLabel: roleLabelById.get(prev.segmentId) ?? selectedBaseScenario?.segmentLabel ?? null,
                          industryContexts: toScoringIndustryContexts(industries, prev.applicableIndustryIds)
                        })
                      }));
                      setGenerationPreview(null);
                    }}
                  >
                    Apply Standard Scoring Template
                  </button>
                </div>
                <textarea
                  rows={12}
                  value={editorForm.scoringGuidance}
                  onChange={(event) => {
                    setEditorForm((prev) => ({ ...prev, scoringGuidance: event.target.value }));
                    setGenerationPreview(null);
                  }}
                  placeholder="What should be scored/extracted and what good performance sounds like."
                  disabled={editorSaving}
                />
              </div>
            </div>
          </div>

          {editorForm.creationMethod === "ai" ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="content-section-header content-header-actions">
                <h3 style={{ fontSize: "1rem", marginBottom: 0 }}>AI Customization Inputs</h3>
                <button type="button" onClick={() => setGenerationPreview(null)} disabled={generatingPreview}>
                  Clear Preview
                </button>
              </div>
              <div className="content-grid content-grid-two">
                <div>
                  <label>Company Name</label>
                  <input
                    value={editorForm.generationInputs.companyName}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, companyName: event.target.value },
                      }))
                    }
                  />
                </div>
                <div>
                  <label>Product / Service</label>
                  <input
                    value={editorForm.generationInputs.productOrService}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, productOrService: event.target.value },
                      }))
                    }
                  />
                </div>
                <div>
                  <label>Target Persona</label>
                  <input
                    value={editorForm.generationInputs.targetPersona}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, targetPersona: event.target.value },
                      }))
                    }
                  />
                </div>
                <div>
                  <label>Tone</label>
                  <input
                    value={editorForm.generationInputs.tone}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, tone: event.target.value },
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Key Objections (objections the AI role/persona should raise to challenge the user; one per line or
                    comma separated)
                  </label>
                  <textarea
                    rows={3}
                    value={editorForm.generationInputs.keyObjectionsText}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, keyObjectionsText: event.target.value },
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Must Include (what the AI role/scenario should include: required talking points, behaviors, product
                    details, or moments the user should encounter)
                  </label>
                  <textarea
                    rows={3}
                    value={editorForm.generationInputs.mustInclude}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, mustInclude: event.target.value },
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Must Avoid (what the AI role/scenario should avoid: claims, topics, wording, or behaviors the user
                    should not encounter)
                  </label>
                  <textarea
                    rows={3}
                    value={editorForm.generationInputs.mustAvoid}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, mustAvoid: event.target.value },
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Compliance Constraints (rules/limits for the AI role's wording and claims, e.g. no guarantees, no
                    medical/legal claims, required disclaimers)
                  </label>
                  <textarea
                    rows={3}
                    value={editorForm.generationInputs.complianceConstraints}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, complianceConstraints: event.target.value },
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Special Instructions (extra scenario goals, training focus, or output style guidance not covered
                    above)
                  </label>
                  <textarea
                    rows={3}
                    value={editorForm.generationInputs.specialInstructions}
                    onChange={(event) =>
                      setEditorForm((prev) => ({
                        ...prev,
                        generationInputs: { ...prev.generationInputs, specialInstructions: event.target.value },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="content-modal-actions" style={{ justifyContent: "space-between" }}>
                <div className="small">Generate a preview, review it, then apply before saving.</div>
                <button type="button" className="primary" onClick={() => void generatePreview()} disabled={generatingPreview}>
                  {generatingPreview ? "Generating..." : "Generate Preview"}
                </button>
              </div>
            </div>
          ) : null}

          {generationPreview ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="content-section-header content-header-actions">
                <h3 style={{ fontSize: "1rem", marginBottom: 0 }}>AI Preview</h3>
                <div className="small">
                  {generationPreview.model} | Tokens {generationPreview.usage.totalTokens}
                </div>
              </div>
              <div className="content-grid content-grid-two">
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Preview Title</label>
                  <textarea rows={2} readOnly value={generationPreview.generated.title} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Preview Scenario Context / Description</label>
                  <textarea rows={5} readOnly value={generationPreview.generated.description} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Preview AI Role</label>
                  <textarea rows={4} readOnly value={generationPreview.generated.aiRole} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Preview Scoring Guidance</label>
                  <textarea rows={4} readOnly value={generationPreview.generated.scoringGuidance} />
                </div>
              </div>
              <div className="content-modal-actions">
                <button type="button" className="primary" onClick={applyGenerationPreview}>
                  Apply Preview To Editor
                </button>
              </div>
            </div>
          ) : null}

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>Source / Provenance (Shown in Edit + CSV)</h3>
            <div className="grid">
              <div>
                <label>Source Mode</label>
                <div>{editorForm.sourceMode}</div>
              </div>
              <div>
                <label>Creation Method</label>
                <div>{editorForm.creationMethod}</div>
              </div>
              <div>
                <label>Base Scenario</label>
                <div>{editorForm.provenanceBaseScenarioTitle || "-"}</div>
                <div className="small">
                  {editorForm.baseScenarioId || "-"}
                  {editorForm.provenanceBaseScenarioSegmentId ? ` | ${editorForm.provenanceBaseScenarioSegmentId}` : ""}
                </div>
              </div>
              <div>
                <label>Created By</label>
                <div>{editorForm.createdBy || (editorMode === "create" ? "platform_admin (on save)" : "-")}</div>
              </div>
            </div>
          </div>

          <div className="content-modal-actions">
            <button type="button" onClick={closeEditor} disabled={editorSaving || generatingPreview}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void saveEditor()} disabled={editorSaving || generatingPreview}>
              {editorSaving ? "Saving..." : "Save Scenario"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="card content-section-card"
      style={
        editorOpen || Boolean(deleteTargetId)
          ? {
              position: "relative",
              zIndex: 1200,
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }
          : undefined
      }
    >
      <div className="content-section-header content-header-actions">
        <div>
          <h3 style={{ marginBottom: 6 }}>Custom Scenarios</h3>
          <div className="small">
            Account-specific scenarios only. {generatedAt ? `Refreshed ${formatDateTime(generatedAt)}` : ""}
          </div>
        </div>
        <div className="content-actions content-actions-wrap">
          {onToggleCollapse ? (
            <button type="button" onClick={onToggleCollapse}>
              {collapsed ? "Expand" : "Collapse"}
            </button>
          ) : null}
          <button type="button" onClick={downloadAllScenariosCsv} disabled={scenarios.length === 0}>
            Download CSV
          </button>
          <button type="button" onClick={() => void refreshScenarios()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="primary" onClick={openCreateEditor} disabled={!config}>
            Create Custom Scenario
          </button>
        </div>
      </div>
      {loading ? <p className="small">Loading custom scenarios...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      {collapsed ? (
        <p className="small">Custom scenarios are collapsed. Total: {scenarios.length}</p>
      ) : (
        <>
          <div className="content-grid content-grid-two">
            <div>
              <label>Search Custom Scenarios</label>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search title, description, AI role, scoring guidance"
              />
            </div>
            <div>
              <label>Filter By Role</label>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="">All Roles</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label} {role.enabled === false ? "(inactive role)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="content-table-wrap">
            <table className="content-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Role</th>
                  <th>Industries</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredScenarios.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="small">
                      {loading ? "Loading..." : "No custom scenarios found for this account."}
                    </td>
                  </tr>
                ) : (
                  filteredScenarios.map((scenario) => {
                    const busy = togglingScenarioId === scenario.id || (deleting && deleteTargetId === scenario.id);
                    return (
                      <tr key={scenario.id}>
                        <td className="content-long-cell">
                          <div>{scenario.title}</div>
                          <div className="small">{scenario.id}</div>
                        </td>
                        <td>
                          <div>{roleLabelById.get(scenario.segmentId) ?? scenario.segmentId}</div>
                          <div className="small">{scenario.segmentId}</div>
                        </td>
                        <td>
                          {(scenario.applicableIndustryIds ?? [])
                            .map((id) => industryById.get(id)?.label ?? id)
                            .join(", ") || "-"}
                        </td>
                        <td>
                          <select
                            value={scenario.enabled === true ? "active" : "inactive"}
                            disabled={busy}
                            onChange={(event) => void toggleScenarioStatus(scenario, event.target.value === "active")}
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        </td>
                        <td>{formatDateTime(scenario.updatedAt)}</td>
                        <td>
                          <div className="content-actions content-actions-wrap">
                            <button type="button" onClick={() => openEditEditor(scenario)} disabled={busy}>
                              Edit
                            </button>
                            <button type="button" onClick={() => downloadSingleScenarioCsv(scenario)} disabled={busy}>
                              Download
                            </button>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                setDeleteTargetId(scenario.id);
                                setDeleteStep(1);
                                setDeleteText("");
                                setError(null);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {renderEditorModal()}
          {renderDeleteModal()}
        </>
      )}
    </div>
  );
}
