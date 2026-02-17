"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiBaseUrl, setAdminToken } from "../../src/lib/api";

interface LoginResponse {
  token: string;
  expiresAt: string;
}

const LOGIN_TIMEOUT_MS = 10_000;

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
      const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = (await safeJson(response)) as Partial<LoginResponse> & { error?: string };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error ?? "Login failed.");
      }

      setAdminToken(payload.token);
      router.push("/users");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError("Login request timed out. Please retry.");
        return;
      }

      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <div className="shell" style={{ maxWidth: 500, paddingTop: 60 }}>
        <div className="card">
          <h2>Admin Login</h2>
          <p className="small">
            Development login is backed by API password auth. Use the bootstrap password from API env until changed.
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

async function safeJson(response: Response): Promise<{ error?: string; token?: string }>{
  try {
    return (await response.json()) as { error?: string; token?: string };
  } catch {
    return {};
  }
}
