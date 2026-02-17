"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, getApiBaseUrl, setAdminToken } from "../../src/lib/api";

interface LoginResponse {
  token: string;
  expiresAt: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiBase] = useState(() => getApiBaseUrl());

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

  const apiBaseLooksMisconfigured =
    typeof window !== "undefined"
    && window.location.hostname !== "localhost"
    && window.location.hostname !== "127.0.0.1"
    && apiBase.includes("localhost");

  return (
    <main>
      <div className="shell" style={{ maxWidth: 500, paddingTop: 60 }}>
        <div className="card">
          <h2>Admin Login</h2>
          <p className="small">
            Development login is backed by API password auth. Use the bootstrap password from API env until changed.
          </p>
          {apiBaseLooksMisconfigured ? (
            <p className="error">
              Admin API base URL is set to localhost. Set `NEXT_PUBLIC_API_BASE_URL` in Vercel and redeploy.
            </p>
          ) : null}
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
