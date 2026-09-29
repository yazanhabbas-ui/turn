/**
 * Permission catalogue. Keys are stable identifiers stored in role_permissions; labels live in the i18n files
 * under `permissions.<key>`. Adding a permission = add it here and to messages/*.json, then re-run the seed/sync.
 */
export const PERMISSION_GROUPS = {
  admin: ["admin.access", "settings.manage", "audit.view"],
  users: ["users.view", "users.manage", "users.invite", "roles.view", "roles.manage"],
  organization: ["branches.manage", "displays.manage", "announcements.manage", "templates.manage"],
  services: ["reasons.view", "reasons.manage", "distribution.manage", "distribution.simulate"],
  tickets: [
    "tickets.view",
    "tickets.issue",
    "tickets.edit",
    "tickets.cancel",
    "tickets.reprint",
    "tickets.reassign",
    "appointments.manage",
    "appointments.checkin",
  ],
  agent: ["agent.serve"],
  reports: ["reports.view", "reports.export", "reports.schedule", "wallboard.view", "alerts.view", "alerts.manage"],
  privacy: ["visitors.privacy"],
  integrations: ["apikeys.manage", "webhooks.manage"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat() as Permission[];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

export type SystemRoleKey = "admin" | "receptionist" | "agent";

/** Built-in roles. They can be cloned into custom roles but never deleted. */
export const SYSTEM_ROLES: Record<SystemRoleKey, Permission[]> = {
  admin: ALL_PERMISSIONS,
  receptionist: [
    "tickets.view",
    "tickets.issue",
    "tickets.edit",
    "tickets.cancel",
    "tickets.reprint",
    "appointments.checkin",
    "appointments.manage",
    "reasons.view",
  ],
  agent: ["agent.serve", "tickets.view", "reasons.view"],
};

/** Example custom role seeded for demos: reports + reassign tickets, but no settings. */
export const EXAMPLE_SUPERVISOR_PERMISSIONS: Permission[] = [
  "admin.access",
  "reports.view",
  "reports.export",
  "wallboard.view",
  "alerts.view",
  "alerts.manage",
  "tickets.view",
  "tickets.reassign",
  "reasons.view",
  "users.view",
];

/** A role grant, possibly scoped to one branch (null = all branches). */
export type Grant = { branchId: string | null; permissions: readonly string[] };

/** Pure permission check used by the server and (for UI hints only) by the client. */
export function can(grants: readonly Grant[], permission: Permission, branchId?: string | null): boolean {
  return grants.some(
    (g) => g.permissions.includes(permission) && (g.branchId === null || branchId == null || g.branchId === branchId),
  );
}

/** Branch ids the grants allow for a permission; `"all"` when an organization-wide grant exists. */
export function branchesFor(grants: readonly Grant[], permission: Permission): "all" | string[] {
  const ids = new Set<string>();
  for (const g of grants) {
    if (!g.permissions.includes(permission)) continue;
    if (g.branchId === null) return "all";
    ids.add(g.branchId);
  }
  return [...ids];
}
