"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  EnterpriseOrg,
  INDUSTRY_LABELS,
  computeNextAnnualRenewalAt,
} from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function UsersPage() {
  useRequireAdminToken();
  const [orgs, setOrgs] = useState<EnterpriseOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [orgForm, setOrgForm] = useState<{ name: string; contactName: string; contactEmail: string }>({
    name: "",
    contactName: "",
    contactEmail: "",
  });

  const enterpriseOrgsSorted = useMemo(() => [...orgs].sort((a, b) => a.name.localeCompare(b.name)), [orgs]);

  const load = async () => {
    try {
      setError(null);
      const payload = await adminFetch<EnterpriseOrg[]>("/orgs");
      setOrgs(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load enterprise accounts.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreateEnterpriseOrg = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const name = orgForm.name.trim();
      if (!name) {
        throw new Error("Company name is required.");
      }

      await adminFetch<EnterpriseOrg>("/orgs", {
        method: "POST",
        body: JSON.stringify({
          name,
          contactName: orgForm.contactName,
          contactEmail: orgForm.contactEmail,
          activeIndustries: ["people_management"],
        }),
      });

      setOrgForm({ name: "", contactName: "", contactEmail: "" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create enterprise account.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AdminShell title="Accounts">
      <div className="card">
        <h3>Create Enterprise Account</h3>
        <form onSubmit={onCreateEnterpriseOrg} className="grid">
          <div>
            <label>Company Name</label>
            <input
              value={orgForm.name}
              onChange={(event) => setOrgForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </div>
          <div>
            <label>Company Contact</label>
            <input
              value={orgForm.contactName}
              onChange={(event) => setOrgForm((prev) => ({ ...prev, contactName: event.target.value }))}
            />
          </div>
          <div>
            <label>Contact Email</label>
            <input
              value={orgForm.contactEmail}
              onChange={(event) => setOrgForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
            />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="primary" disabled={creating}>
              {creating ? "Creating..." : "Create Enterprise Account"}
            </button>
          </div>
        </form>
        <p className="small" style={{ marginBottom: 0 }}>
          Default segment enabled: {INDUSTRY_LABELS.people_management}. Configure more on the account detail screen.
        </p>
        {error ? (
          <p className="error" style={{ marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h3 style={{ marginBottom: 0 }}>Enterprise Accounts ({orgs.length})</h3>
          <button onClick={() => void load()}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Company Name</th>
              <th>Date Established</th>
              <th>Next Renewal Date</th>
              <th>Company Contact</th>
              <th>Contact Email</th>
              <th>Segments Active</th>
            </tr>
          </thead>
          <tbody>
            {enterpriseOrgsSorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="small">
                  No enterprise accounts yet.
                </td>
              </tr>
            ) : (
              enterpriseOrgsSorted.map((org) => {
                const nextRenewalAt = computeNextAnnualRenewalAt(org.createdAt, new Date());
                const segmentsActive =
                  Array.isArray(org.activeIndustries) && org.activeIndustries.length > 0
                    ? org.activeIndustries.map((id) => INDUSTRY_LABELS[id]).join(", ")
                    : "-";

                return (
                  <tr key={org.id}>
                    <td>
                      <Link href={`/users/enterprise/${org.id}`} style={{ textDecoration: "underline" }}>
                        {org.name}
                      </Link>
                      <div className="small">{org.id}</div>
                    </td>
                    <td>{formatDate(org.createdAt)}</td>
                    <td>{formatDate(nextRenewalAt)}</td>
                    <td>{org.contactName}</td>
                    <td>{org.contactEmail}</td>
                    <td>{segmentsActive}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

