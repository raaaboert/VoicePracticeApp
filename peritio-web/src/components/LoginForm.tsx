"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginStep = "request_code" | "verify_code";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>("request_code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async () => {
    const response = await fetch("/api/auth/request-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Could not send sign-in code.");
    }

    const payload = (await response.json()) as {
      status: "acknowledged" | "code_sent";
      message: string;
    };
    if (payload.status === "code_sent") {
      setStep("verify_code");
      setNotice(
        `${payload.message} Enter the 6-digit code below to continue.`
      );
      return;
    }

    setStep("request_code");
    setNotice(payload.message);
  };

  const verifyCode = async () => {
    const response = await fetch("/api/auth/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, code }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Could not verify code.");
    }

    router.replace("/app/dashboard");
    router.refresh();
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (step === "request_code") {
        await requestCode();
      } else {
        await verifyCode();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label className="field-label" htmlFor="dashboard-email">
        Email
      </label>
      <input
        id="dashboard-email"
        className="text-input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@company.com"
        autoComplete="username"
        required
        disabled={loading || step === "verify_code"}
      />

      {step === "verify_code" ? (
        <>
          <label className="field-label" htmlFor="dashboard-code">
            One-time code
          </label>
          <input
            id="dashboard-code"
            className="text-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D+/g, "").slice(0, 6))}
            placeholder="123456"
            autoComplete="one-time-code"
            required
          />
        </>
      ) : null}

      {notice ? <p className="small" style={{ margin: 0 }}>{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <button type="submit" className="primary-button" disabled={loading}>
        {loading
          ? step === "request_code"
            ? "Sending code..."
            : "Verifying..."
          : step === "request_code"
            ? "Send sign-in code"
            : "Verify and continue"}
      </button>

      {step === "verify_code" ? (
        <button
          type="button"
          className="ghost-button"
          disabled={loading}
          onClick={() => {
            setStep("request_code");
            setCode("");
            setError(null);
          }}
        >
          Change email
        </button>
      ) : null}
    </form>
  );
}
