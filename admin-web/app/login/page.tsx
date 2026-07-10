"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEnvironmentStatus } from "../../src/components/AdminEnvironmentStatus";
import { adminFetch, setAdminToken } from "../../src/lib/api";

interface LoginResponse {
  token: string;
  expiresAt: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = await adminFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });

      setAdminToken(payload.token);
      router.push("/users");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <div className="shell" style={{ maxWidth: 500, paddingTop: 60 }}>
        <div className="card">
          <h2>Peritio - Web Admin</h2>
          <AdminEnvironmentStatus compact />
          <p className="small">
            Sign in with the admin password configured on the target API.
          </p>
          <form onSubmit={onSubmit}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error ? <p className="error">{error}</p> : null}
            <button className="primary" style={{ marginTop: 10 }} disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
