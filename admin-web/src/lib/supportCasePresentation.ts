export function getSupportCaseSourceLabel(source: string | null | undefined): string | null {
  return source === "organization_plan" ? "Organization Plan" : null;
}
