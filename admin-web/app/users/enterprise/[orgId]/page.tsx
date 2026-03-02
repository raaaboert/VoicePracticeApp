"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppConfig,
  ORG_USER_ROLE_LABELS,
  ORG_USER_ROLES,
  OrgUserRole,
  EnterpriseOrg,
  UserProfile,
  UserStatus,
  formatSecondsAsClock,
} from "@voicepractice/shared";
import { AdminShell } from "../../../../src/components/AdminShell";
import { EnterpriseCustomScenariosCard } from "../../../../src/components/EnterpriseCustomScenariosCard";
import { EnterpriseTrainingPacksCard } from "../../../../src/components/EnterpriseTrainingPacksCard";
import { useRequireAdminToken } from "../../../../src/components/useRequireAdminToken";
import { adminFetch } from "../../../../src/lib/api";
import { withAdminMode } from "../../../../src/lib/adminMode";

interface OrgDashboardUserRow {
  userId: string;
  email: string;
  status: UserStatus;
  orgRole: OrgUserRole;
  dailySecondsCapOverride: number | null;
  effectiveDailySecondsCap: number;
  allowDailyOverageThisCycle: boolean;
  dailyOverageExpiresAt: string | null;
  rawSecondsThisPeriod: number;
  billedSecondsThisPeriod: number;
}

interface OrgDashboardResponse {
  generatedAt: string;
  org: EnterpriseOrg;
  billingPeriod: {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
  };
  usage: {
    usedSecondsThisPeriod: number;
    allottedSecondsThisPeriod: number;
    remainingSecondsThisPeriod: number;
    usagePercentThisPeriod: number;
    activeUserCount: number;
    projectedAllocatedUserSecondsThisPeriod: number;
    projectedAllocatedUserMinutesThisPeriod: number;
    projectedAllocatedUtilizationPercent: number;
  };
  users: OrgDashboardUserRow[];
}

interface OrgJoinRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  email: string;
  emailDomain: string;
  user: {
    id: string;
    email: string;
    accountType: string;
    tier: string;
    status: string;
    orgId: string | null;
    orgRole: string | null;
  } | null;
  org: {
    id: string;
    name: string;
    emailDomain: string | null;
    joinCode: string;
    status: string;
  } | null;
}

interface OrgJoinRequestsResponse {
  generatedAt: string;
  rows: OrgJoinRequestRow[];
}

type EnterpriseCardKey = "company" | "accessRequests" | "trainingPacks" | "customScenarios" | "users";
type EnterpriseCardExpandedState = Record<EnterpriseCardKey, boolean>;

function buildDefaultEnterpriseCardExpandedState(hasJoinRequests: boolean): EnterpriseCardExpandedState {
  return {
    company: true,
    accessRequests: hasJoinRequests,
    trainingPacks: true,
    customScenarios: true,
    users: false
  };
}

