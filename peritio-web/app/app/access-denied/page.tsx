import Link from "next/link";

import { PageHeader } from "@/src/components/PageHeader";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason = params.reason === "no-dashboard-access" ? "no-dashboard-access" : "customer-scope";
  const isDashboardAccessIssue = reason === "no-dashboard-access";

  return (
    <>
      <PageHeader
        eyebrow="Access denied"
        title={
          isDashboardAccessIssue
            ? "Dashboard access is not enabled for this account"
            : "You do not have access to that customer account"
        }
        description={
          isDashboardAccessIssue
            ? "You are signed in, but the current user record does not currently authorize dashboard access."
            : "The dashboard blocked this request server-side because the requested account is outside your allowed scope."
        }
      />

      <section className="section-card">
        <p className="section-copy">
          {isDashboardAccessIssue
            ? "If you expected dashboard access here, enable it on the user record in the existing admin system and try again."
            : "If you expected access here, update the user record in the existing admin system before trying again."}
        </p>
        <div className="pill-row">
          {isDashboardAccessIssue ? (
            <Link className="primary-button" href="/login">
              Back to login
            </Link>
          ) : (
            <>
              <Link className="primary-button" href="/app/customers">
                Return to customers
              </Link>
              <Link className="ghost-button" href="/app/dashboard">
                Back to dashboard
              </Link>
            </>
          )}
        </div>
      </section>
    </>
  );
}
