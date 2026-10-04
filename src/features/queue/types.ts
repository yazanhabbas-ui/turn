import type { WaitDisplay } from "./wait-text";

/** Client shapes of the queue API (see src/server/queue/views.ts). */
export type L = Record<string, string>;

export type TicketStatus =
  "APPOINTMENT_PENDING" | "WAITING" | "CALLED" | "SERVING" | "ON_HOLD" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export type Ticket = {
  id: string;
  displayNumber: string;
  /** Last digits of the visitor's phone, called instead of the ticket number (setting `ticketing.callByPhone`). */
  callCode: string | null;
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
  visitor: {
    id: string;
    name: string | null;
    phone: string | null;
    company: string | null;
    /** Completed visits before this one. */
    visitCount: number;
    lastVisitAt: string | null;
    returning: boolean;
  } | null;
  appointmentId: string | null;
};

export type Position = { ahead: number; estimatedWaitMinutes: number; waitLow?: number; waitHigh?: number };

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
  ticketing: { numberPad: number; separator: string; showQrOnTicket: boolean; callByPhone: boolean; callByPhoneDigits: number };
  visitorStatus: { enabled: boolean };
  /** Free Wi-Fi printed on the ticket when enabled. */
  wifi: {
    enabled: boolean;
    ssid: string;
    password: string;
    showQr: boolean;
    title: L;
    ssidLabel: L;
    passwordLabel: L;
  };
  reception: {
    oneTapIssue: boolean;
    afterIssue: "print" | "dialog";
    autoPrint: boolean;
    askPriority: boolean;
    askLanguage: boolean;
    defaultLanguage: "interface" | "ar" | "en";
    agentIssuing?: "off" | "when_no_reception" | "always";
  };
  regional: { digitsTicket: "latn" | "arab"; digitsScreen: "latn" | "arab" };
  /** Wording of the estimated wait (label, range, disclaimer, "next" text). */
  waitDisplay: WaitDisplay;
  print: { template: L | null; footer: L; companyName: L; logoUrl: string | null; logoDarkUrl: string | null };
  canReassign: boolean;
  canCancel: boolean;
  canEdit: boolean;
  canCheckIn: boolean;
};

export type AgentWorkspace = {
  now: string;
  /** The agent may issue walk-in tickets from this screen (permission and branch setting). */
  walkIn: { allowed: boolean };
  profile: {
    status: "AVAILABLE" | "BUSY" | "ON_BREAK" | "AWAY" | "OFFLINE";
    statusChangedAt: string;
    breakTypeId: string | null;
    currentDeskId: string | null;
    defaultDeskId: string | null;
    /** The hall the agent hosts now / by default (D62). */
    currentHallId: string | null;
    defaultHallId: string | null;
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
  shift: {
    id: string;
    name: L;
    startsAt: string;
    endsAt: string;
    onShift: boolean;
    endsInMinutes: number;
    startsInMinutes: number;
  } | null;
  shiftMode: "off" | "guide" | "strict";
  breaks: {
    enabled: boolean;
    limit: number | null;
    /** Colleagues of the branch on a break now. */
    onBreak: number;
    request: { status: "waiting" | "offered"; position: number; offerExpiresAt: string | null } | null;
  };
  /** The hall console (D62); null while halls are off in this branch. */
  hall: HallConsole | null;
  /** Up to 5 previous visits (latest first) per visitor id. */
  visitHistory: Record<string, VisitHistoryItem[]>;
};

export type HallMemberStatus = "CALLED" | "ENTERED" | "NO_SHOW" | "DONE" | "RELEASED";

export type HallSession = {
  id: string;
  status: "OPEN" | "IN_SESSION" | "CLOSED" | "CANCELLED";
  hallId: string;
  hallNumber: string;
  hallName: L;
  hostAgentId: string;
  capacity: number;
  reasonId: string | null;
  calledAt: string;
  startedAt: string | null;
  closedAt: string | null;
  /** Visitors called or inside (they use seats). */
  occupied: number;
  tickets: {
    status: HallMemberStatus;
    enteredAt: string | null;
    finishedAt: string | null;
    outcome: string | null;
    ticket: Ticket;
  }[];
};

export type HallConsole = {
  settings: {
    groupMode: "same_reason" | "any_reason";
    minGroup: number;
    maxGroup: number;
    allowTopUp: boolean;
    autoStartWhenAllEntered: boolean;
  };
  halls: { id: string; number: string; name: L; capacity: number; zone: string | null; hostAgentId: string | null }[];
  hall: { id: string; number: string; name: L; capacity: number } | null;
  waiting: number;
  callable: number;
  maxCall: number;
  session: HallSession | null;
};

export type VisitHistoryItem = {
  displayNumber: string;
  reasonId: string;
  arrivedAt: string;
  status: string;
  outcome: string | null;
  agentName: L | null;
};

export type BreakEvent = {
  kind: "queued" | "available" | "expired" | "cancelled";
  onBreak?: number;
  limit?: number;
  position?: number;
  expiresAt?: string;
  holdMinutes?: number;
};
