export function isDashboardSidebarItemActive(
  pathname: string,
  href: string,
  performanceOrigin: string | null,
): boolean {
  if (href === "/app") return pathname === href;
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return href === "/app/performance"
    && /^\/app\/users\/[^/]+$/.test(pathname)
    && performanceOrigin === "individuals";
}
