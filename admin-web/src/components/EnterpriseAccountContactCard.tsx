"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createOrganizationContactDraft,
  validateOrganizationContact,
  type OrganizationContactUpdatePayload,
  type OrganizationContactValues,
} from "./enterpriseAccountContact";

interface EnterpriseAccountContactCardProps {
  contactName: string;
  contactEmail: string;
  onSave: (payload: OrganizationContactUpdatePayload) => Promise<OrganizationContactValues>;
}

export function EnterpriseAccountContactCard({
  contactName,
  contactEmail,
  onSave,
}: EnterpriseAccountContactCardProps) {
  const persisted = useMemo(
    () => createOrganizationContactDraft({ contactName, contactEmail }),
    [contactEmail, contactName],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OrganizationContactValues>(persisted);
  const [displayed, setDisplayed] = useState<OrganizationContactValues>(persisted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDisplayed(persisted);
    setDraft(persisted);
  }, [persisted]);

  const beginEditing = () => {
    setDraft(persisted);
    setError(null);
    setNotice(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(persisted);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (saving) {
      return;
    }

    const result = validateOrganizationContact(draft);
    if ("error" in result) {
      setError(result.error);
      setNotice(null);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await onSave(result.payload);
      const nextDisplayed = createOrganizationContactDraft(saved);
      setDraft(nextDisplayed);
      setDisplayed(nextDisplayed);
      setEditing(false);
      setNotice("Contact information saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save contact information.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="enterprise-subsection">
      <div className="card-header">
        <div>
          <h4 style={{ marginBottom: 6 }}>Account Contact</h4>
          <p className="small">The primary contact for this enterprise account.</p>
        </div>
        {!editing ? (
          <button type="button" onClick={beginEditing} disabled={saving}>
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="enterprise-detail-grid">
          <div className="enterprise-detail-item">
            <label htmlFor="enterprise-contact-name">Contact Name</label>
            <input
              id="enterprise-contact-name"
              value={draft.contactName}
              onChange={(event) => setDraft((previous) => ({ ...previous, contactName: event.target.value }))}
              disabled={saving}
              autoComplete="name"
            />
          </div>
          <div className="enterprise-detail-item">
            <label htmlFor="enterprise-contact-email">Contact Email</label>
            <input
              id="enterprise-contact-email"
              type="email"
              value={draft.contactEmail}
              onChange={(event) => setDraft((previous) => ({ ...previous, contactEmail: event.target.value }))}
              disabled={saving}
              autoComplete="email"
            />
          </div>
          <div className="form-actions">
            <button type="button" onClick={cancelEditing} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="enterprise-detail-grid">
          <div className="enterprise-detail-item">
            <label>Contact Name</label>
            <div className="enterprise-detail-value">{displayed.contactName || "-"}</div>
          </div>
          <div className="enterprise-detail-item">
            <label>Contact Email</label>
            <div className="enterprise-detail-value break-word">{displayed.contactEmail || "-"}</div>
          </div>
        </div>
      )}

      {error ? <p className="small error-text" role="alert">{error}</p> : null}
      {notice ? <p className="small" role="status">{notice}</p> : null}
    </div>
  );
}
