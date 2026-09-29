/** Client-side shapes of admin API responses (dates arrive as ISO strings). */
export type L = Record<string, string>;

export type Grant = { roleId: string; branchId: string | null };
export type AgentProfile = { branchId: string; defaultDeskId?: string | null; maxConcurrent: number; weight: number };

export type UserRow = {
  id: string;
  email: string;
  displayName: L;
  phone: string | null;
  locale: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  grants: Grant[];
  agent: AgentProfile | null;
  groupIds: string[];
};

export type RoleRow = {
  id: string;
  key: string;
  name: L;
  description: L | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
};

export type Desk = {
  id: string;
  branchId: string;
  number: string;
  name: L;
  floorId: string | null;
  zone: string | null;
  sortOrder: number;
};
export type Floor = { id: string; branchId: string; name: L; sortOrder: number };
export type Branch = {
  id: string;
  code: string;
  name: L;
  address: L | null;
  timezone: string;
  weekend: number[];
  latitude: string | null;
  longitude: string | null;
  isDefault: boolean;
  floors: Floor[];
  desks: Desk[];
};

export type Group = { id: string; name: L; branchId: string | null; supervisorUserId: string | null; memberIds: string[] };
export type AgentRef = { id: string; displayName: L; email: string; branchId: string };
export type Priority = {
  id: string;
  key: string;
  name: L;
  weight: number;
  isLane: boolean;
  color: string;
  icon: string | null;
  sortOrder: number;
};
export type BreakType = { id: string; name: L; maxMinutes: number | null; countsAsProductive: boolean; sortOrder: number };

export type IntakeField = { key: string; label?: L; type?: "text" | "phone" | "number" | "email"; required: boolean };
export type Assignment = {
  userId?: string | null;
  groupId?: string | null;
  branchId?: string | null;
  proficiency: number;
  isPrimary: boolean;
};
export type Reason = {
  id: string;
  code: string;
  name: L;
  description: L | null;
  icon: string;
  color: string;
  prefix: string;
  defaultPriorityKey: string | null;
  expectedServiceMinutes: number;
  slaTargetWaitMinutes: number;
  intakeFields: IntakeField[];
  allowAppointments: boolean;
  scheduleId: string | null;
  cutoffMinutes: number;
  isFeatured: boolean;
  shortcutKey: string | null;
  sortOrder: number;
  archivedAt: string | null;
  assignments: Assignment[];
};

export type ScheduleRule = {
  kind: "regular" | "ramadan" | "special";
  weekday: number;
  opensAt: string;
  closesAt: string;
  validFrom?: string | null;
  validTo?: string | null;
};
export type Schedule = { id: string; name: L; rules: ScheduleRule[] };
export type PauseWindow = {
  id: string;
  branchId: string;
  kind: "prayer" | "custom";
  name: L;
  mode: "manual" | "auto";
  prayer: string | null;
  startsAt: string | null;
  endsAt: string | null;
  offsetMinutes: number;
  durationMinutes: number;
  weekdays: number[];
  season: "always" | "ramadan" | "regular";
  message: L | null;
  isActive: boolean;
};
export type Holiday = { id: string; branchId: string | null; name: L; dateFrom: string; dateTo: string };

export type Lookups = {
  branches: Branch[];
  roles: RoleRow[];
  agents: AgentRef[];
  groups: Group[];
  priorities: Priority[];
  breakTypes: BreakType[];
};
