import Link from "next/link";

import { trainingContentOrgQuery } from "@/src/lib/trainingContentPresentation";

type AdminSection = "admin" | "focus-topics" | "training-content" | "focus-topic-order";

const ADMIN_SECTIONS: ReadonlyArray<{
  key: AdminSection;
  label: string;
  path: string;
}> = [
  { key: "admin", label: "Users & Access", path: "/app/admin" },
  { key: "focus-topics", label: "Focus Topics", path: "/app/admin/focus-topics" },
  { key: "training-content", label: "Learning Resources", path: "/app/admin/training-content" },
  { key: "focus-topic-order", label: "Focus Topic Order", path: "/app/admin/content-organization" },
];

export function TrainingContentAdminNav({
  orgId,
  active,
}: {
  orgId: string | null;
  active: AdminSection;
}) {
  const query = trainingContentOrgQuery(orgId);
  return (
    <nav className="tab-row" aria-label="Admin sections">
      {ADMIN_SECTIONS.map((section) => (
        <Link
          key={section.key}
          className={`tab-button${active === section.key ? " active" : ""}`}
          href={`${section.path}${query}`}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
