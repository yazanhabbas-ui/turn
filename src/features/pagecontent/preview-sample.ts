import type { KioskPageContent, VisitorPageContent } from "@/domain/pagecontent/schema";
import { kioskFields, kioskReasonState } from "@/domain/kiosk/self-service";
import type { FeedbackCardConfig } from "../visitor/feedback-card";
import type { PublicStatus } from "../visitor/visitor-status";
import type { KioskContext, KioskTicket } from "../kiosk/use-kiosk";

type L = Record<string, string>;

/** What the preview page needs from the settings being edited (the effective values of the selected scope). */
export type PreviewEnv = {
  branding: {
    companyName: L;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    primaryColor: string;
    accentColor: string;
    ticketFooter: L;
  };
  branchName: L;
  theme: "dark" | "light" | "brand";
  /** Self check-in options the kiosk screens also read. */
  kiosk: { showWait: boolean; showQr: boolean; printTicket: boolean; welcomeText: L };
  privacy: { consentText: L; requireConsent: boolean };
  digitsScreen: "latn" | "arab";
  waitDisplay: KioskContext["waitDisplay"];
  feedback: Omit<FeedbackCardConfig, "answered"> | null;
  wifi: PublicStatus["wifi"];
  /** The services of the organization (real ones), as the editor loaded them. */
  reasons: SampleReason[];
};

export type SampleReason = {
  id: string;
  name: L;
  description: L | null;
  icon: string;
  color: string;
  prefix: string;
  requiresStaff: boolean;
  intakeFields: { key: string; label: L; type: string; required: boolean; selfService?: boolean }[];
};

export const KIOSK_SCREENS = ["home", "form", "result", "unavailable", "offline"] as const;
export const VISITOR_STATES = ["waiting", "called", "serving", "completed", "onHold", "noShow", "cancelled", "stop"] as const;
export type KioskScreen = (typeof KIOSK_SCREENS)[number];
export type VisitorState = (typeof VISITOR_STATES)[number];

/** Used when the organization has no services yet, so the preview is never empty. */
export const FALLBACK_REASONS: SampleReason[] = [
  {
    id: "sample-1",
    name: { ar: "استفسار عام", en: "General enquiry" },
    description: { ar: "أسئلة عامة وإرشادات", en: "Questions and directions" },
    icon: "circle-help",
    color: "#0f766e",
    prefix: "A",
    requiresStaff: false,
    intakeFields: [{ key: "phone", label: { ar: "رقم الجوال", en: "Mobile number" }, type: "phone", required: false }],
  },
  {
    id: "sample-2",
    name: { ar: "تقديم طلب", en: "Submit a request" },
    description: { ar: "تقديم ومتابعة الطلبات", en: "File and follow up requests" },
    icon: "file-text",
    color: "#b45309",
    prefix: "B",
    requiresStaff: false,
    intakeFields: [],
  },
  {
    id: "sample-3",
    name: { ar: "خدمة تحتاج موظفاً", en: "Service with an agent" },
    description: null,
    icon: "users",
    color: "#4338ca",
    prefix: "C",
    requiresStaff: true,
    intakeFields: [],
  },
];

/** The kiosk context of the preview: the real context shape, fed with the draft and the environment. */
export function sampleKioskContext(draft: KioskPageContent, env: PreviewEnv): KioskContext {
  const source = env.reasons.length ? env.reasons : FALLBACK_REASONS;
  // The phone form is the richest screen, so make sure at least one service asks for it.
  const reasons = source.slice(0, 6).map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    prefix: r.prefix,
    description: draft.showReasonDescriptions ? r.description : null,
    state: kioskReasonState(r),
    intakeFields: kioskFields(r).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
  }));
  return {
    enabled: true,
    device: { id: "preview", name: "Preview" },
    branch: { id: "preview", name: env.branchName, timezone: "UTC" },
    options: {
      idleSeconds: 3600,
      showWait: env.kiosk.showWait,
      showQr: env.kiosk.showQr,
      printTicket: env.kiosk.printTicket,
      welcomeText: env.kiosk.welcomeText,
    },
    theme: env.theme,
    languages: ["ar", "en"],
    reasons,
    privacy: env.privacy,
    regional: { digitsScreen: env.digitsScreen, digitsTicket: env.digitsScreen },
    waitDisplay: env.waitDisplay,
    pageContent: draft,
    branding: env.branding,
    ticketing: { showQrOnTicket: true },
    wifi: { enabled: false, ssid: "", password: "", showQr: false, title: {}, ssidLabel: {}, passwordLabel: {} },
    printTemplate: null,
  } as unknown as KioskContext;
}

export const SAMPLE_TICKET: KioskTicket = {
  duplicate: false,
  ticket: {
    id: "preview",
    displayNumber: "A-014",
    publicToken: "preview-token",
    language: "ar",
    reasonId: "preview",
    arrivedAt: "2026-01-01T09:00:00.000Z",
  },
  ahead: 3,
  estimatedWaitMinutes: 12,
  waitLow: 10,
  waitHigh: 15,
};

const STATUS_OF: Record<Exclude<VisitorState, "stop">, PublicStatus["status"]> = {
  waiting: "WAITING",
  called: "CALLED",
  serving: "SERVING",
  completed: "COMPLETED",
  onHold: "ON_HOLD",
  noShow: "NO_SHOW",
  cancelled: "CANCELLED",
};

/** The status answer of the preview: the real shape the page gets from the server, with sample data. */
export function sampleStatus(
  state: Exclude<VisitorState, "stop">,
  lang: "ar" | "en",
  draft: VisitorPageContent,
  env: PreviewEnv,
): PublicStatus {
  const reason = (env.reasons[0] ?? FALLBACK_REASONS[0])!;
  return {
    displayNumber: "A-014",
    callCode: null,
    status: STATUS_OF[state],
    language: lang,
    branding: env.branding,
    reason: { name: reason.name, color: reason.color, icon: reason.icon },
    branch: env.branchName,
    desk: { number: "3", name: { ar: "المكتب 3", en: "Desk 3" } },
    hall: null,
    groupVisit: false,
    position: state === "waiting" ? { ahead: 3, estimatedWaitMinutes: 12, waitLow: 10, waitHigh: 15 } : null,
    waitDisplay: env.waitDisplay,
    feedback: state === "completed" && env.feedback ? { ...env.feedback, answered: false } : null,
    feedbackOnPage: true,
    notifyOptIn: !draft.hideNotifyOptIn,
    pageContent: draft,
    wifi: draft.showWifi
      ? (env.wifi ?? {
          ssid: "Guest",
          password: "12345678",
          title: { ar: "شبكة الواي فاي المجانية", en: "Free Wi-Fi" },
          ssidLabel: { ar: "اسم الشبكة", en: "Network" },
          passwordLabel: { ar: "كلمة المرور", en: "Password" },
        })
      : null,
  };
}
