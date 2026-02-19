"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppConfig, UpdateConfigRequest } from "@voicepractice/shared";
import { AdminShell } from "../../src/components/AdminShell";
import { useRequireAdminToken } from "../../src/components/useRequireAdminToken";
import { adminFetch } from "../../src/lib/api";

interface ChangePasswordResponse {
  ok: boolean;
}

export default function ConfigPage() {
  useRequireAdminToken();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const configPayload = await adminFetch<AppConfig>("/config");
      setConfig(configPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load config.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveConfig = async () => {
    if (!config) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const patch: UpdateConfigRequest = {
        tiers: config.tiers,
      };

      const nextConfig = await adminFetch<AppConfig>("/config", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });

      setConfig(nextConfig);
      setSuccess("Config saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save config.");
    } finally {
      setSaving(false);
    }
  };

  const updateTierPrice = (tierId: string, price: number) => {
    setConfig((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        tiers: prev.tiers.map((tier) => (tier.id === tierId ? { ...tier, priceUsdMonthly: price } : tier)),
      };
    });
  };

  const updateTierDailyLimit = (tierId: string, value: number | null) => {
    setConfig((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        tiers: prev.tiers.map((tier) => (tier.id === tierId ? { ...tier, dailySecondsLimit: value } : tier)),
      };
    });
  };

  const onChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordStatus(null);

    try {
      await adminFetch<ChangePasswordResponse>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordStatus("Admin password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (caught) {
      setPasswordStatus(caught instanceof Error ? caught.message : "Password update failed.");
    }
  };

  if (!config) {
    return (
      <AdminShell title="Config">
        <div className="card">Loading config...</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Config">
      <div className="card">
        <h3>Tier Limits and Pricing</h3>
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Price (USD/mo)</th>
                <th>Daily Limit (minutes)</th>
              </tr>
            </thead>
            <tbody>
              {config.tiers.map((tier) => (
                <tr key={tier.id}>
                  <td>{tier.label}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={tier.priceUsdMonthly}
                      onChange={(event) => updateTierPrice(tier.id, Math.max(0, Number(event.target.value) || 0))}
                      disabled={tier.id === "enterprise"}
                    />
                  </td>
                  <td>
                    {tier.dailySecondsLimit === null ? (
                      <span className="small">Managed by enterprise org quota</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={Math.floor(tier.dailySecondsLimit / 60)}
                        onChange={(event) =>
                          updateTierDailyLimit(tier.id, Math.max(0, Number(event.target.value) || 0) * 60)
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button className="primary" onClick={() => void saveConfig()} disabled={saving}>
            {saving ? "Saving..." : "Save Config"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Admin Password</h3>
        <p className="small">Set the API-admin password used for admin login. Dev only in Phase 1.</p>
        <form onSubmit={onChangePassword}>
          <div className="grid">
            <div>
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div>
              <label>New Password</label>
              <input
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" type="submit">Change Password</button>
          </div>
        </form>
        {passwordStatus ? <p className="small">{passwordStatus}</p> : null}
      </div>
    </AdminShell>
  );
}
