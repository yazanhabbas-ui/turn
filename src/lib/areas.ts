import type { Permission } from "@/domain/rbac/permissions";

/** Top-level workspaces. A user sees the ones their roles allow. */
export const AREAS = [
  { key: "admin", href: "/admin", permission: "admin.access" },
  { key: "settings", href: "/settings", permission: "settings.manage" },
  { key: "reception", href: "/reception", permission: "tickets.issue" },
  { key: "agent", href: "/agent", permission: "agent.serve" },
  { key: "reports", href: "/reports", permission: "reports.view" },
  { key: "wallboard", href: "/wallboard", permission: "wallboard.view" },
] as const satisfies readonly { key: string; href: string; permission: Permission }[];

export type AreaKey = (typeof AREAS)[number]["key"];
