/** Client-side shapes of admin API responses (dates arrive as ISO strings). */
export type L = Record<string, string>;

export type Grant = { roleId: string; branchId: string | null; cityId?: string | null };
export type City = {
  id: string;
  organizationId?: string;
  code: string;
  name: L;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  branchCount: number;
};
export type Shift = {
  id: string;
  code: string;
  name: L;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  /** Null = an organization-wide shift; set = only that city's agents may use it. */
  cityId?: string | null;
};
export type AgentProfile = {
  branchId: string;
  defaultDeskId?: string | null;
  maxConcurrent: number | null;
  weight: number;
  shiftId?: string | null;
};

export type UserRow = {
  id: string;
  email: string;
  displayName: L;
  phone: string | null;
  locale: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  avatarVersion?: number | null;
  lastLoginAt: string | null;
  anonymizedAt?: string | null;
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
  cityId: string;
  code: string;
  name: L;
  address: L | null;
  timezone: string;
  weekend: number[];
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

export type IntakeField = {
  key: string;
  label?: L;
  type?: "text" | "phone" | "number" | "email";
  required: boolean;
  /** May a visitor enter it at a self check-in kiosk? Unset = the built-in default. */
  selfService?: boolean;
};
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
  requiresStaff: boolean;
  isFeatured: boolean;
  shortcutKey: string | null;
  sortOrder: number;
  archivedAt: string | null;
  assignments: Assignment[];
};

export type Lookups = {
  /** True for organization-wide administrators (they may grant roles for the whole organization). */
  organizationScope: boolean;
  cities: City[];
  branches: Branch[];
  roles: RoleRow[];
  agents: AgentRef[];
  groups: Group[];
  priorities: Priority[];
  breakTypes: BreakType[];
  shifts: Shift[];
};
