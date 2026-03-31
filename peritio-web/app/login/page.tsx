import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/src/components/LoginForm";
import { assertDashboardAuthConfig, getWebAuthSession } from "@/src/lib/auth";
import { ensureAppHostRequest } from "@/src/lib/serverHostGuards";

export const metadata: Metadata = {
  title: "Login | Peritio - Dashboard",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  await ensureAppHostRequest("/login");
  assertDashboardAuthConfig();
  const params = await searchParams;
  const dashboardAccessMissing = params.reason === "no-dashboard-access";

  const authSession = await getWebAuthSession();
  if (authSession?.dashboardViewer) {
    redirect("/app/dashboard");
  }

  return (
    <main className="login-shell">
      <section className="login-grid">
        <div className="login-panel">
          <p className="eyebrow">Peritio</p>
          <h1>Dashboard access</h1>
          <p className="login-copy">
            Sign in with your email address and a one-time code. After a successful verification, this browser stays
            trusted for 14 days unless you sign out or your dashboard access changes.
          </p>
          {dashboardAccessMissing ? (
            <p className="form-error">
              You are signed in, but this account does not currently have dashboard access.
            </p>
          ) : null}
          <LoginForm />
        </div>

        <aside className="login-callout">
          <p className="eyebrow">Inside this shell</p>
          <h2>Customer insight scaffolding</h2>
          <ul className="bullet-list">
            <li>Super users can review customer accounts across the dashboard</li>
            <li>Customer users are limited to their own organization</li>
            <li>Company, user, and scenario reporting structure is already in place</li>
            <li>Settings space is ready for theme control and future preferences</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
