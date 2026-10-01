/**
 * Permission catalogue. Keys are stable identifiers stored in role_permissions; labels live in the i18n files
 * under `permissions.<key>`. Adding a permission = add it here and to messages/*.json, then re-run the seed/sync.
 */
export const PERMISSION_GROUPS = {
  admin: ["admin.access", "settings.manage", "audit.view"],
  users: ["users.view", "users.manage", "users.invite", "roles.view", "roles.manage"],
  organization: ["cities.manage", "branches.manage", "displays.manage", "announcements.manage", "templates.manage"],
  services: ["reasons.view", "reasons.manage", "halls.manage", "distribution.manage", "distribution.simulate"],
  tickets: [
    "tickets.view",
    "tickets.issue",
    "tickets.issue_self",
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

/**
 * Permissions that only make sense for the whole organization (cities, organization settings, role definitions,
 * shared templates, integrations). The city-level "admin" role does not include them; the super admin does.
 */
export const ORGANIZATION_LEVEL_PERMISSIONS: Permission[] = [
  "cities.manage",
  "settings.manage",
  "roles.manage",
  "templates.manage",
  "apikeys.manage",
  "webhooks.manage",
];

export type SystemRoleKey = "super_admin" | "admin" | "receptionist" | "agent";

/** Built-in roles. They can be cloned into custom roles but never deleted. */
export const SYSTEM_ROLES: Record<SystemRoleKey, Permission[]> = {
  /** Controls every city and the organization itself. */
  super_admin: ALL_PERMISSIONS,
  /** Runs one city (or one branch): people, branches, screens, reports; not the organization-level settings. */
  admin: ALL_PERMISSIONS.filter((p) => !ORGANIZATION_LEVEL_PERMISSIONS.includes(p)),
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
  /** `tickets.issue_self`: issue a walk-in ticket from the agent screen when the branch allows it (D61). */
  agent: ["agent.serve", "tickets.view", "tickets.issue_self", "reasons.view"],
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

/**
 * A role grant. `branchId` null = the whole organization. A city grant is expanded into one grant per branch of the
 * city, each carrying the `cityId` it came from (a city with no branch yet yields a single grant on NO_BRANCH so
 * the city admin can still create the first one).
 */
export type Grant = { branchId: string | null; permissions: readonly string[]; cityId?: string | null };

/** Matches no branch; stands in for a city that has no branches yet. */
export const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

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

/** City ids the grants allow for a permission; `"all"` when an organization-wide grant exists. */
export function citiesFor(grants: readonly Grant[], permission: Permission): "all" | string[] {
  const ids = new Set<string>();
  for (const g of grants) {
    if (!g.permissions.includes(permission)) continue;
    if (g.branchId === null) return "all";
    if (g.cityId) ids.add(g.cityId);
  }
  return [...ids];
}

/** Can the holder use this permission across a whole city (organization-wide or a grant on that city)? */
export function canInCity(grants: readonly Grant[], permission: Permission, cityId: string): boolean {
  const cities = citiesFor(grants, permission);
  return cities === "all" || cities.includes(cityId);
}
