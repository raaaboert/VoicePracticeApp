import Link from "next/link";

import { trainingContentOrgQuery } from "@/src/lib/trainingContentPresentation";

export function TrainingContentAdminNav({
  orgId,
  active,
  showFocusTopics = false,
}: {
  orgId: string | null;
  active: "admin" | "training-content" | "content-organization" | "focus-topics";
  showFocusTopics?: boolean;
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
        className={`tab-button${active === "content-organization" ? " active" : ""}`}
        href={`/app/admin/content-organization${query}`}
      >
        Content Organization
      </Link>
      {showFocusTopics ? <Link
        className={`tab-button${active === "focus-topics" ? " active" : ""}`}
        href={`/app/admin/focus-topics${query}`}
      >
        Focus Topics
      </Link> : null}
      <Link
        className={`tab-button${active === "training-content" ? " active" : ""}`}
        href={`/app/admin/training-content${query}`}
      >
        Learning Resources
      </Link>
    </nav>
  );
}
