import {
  Building2,
  FlaskConical,
  Route,
  KeyRound,
  LayoutDashboard,
  MapPinned,
  ListChecks,
  Monitor,
  ShieldCheck,
  UsersRound,
  UserRoundCog,
} from "lucide-react";

/** Admin navigation. Each item is shown only when the user holds its permission. */
export const ADMIN_NAV_ITEMS = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard, permission: "admin.access" },
  { href: "/admin/users", key: "users", icon: UserRoundCog, permission: "users.view" },
  { href: "/admin/roles", key: "roles", icon: KeyRound, permission: "roles.view" },
  { href: "/admin/cities", key: "cities", icon: MapPinned, permission: "cities.manage" },
  { href: "/admin/branches", key: "branches", icon: Building2, permission: "admin.access" },
  { href: "/admin/reasons", key: "reasons", icon: ListChecks, permission: "reasons.view" },
  { href: "/admin/groups", key: "groups", icon: UsersRound, permission: "reasons.view" },
  { href: "/admin/distribution", key: "distribution", icon: Route, permission: "distribution.manage" },
  { href: "/admin/simulate", key: "simulate", icon: FlaskConical, permission: "distribution.simulate" },
  { href: "/admin/screens", key: "screens", icon: Monitor, permission: "displays.manage" },
  { href: "/admin/privacy", key: "privacy", icon: ShieldCheck, permission: "visitors.privacy" },
] as const;