function parseEnterpriseCardExpandedState(
  raw: string | null,
  fallback: EnterpriseCardExpandedState
): EnterpriseCardExpandedState {
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<EnterpriseCardExpandedState>;
    return {
      company: parsed.company !== undefined ? parsed.company === true : fallback.company,
      accessRequests: parsed.accessRequests !== undefined ? parsed.accessRequests === true : fallback.accessRequests,
      trainingPacks: parsed.trainingPacks !== undefined ? parsed.trainingPacks === true : fallback.trainingPacks,
      customScenarios: parsed.customScenarios !== undefined ? parsed.customScenarios === true : fallback.customScenarios,
      users: parsed.users !== undefined ? parsed.users === true : fallback.users
    };
  } catch {
    return fallback;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(value: string): string {
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

export default function EnterpriseOrgPage() {
  useRequireAdminToken();
  const mode = "enterprise";
  const params = useParams();
  const orgId = useMemo(() => {
    const raw = params?.orgId;
    return Array.isArray(raw) ? raw[0] : (raw as string | undefined) ?? "";
  }, [params]);

  const [dashboard, setDashboard] = useState<OrgDashboardResponse | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [industries, setIndustries] = useState<AppConfig["industries"]>([]);
  const [selectedIndustryId, setSelectedIndustryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingIndustries, setSavingIndustries] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [savingQuotaSettings, setSavingQuotaSettings] = useState(false);
  const [savingUserQuotaId, setSavingUserQuotaId] = useState<string | null>(null);
  const [savingUserOverageId, setSavingUserOverageId] = useState<string | null>(null);
  const [savingOrgIdentity, setSavingOrgIdentity] = useState(false);
  const [orgDomainInput, setOrgDomainInput] = useState("");
  const [orgJoinCodeInput, setOrgJoinCodeInput] = useState("");
  const [monthlyMinutesAllottedInput, setMonthlyMinutesAllottedInput] = useState("0");
  const [defaultPerUserDailyMinutesInput, setDefaultPerUserDailyMinutesInput] = useState("0");
  const [deferPerUserDailyCapUntilNextCycle, setDeferPerUserDailyCapUntilNextCycle] = useState(false);
  const [perUserDailyMinutesInputByUserId, setPerUserDailyMinutesInputByUserId] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<OrgJoinRequestRow[]>([]);
  const [joinRequestsGeneratedAt, setJoinRequestsGeneratedAt] = useState<string | null>(null);
  const [actingJoinRequestId, setActingJoinRequestId] = useState<string | null>(null);
  const [cardExpanded, setCardExpanded] = useState<EnterpriseCardExpandedState>(() =>
    buildDefaultEnterpriseCardExpandedState(false)
  );
  const hasStoredCardStateRef = useRef(false);
  const cardStateStorageKey = useMemo(
    () => `vp_admin_enterprise_org_card_expanded:${orgId}`,
    [orgId]
  );

  const load = async (options?: { preserveSuccessMessage?: boolean }) => {
    if (!orgId) {
      return;
    }

    setLoading(true);
    setError(null);
    if (!options?.preserveSuccessMessage) {
      setSuccessMessage(null);
    }
    try {
      const [payload, configPayload, joinRequestsPayload] = await Promise.all([
        adminFetch<OrgDashboardResponse>(`/orgs/${orgId}/dashboard`),
        adminFetch<AppConfig>("/config"),
        adminFetch<OrgJoinRequestsResponse>("/org-join-requests?status=pending"),
      ]);
      setDashboard(payload);
      setConfig(configPayload);
      setIndustries(configPayload.industries ?? []);
      setOrgDomainInput(payload.org.emailDomain ?? "");
      setOrgJoinCodeInput(payload.org.joinCode ?? "");
      setMonthlyMinutesAllottedInput(String(payload.org.monthlyMinutesAllotted ?? 0));
      setDefaultPerUserDailyMinutesInput(String(Math.max(0, Math.floor((payload.org.perUserDailySecondsCap ?? 0) / 60))));
      setDeferPerUserDailyCapUntilNextCycle(false);
      setPerUserDailyMinutesInputByUserId(
        Object.fromEntries(
          (payload.users ?? []).map((row) => [
            row.userId,
            String(Math.max(0, Math.floor((row.dailySecondsCapOverride ?? payload.org.perUserDailySecondsCap ?? 0) / 60)))
          ])
        )
      );
      setJoinRequestsGeneratedAt(joinRequestsPayload.generatedAt);
      const scopedPendingJoinRequests = (joinRequestsPayload.rows ?? []).filter(
        (row) => row.status === "pending" && row.org?.id === payload.org.id
      );
      setJoinRequests(scopedPendingJoinRequests);
      if (!hasStoredCardStateRef.current) {
        setCardExpanded((prev) => ({
          ...prev,
          accessRequests: scopedPendingJoinRequests.length > 0
        }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load enterprise account.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    hasStoredCardStateRef.current = false;
    const fallback = buildDefaultEnterpriseCardExpandedState(false);
    if (!orgId || typeof window === "undefined") {
      setCardExpanded(fallback);
      return;
    }

    const raw = window.localStorage.getItem(cardStateStorageKey);
    hasStoredCardStateRef.current = Boolean(raw);
    setCardExpanded(parseEnterpriseCardExpandedState(raw, fallback));
  }, [cardStateStorageKey, orgId]);

  useEffect(() => {
    if (!orgId || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(cardStateStorageKey, JSON.stringify(cardExpanded));
      hasStoredCardStateRef.current = true;
    } catch {
      // Ignore local storage failures and keep in-memory state only.
    }
  }, [cardExpanded, cardStateStorageKey, orgId]);

  const activeIndustries = dashboard?.org.activeIndustries ?? [];
  const selectedIndustryActive = activeIndustries.includes(selectedIndustryId);
  const industryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const industry of industries) {
      map.set(industry.id, industry.label);
    }
    return map;
  }, [industries]);

  const segmentsActiveLabel =
    activeIndustries.length > 0
      ? activeIndustries.map((id) => industryLabelById.get(id) ?? id).join(", ")
      : "-";
  const billingPeriodDays = useMemo(() => {
    if (!dashboard) {
      return 0;
    }
    const startMs = new Date(dashboard.billingPeriod.periodStartAt).getTime();
    const endMs = new Date(dashboard.billingPeriod.periodEndAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return 0;
    }
    return Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
  }, [dashboard]);
  const activeUserRows = useMemo(
    () => (dashboard?.users ?? []).filter((row) => row.status === "active"),
    [dashboard]
  );
  const projectedAllocatedActiveUserSecondsThisPeriod = useMemo(
    () =>
      activeUserRows.reduce((total, row) => total + Math.max(0, row.effectiveDailySecondsCap) * Math.max(1, billingPeriodDays), 0),
    [activeUserRows, billingPeriodDays]
  );

  const toggleCard = (key: EnterpriseCardKey) => {
    setCardExpanded((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  useEffect(() => {
    if (industries.length === 0) {
      setSelectedIndustryId("");
      return;
    }

    if (!industries.some((entry) => entry.id === selectedIndustryId)) {
      setSelectedIndustryId(industries[0].id);
    }
  }, [industries, selectedIndustryId]);

  const setIndustryActive = async (nextActive: boolean) => {
    if (!dashboard) {
      return;
    }
    if (!selectedIndustryId) {
      setError("Select an industry first.");
      return;
    }

    const org = dashboard.org;
    const current = Array.isArray(org.activeIndustries) ? org.activeIndustries : [];
    const isActive = current.includes(selectedIndustryId);
    if (nextActive === isActive) {
      return;
    }

    const nextIndustries = nextActive
      ? Array.from(new Set([...current, selectedIndustryId]))
      : current.filter((id) => id !== selectedIndustryId);

    if (nextIndustries.length === 0) {
      setError("At least one industry must remain active.");
      return;
    }

    setSavingIndustries(true);
    setError(null);
    try {
      const updatedOrg = await adminFetch<EnterpriseOrg>(`/orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activeIndustries: nextIndustries }),
      });

      setDashboard((prev) => (prev ? { ...prev, org: updatedOrg } : prev));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update segments.");
    } finally {
      setSavingIndustries(false);
    }
  };

  const patchEnterpriseUser = async (
    userId: string,
    patch: Partial<
      Pick<UserProfile, "orgRole" | "status" | "dailySecondsCapOverride" | "allowDailyOverageThisCycle">
    >,
  ) => {
    setSavingUserId(userId);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await adminFetch<UserProfile>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });

      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          users: prev.users.map((row) =>
            row.userId === userId
              ? {
                  ...row,
                  status: updated.status,
                  orgRole: updated.orgRole,
                  dailySecondsCapOverride: updated.dailySecondsCapOverride,
                  effectiveDailySecondsCap:
                    (updated.dailySecondsCapOverride ?? prev.org.perUserDailySecondsCap) + updated.manualBonusSeconds,
                  allowDailyOverageThisCycle: updated.allowDailyOverageThisCycle,
                  dailyOverageExpiresAt: updated.dailyOverageExpiresAt,
                }
              : row,
          ),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update user.");
    } finally {
      setSavingUserId(null);
    }
  };

  const saveOrgQuotaSettings = async () => {
    if (!dashboard) {
      return;
    }

    const monthlyMinutesAllotted = Math.max(0, Math.floor(Number(monthlyMinutesAllottedInput) || 0));
    const perUserDailySecondsCap = Math.max(0, Math.floor(Number(defaultPerUserDailyMinutesInput) || 0)) * 60;
    const applyModeLabel = deferPerUserDailyCapUntilNextCycle ? "next renewal cycle" : "immediately";
    const confirmed = window.confirm(
      `Save organization time allotment settings?\n\n` +
        `Monthly org allotment: ${monthlyMinutesAllotted.toLocaleString()} minutes\n` +
        `Default per-user daily allotment: ${Math.floor(perUserDailySecondsCap / 60)} minutes\n` +
        `Per-user daily change applies: ${applyModeLabel}\n\n` +
        `This can affect users immediately when applied now.`
    );
    if (!confirmed) {
      return;
    }

    setSavingQuotaSettings(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updatedOrg = await adminFetch<EnterpriseOrg>(`/orgs/${dashboard.org.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          monthlyMinutesAllotted,
          perUserDailySecondsCap,
          applyPerUserDailySecondsCapNextCycle: deferPerUserDailyCapUntilNextCycle,
        }),
      });
      setDashboard((prev) => (prev ? { ...prev, org: updatedOrg } : prev));
      setSuccessMessage("Organization allotment settings saved.");
      await load({ preserveSuccessMessage: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save organization allotment settings.");
    } finally {
      setSavingQuotaSettings(false);
    }
  };

  const saveUserDailyCapOverride = async (userId: string) => {
    const minutesRaw = perUserDailyMinutesInputByUserId[userId] ?? "";
    const minutes = Math.max(0, Math.floor(Number(minutesRaw) || 0));
    setSavingUserQuotaId(userId);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await adminFetch<UserProfile>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          dailySecondsCapOverride: minutes * 60,
        }),
      });
      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          users: prev.users.map((row) =>
            row.userId === userId
              ? {
                  ...row,
                  dailySecondsCapOverride: updated.dailySecondsCapOverride,
                  effectiveDailySecondsCap:
                    (updated.dailySecondsCapOverride ?? prev.org.perUserDailySecondsCap) + updated.manualBonusSeconds,
                  allowDailyOverageThisCycle: updated.allowDailyOverageThisCycle,
                  dailyOverageExpiresAt: updated.dailyOverageExpiresAt,
                }
              : row
          ),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save user allotment override.");
    } finally {
      setSavingUserQuotaId(null);
    }
  };

  const clearUserDailyCapOverride = async (userId: string) => {
    if (!dashboard) {
      return;
    }

    setSavingUserQuotaId(userId);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await adminFetch<UserProfile>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          dailySecondsCapOverride: null,
        }),
      });
      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          users: prev.users.map((row) =>
            row.userId === userId
              ? {
                  ...row,
                  dailySecondsCapOverride: updated.dailySecondsCapOverride,
                  effectiveDailySecondsCap:
                    (updated.dailySecondsCapOverride ?? prev.org.perUserDailySecondsCap) + updated.manualBonusSeconds,
                  allowDailyOverageThisCycle: updated.allowDailyOverageThisCycle,
                  dailyOverageExpiresAt: updated.dailyOverageExpiresAt,
                }
              : row
          ),
        };
      });
      setPerUserDailyMinutesInputByUserId((prev) => ({
        ...prev,
        [userId]: String(Math.max(0, Math.floor((dashboard.org.perUserDailySecondsCap ?? 0) / 60))),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear user allotment override.");
    } finally {
      setSavingUserQuotaId(null);
    }
  };

  const setUserDailyOverageAllowance = async (userId: string, allowDailyOverageThisCycle: boolean) => {
    setSavingUserOverageId(userId);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await adminFetch<UserProfile>(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          allowDailyOverageThisCycle,
        }),
      });
      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          users: prev.users.map((row) =>
            row.userId === userId
              ? {
                  ...row,
                  dailySecondsCapOverride: updated.dailySecondsCapOverride,
                  effectiveDailySecondsCap:
                    (updated.dailySecondsCapOverride ?? prev.org.perUserDailySecondsCap) + updated.manualBonusSeconds,
                  allowDailyOverageThisCycle: updated.allowDailyOverageThisCycle,
                  dailyOverageExpiresAt: updated.dailyOverageExpiresAt,
                }
              : row
          ),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update user overage allowance.");
    } finally {
      setSavingUserOverageId(null);
    }
  };

  const saveOrgIdentity = async () => {
    if (!dashboard) {
      return;
    }

    setSavingOrgIdentity(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await adminFetch<EnterpriseOrg>(`/orgs/${dashboard.org.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          emailDomain: orgDomainInput,
          joinCode: orgJoinCodeInput,
        }),
      });
      setDashboard((prev) => (prev ? { ...prev, org: updated } : prev));
      setOrgDomainInput(updated.emailDomain ?? "");
      setOrgJoinCodeInput(updated.joinCode ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update org identity.");
    } finally {
      setSavingOrgIdentity(false);
    }
  };

  const deleteEnterpriseUser = async (userId: string, email: string) => {
    const firstConfirm = window.confirm("Are you sure? This can not be reversed!");
    if (!firstConfirm) {
      return;
    }

    const typed = window.prompt("Please type DELETE and confirm", "");
    if (typed !== "DELETE") {
      setError("Deletion cancelled. Type DELETE exactly to confirm.");
      return;
    }

    setDeletingUserId(userId);
    setError(null);
    setSuccessMessage(null);
    try {
      await adminFetch<{ deleted: boolean; userId: string; email: string }>(`/users/${userId}`, {
        method: "DELETE",
      });
      setDashboard((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          users: prev.users.filter((row) => row.userId !== userId),
        };
      });
      setSuccessMessage(`Deleted ${email}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete user.");
    } finally {
      setDeletingUserId(null);
    }
  };

  const decideJoinRequest = async (
    requestId: string,
    action: "approve" | "reject",
    options?: { assignOrgAdmin?: boolean },
  ) => {
    const payload: {
      action: "approve" | "reject";
      assignOrgAdmin?: boolean;
      reason?: string;
    } = { action };

    if (action === "reject") {
      const reasonInput = window.prompt("Optional rejection reason (leave blank for default):", "");
      if (reasonInput === null) {
        return;
      }

      const normalizedReason = reasonInput.trim();
      if (normalizedReason) {
        payload.reason = normalizedReason;
      }
    }

    if (options?.assignOrgAdmin) {
      payload.assignOrgAdmin = true;
    }

    setActingJoinRequestId(requestId);
    setError(null);
    setSuccessMessage(null);
    try {
      await adminFetch<{ ok: boolean }>(`/org-join-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSuccessMessage(
        action === "approve"
          ? options?.assignOrgAdmin
            ? "Request approved as org admin."
            : "Request approved."
          : "Request rejected.",
      );
      await load({ preserveSuccessMessage: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update request.");
    } finally {
      setActingJoinRequestId(null);
    }
  };

  return (
    <AdminShell title={dashboard?.org.name ? `Enterprise: ${dashboard.org.name}` : "Enterprise Account"}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>{dashboard?.org.name ?? (loading ? "Loading..." : "Enterprise Account")}</h3>
            <div className="small">{dashboard?.org.id ?? ""}</div>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => toggleCard("company")}>
              {cardExpanded.company ? "Collapse" : "Expand"}
            </button>
            <Link className="button" href={withAdminMode("/users", mode)}>
              Back to Accounts
            </Link>
            <Link className="button" href={withAdminMode(`/users/enterprise/${orgId}/billing`, mode)}>
              Usage/Billing
            </Link>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {successMessage ? <p className="success">{successMessage}</p> : null}

        {cardExpanded.company ? (
          dashboard ? (
            <>
              <div className="grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Date Established</label>
                  <div>{formatDate(dashboard.org.createdAt)}</div>
                </div>
                <div>
                  <label>Next Renewal Date</label>
                  <div>{formatDate(dashboard.billingPeriod.nextRenewalAt)}</div>
                </div>
                <div>
                  <label>Company Contact</label>
                  <div>{dashboard.org.contactName}</div>
                </div>
                <div>
                  <label>Contact Email</label>
                  <div>{dashboard.org.contactEmail}</div>
                </div>
                <div>
                  <label>Email Domain</label>
                  <input value={orgDomainInput} onChange={(event) => setOrgDomainInput(event.target.value)} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="grid" style={{ marginTop: 4, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                    <div>
                      <label>Join Code</label>
                      <input value={orgJoinCodeInput} onChange={(event) => setOrgJoinCodeInput(event.target.value)} />
                    </div>
                    <div>
                      <label>Time Allotment (Billing Cycle)</label>
                      <p className="small" style={{ marginTop: 0 }}>
                        Hard enforcement uses monthly organization minutes. Active-user projection uses active users only.
                      </p>
                      <div className="grid" style={{ marginTop: 8 }}>
                        <div>
                          <label>Monthly Org Minutes</label>
                          <input
                            type="number"
                            min={0}
                            value={monthlyMinutesAllottedInput}
                            onChange={(event) => setMonthlyMinutesAllottedInput(event.target.value)}
                          />
                        </div>
                        <div>
                          <label>Default Per-User Daily Minutes</label>
                          <input
                            type="number"
                            min={0}
                            value={defaultPerUserDailyMinutesInput}
                            onChange={(event) => setDefaultPerUserDailyMinutesInput(event.target.value)}
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label
                            style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 0, cursor: "pointer" }}
                          >
                            <input
                              type="checkbox"
                              checked={deferPerUserDailyCapUntilNextCycle}
                              onChange={(event) => setDeferPerUserDailyCapUntilNextCycle(event.target.checked)}
                              style={{ width: 16, minHeight: 16, height: 16, padding: 0, margin: 0 }}
                            />
                            <span>Apply default per-user daily change at next renewal instead of immediately</span>
                          </label>
                          {dashboard.org.pendingPerUserDailySecondsCap !== null &&
                          dashboard.org.pendingPerUserDailySecondsCapEffectiveAt ? (
                            <div className="small" style={{ marginTop: 6 }}>
                              Pending next-cycle default:{" "}
                              {Math.floor(dashboard.org.pendingPerUserDailySecondsCap / 60)} min/day (effective{" "}
                              {formatDate(dashboard.org.pendingPerUserDailySecondsCapEffectiveAt)})
                            </div>
                          ) : null}
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div className="small">
                            Org usage this period: {formatSecondsAsClock(dashboard.usage.usedSecondsThisPeriod)} /{" "}
                            {formatSecondsAsClock(dashboard.usage.allottedSecondsThisPeriod)} (
                            {dashboard.usage.usagePercentThisPeriod.toFixed(1)}%)
                          </div>
                          <div className="small">
                            Active users: {activeUserRows.length} | Projected allocation at current daily caps:{" "}
                            {Math.round(projectedAllocatedActiveUserSecondsThisPeriod / 60).toLocaleString()} minutes over{" "}
                            {billingPeriodDays} day(s)
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Segments Active</label>
                  <div>{segmentsActiveLabel}</div>
                  <div className="small">
                    Billing period: {formatDate(dashboard.billingPeriod.periodStartAt)} to{" "}
                    {formatDate(dashboard.billingPeriod.periodEndAt)}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Segment Selection</label>
                  <p className="small" style={{ marginTop: 0 }}>
                    Select an industry and toggle whether it is active for this company.
                  </p>
                  <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 260, flex: "1 1 260px" }}>
                      <label>Industry</label>
                      <select
                        value={selectedIndustryId}
                        onChange={(event) => setSelectedIndustryId(event.target.value)}
                      >
                        {industries.map((industry) => (
                          <option key={industry.id} value={industry.id}>
                            {industry.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className={selectedIndustryActive ? "primary" : undefined}
                        disabled={savingIndustries || !selectedIndustryId}
                        onClick={() => void setIndustryActive(true)}
                      >
                        Active
                      </button>
                      <button
                        type="button"
                        className={!selectedIndustryActive ? "primary" : undefined}
                        disabled={savingIndustries || !selectedIndustryId}
                        onClick={() => void setIndustryActive(false)}
                      >
                        Inactive
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button className="primary" disabled={savingOrgIdentity} onClick={() => void saveOrgIdentity()}>
                  {savingOrgIdentity ? "Saving..." : "Save Domain / Join Code"}
                </button>
                <button className="primary" disabled={savingQuotaSettings} onClick={() => void saveOrgQuotaSettings()}>
                  {savingQuotaSettings ? "Saving..." : "Save Time Allotment Settings"}
                </button>
              </div>
            </>
          ) : (
            <p className="small">{loading ? "Loading company details..." : "Company details are not available."}</p>
          )
        ) : (
          <p className="small">Company details are collapsed.</p>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Org Access Requests</h3>
            <div className="small">
              Pending requests for this account: {joinRequests.length}
              {joinRequestsGeneratedAt ? ` | Refreshed ${formatDateTime(joinRequestsGeneratedAt)}` : ""}
            </div>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => toggleCard("accessRequests")}>
              {cardExpanded.accessRequests ? "Collapse" : "Expand"}
            </button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        {cardExpanded.accessRequests ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email Domain</th>
                  <th>Submitted</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {joinRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="small">
                      {loading ? "Loading..." : "No pending requests for this enterprise account."}
                    </td>
                  </tr>
                ) : (
                  joinRequests.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div>{row.email}</div>
                        <div className="small">{row.user?.id ?? row.id}</div>
                      </td>
                      <td>{row.emailDomain}</td>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{formatDateTime(row.expiresAt)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="primary"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row.id, "approve")}
                          >
                            {actingJoinRequestId === row.id ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row.id, "approve", { assignOrgAdmin: true })}
                          >
                            Approve as Org Admin
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={actingJoinRequestId === row.id}
                            onClick={() => void decideJoinRequest(row.id, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small">Org access requests are collapsed.</p>
        )}
      </div>

      <EnterpriseTrainingPacksCard
        orgId={orgId}
        orgName={dashboard?.org.name}
        config={config}
        collapsed={!cardExpanded.trainingPacks}
        onToggleCollapse={() => toggleCard("trainingPacks")}
      />

      <EnterpriseCustomScenariosCard
        orgId={orgId}
        orgName={dashboard?.org.name}
        config={config}
        collapsed={!cardExpanded.customScenarios}
        onToggleCollapse={() => toggleCard("customScenarios")}
      />

      <div className="card">
        <div className="card-header">
          <div>
            <h3 style={{ marginBottom: 6 }}>Users</h3>
            <p className="small" style={{ marginTop: 0 }}>
              Usage shown is billed time within the current monthly billing period.
            </p>
            <p className="small" style={{ marginTop: 0 }}>
              Active users: {activeUserRows.length} | Projected allocation:{" "}
              {Math.round(projectedAllocatedActiveUserSecondsThisPeriod / 60).toLocaleString()} minutes this cycle.
            </p>
          </div>
          <div className="card-actions">
            <button type="button" onClick={() => toggleCard("users")}>
              {cardExpanded.users ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        {cardExpanded.users ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Locked Out</th>
                  <th>Daily Allotment</th>
                  <th>Daily Overage</th>
                  <th>Usage This Billing Period</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.users ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="small">
                      {loading ? "Loading..." : "No users found for this enterprise account."}
                    </td>
                  </tr>
                ) : (
                  (dashboard?.users ?? []).map((user) => (
                    <tr key={user.userId}>
                      <td>
                        <div>{user.email}</div>
                        <div className="small">{user.userId}</div>
                      </td>
                      <td>
                        <select
                          value={user.orgRole}
                          disabled={savingUserId === user.userId || deletingUserId === user.userId}
                          onChange={(event) => {
                            void patchEnterpriseUser(user.userId, { orgRole: event.target.value as OrgUserRole });
                          }}
                        >
                          {ORG_USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ORG_USER_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={user.status}
                          disabled={savingUserId === user.userId || deletingUserId === user.userId}
                          onChange={(event) => {
                            void patchEnterpriseUser(user.userId, { status: event.target.value as UserStatus });
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="disabled">Locked</option>
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <input
                            type="number"
                            min={0}
                            value={perUserDailyMinutesInputByUserId[user.userId] ?? ""}
                            disabled={
                              savingUserQuotaId === user.userId ||
                              savingUserId === user.userId ||
                              deletingUserId === user.userId
                            }
                            onChange={(event) =>
                              setPerUserDailyMinutesInputByUserId((prev) => ({
                                ...prev,
                                [user.userId]: event.target.value,
                              }))
                            }
                          />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              disabled={
                                savingUserQuotaId === user.userId ||
                                savingUserId === user.userId ||
                                deletingUserId === user.userId
                              }
                              onClick={() => void saveUserDailyCapOverride(user.userId)}
                            >
                              {savingUserQuotaId === user.userId ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                savingUserQuotaId === user.userId ||
                                savingUserId === user.userId ||
                                deletingUserId === user.userId
                              }
                              onClick={() => void clearUserDailyCapOverride(user.userId)}
                            >
                              Use Org Default
                            </button>
                          </div>
                          <div className="small">
                            Effective: {formatSecondsAsClock(user.effectiveDailySecondsCap)}
                          </div>
                        </div>
                      </td>
                      <td>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={user.allowDailyOverageThisCycle === true}
                            disabled={
                              savingUserOverageId === user.userId ||
                              savingUserId === user.userId ||
                              deletingUserId === user.userId
                            }
                            onChange={(event) =>
                              void setUserDailyOverageAllowance(user.userId, event.target.checked)
                            }
                          />
                          Allow
                        </label>
                        {user.allowDailyOverageThisCycle && user.dailyOverageExpiresAt ? (
                          <div className="small" style={{ marginTop: 4 }}>
                            Expires {formatDate(user.dailyOverageExpiresAt)}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatSecondsAsClock(user.billedSecondsThisPeriod)}</td>
                      <td>
                        <button
                          type="button"
                          className="danger"
                          disabled={savingUserId === user.userId || deletingUserId === user.userId}
                          onClick={() => void deleteEnterpriseUser(user.userId, user.email)}
                        >
                          {deletingUserId === user.userId ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small">Users are collapsed.</p>
        )}
      </div>
    </AdminShell>
  );
}
