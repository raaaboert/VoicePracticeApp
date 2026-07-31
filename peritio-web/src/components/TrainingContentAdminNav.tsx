import Link from "next/link";

import { trainingContentOrgQuery } from "@/src/lib/trainingContentPresentation";

export function TrainingContentAdminNav({
  orgId,
  active,
}: {
  orgId: string | null;
  active: "admin" | "training-content";
}) {
  const query = trainingContentOrgQuery(orgId);
  return (
    <nav className="tab-row" aria-label="Admin sections">
      <Link
        className={`tab-button${active === "admin" ? " active" : ""}`}
        href={`/app/admin${query}`}
      >
        Users &amp; Access
      </Link>
      <Link
        className={`tab-button${active === "training-content" ? " active" : ""}`}
        href={`/app/admin/training-content${query}`}
      >
        Training Content
      </Link>
    </nav>
  );
}
