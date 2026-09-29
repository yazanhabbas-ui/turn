/** Client shapes of the queue API (see src/server/queue/views.ts). */
export type L = Record<string, string>;

export type TicketStatus =
  "APPOINTMENT_PENDING" | "WAITING" | "CALLED" | "SERVING" | "ON_HOLD" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export type Ticket = {
  id: string;
  displayNumber: string;
  status: TicketStatus;
  branchId: string;
  queueId: string;
  reasonId: string;
  priorityKey: string | null;
  language: string;
  assignedAgentId: string | null;
  servingAgentId: string | null;
  deskId: string | null;
  arrivedAt: string;
  queuedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  recallCount: number;
  notes: string | null;
  intake: Record<string, string>;
  publicToken: string;
  visitor: { name: string | null; phone: string | null; company: string | null; visitCount: number; returning: boolean } | null;
  appointmentId: string | null;
};

export type Position = { ahead: number; estimatedWaitMinutes: number };

export type QueueState = {
  now: string;
  serviceDay: string;
  waitingOrder: string[];
  positions: Record<string, Position>;
  tickets: Ticket[];
  agents: { id: string; status: string; maxConcurrent: number; handledToday: number; reasons: string[] }[];
};

export type IntakeField = { key: string; label?: L; type?: "text" | "phone" | "number" | "email"; required: boolean };

export type ReceptionReason = {
  id: string;
  code: string;
  name: L;
  icon: string;
  color: string;
  prefix: string;
  intakeFields: IntakeField[];
  defaultPriorityKey: string | null;
  isFeatured: boolean;
  shortcutKey: string | null;
  allowAppointments: boolean;
  expectedServiceMinutes: number;
  open: { open: true; closesInMinutes: number } | { open: false; reason: "closed" | "cutoff"; opensAt?: number };
  waiting: number;
  agentsAvailable: number;
};

export type ReceptionContext = {
  branch: { id: string; name: L; timezone: string };
  branches: { id: string; name: L }[];
  reasons: ReceptionReason[];
  priorities: { key: string; name: L; color: string; icon: string | null; isLane: boolean; weight: number }[];
  agents: { id: string; displayName: L; status: string; reasons: string[] }[];
  modes: Record<string, "pull" | "push" | "hybrid" | "manual">;
  privacy: { consentText: L; requireConsent: boolean };
  ticketing: { numberPad: number; separator: string; showQrOnTicket: boolean };
  visitorStatus: { enabled: boolean };
  regional: { digitsTicket: "latn" | "arab"; digitsScreen: "latn" | "arab" };
  print: { template: L | null; footer: L; companyName: L; logoUrl: string | null };
  canReassign: boolean;
  canCancel: boolean;
  canEdit: boolean;
  canCheckIn: boolean;
};

export type AgentWorkspace = {
  now: string;
  profile: {
    status: "AVAILABLE" | "BUSY" | "ON_BREAK" | "AWAY" | "OFFLINE";
    statusChangedAt: string;
    breakTypeId: string | null;
    currentDeskId: string | null;
    defaultDeskId: string | null;
    maxConcurrent: number;
    servedToday: number;
  };
  branch: { id: string; name: L; timezone: string };
  desks: { id: string; number: string; name: L }[];
  breakTypes: { id: string; name: L; maxMinutes: number | null }[];
  reasons: {
    id: string;
    name: L;
    color: string;
    icon: string;
    prefix: string;
    slaTargetWaitMinutes: number;
    intakeFields: IntakeField[];
    serves: boolean;
  }[];
  active: Ticket[];
  reserved: (Ticket & { position: Position | null })[];
  onHold: Ticket[];
  queues: { reasonId: string; waiting: number; oldestWaitMinutes: number; primary: boolean }[];
  agents: { id: string; displayName: L; status: string; reasons: string[] }[];
};
