import {
  BellRing,
  Coffee,
  ConciergeBell,
  Flag,
  Hourglass,
  Languages,
  ListChecks,
  Lock,
  MessageSquareHeart,
  MonitorPlay,
  Palette,
  ChartColumn,
  ShieldCheck,
  Smartphone,
  Ticket,
  UsersRound,
  Wifi,
  type LucideIcon,
} from "lucide-react";

/**
 * The single list of settings sections: navigation, permission gating and the search index all read it.
 *
 * To make a new setting findable, add `{ key, anchor }` to its section: `key` is the message key under `settings`
 * (its label, and `<key>Hint` when present, are searched in both languages) and `anchor` is the id of the input, so
 * choosing the search result scrolls to it and flashes it. `keywords` are extra words people may type (any language).
 */
export type SectionId =
  | "branding"
  | "regional"
  | "ticketing"
  | "reception"
  | "wifi"
  | "waitEstimate"
  | "visitorStatus"
  | "feedback"
  | "priorities"
  | "agents"
  | "breakLimit"
  | "breaks"
  | "wallboard"
  | "reports"
  | "alerts"
  | "security"
  | "privacy";

export type GroupId = "general" | "visitors" | "service" | "screens" | "security";

export type FieldRef = { key: string; anchor?: string };

export type SectionDef = {
  id: SectionId;
  group: GroupId;
  icon: LucideIcon;
  /** Shown as the "Applies to" badge: the organization default, or the organization default overridable per branch. */
  scope: "organization" | "branch";
  /** Sections a city or branch admin may open. Everything else needs organization-wide settings rights. */
  branchLevel?: boolean;
  fields: FieldRef[];
  keywords?: string[];
};

export const GROUPS: GroupId[] = ["general", "visitors", "service", "screens", "security"];

export const SECTIONS: SectionDef[] = [
  {
    id: "branding",
    group: "general",
    icon: Palette,
    scope: "organization",
    keywords: ["logo", "brand", "colour", "color", "theme", "شعار", "لوغو", "هوية", "لون", "خط"],
    fields: [
      { key: "companyName", anchor: "br-name" },
      { key: "logoUrl", anchor: "br-logo" },
      { key: "logoDarkUrl", anchor: "br-logo-dark" },
      { key: "primaryColor", anchor: "br-primary" },
      { key: "accentColor", anchor: "br-accent" },
      { key: "font", anchor: "br-font" },
      { key: "welcomeText", anchor: "br-welcome" },
      { key: "ticketFooter", anchor: "br-footer" },
    ],
  },
  {
    id: "regional",
    group: "general",
    icon: Languages,
    scope: "organization",
    keywords: ["arabic", "english", "digits", "numerals", "hijri", "calendar", "تقويم", "أرقام", "هجري"],
    fields: [
      { key: "digitsScreen", anchor: "rg-ds" },
      { key: "digitsTicket", anchor: "rg-dt" },
      { key: "digitsVoice", anchor: "rg-dv" },
      { key: "timeFormat", anchor: "rg-tf" },
      { key: "phoneCountryCode", anchor: "rg-cc" },
      { key: "showHijri", anchor: "rg-hijri" },
    ],
  },
  {
    id: "ticketing",
    group: "visitors",
    icon: Ticket,
    scope: "organization",
    keywords: ["number", "prefix", "counter", "qr", "رقم", "تذكرة", "تصفير"],
    fields: [
      { key: "numberPad", anchor: "tk-pad" },
      { key: "separator", anchor: "tk-sep" },
      { key: "dailyResetTime", anchor: "tk-reset" },
      { key: "showQrOnTicket", anchor: "tk-qr" },
    ],
  },
  {
    id: "reception",
    group: "visitors",
    icon: ConciergeBell,
    scope: "organization",
    keywords: ["issue", "print", "kiosk", "desk", "طباعة", "استقبال", "إصدار"],
    fields: [
      { key: "oneTapIssue", anchor: "rc-onetap" },
      { key: "autoPrintDefault", anchor: "rc-print" },
      { key: "askPriority", anchor: "rc-prio" },
      { key: "askLanguage", anchor: "rc-ask-lang" },
      { key: "afterIssue", anchor: "rc-after" },
      { key: "defaultLanguage", anchor: "rc-lang" },
    ],
  },
  {
    id: "wifi",
    group: "visitors",
    icon: Wifi,
    scope: "branch",
    branchLevel: true,
    keywords: ["wifi", "wi fi", "wireless", "internet", "network", "password", "شبكة", "انترنت", "إنترنت"],
    fields: [
      { key: "wifiScope", anchor: "wf-scope" },
      { key: "wifiEnabled", anchor: "wf-enabled" },
      { key: "wifiSsid", anchor: "wf-ssid" },
      { key: "wifiPassword", anchor: "wf-pass" },
      { key: "wifiShowQr", anchor: "wf-qr" },
      { key: "wifiTitle", anchor: "wf-title-ar" },
    ],
  },
  {
    id: "waitEstimate",
    group: "visitors",
    icon: Hourglass,
    scope: "branch",
    branchLevel: true,
    keywords: ["wait", "estimate", "eta", "analytics", "انتظار", "تقدير", "مدة"],
    fields: [
      { key: "weMode" },
      { key: "weFixedMinutes", anchor: "we-fixed" },
      { key: "weLookbackDays", anchor: "we-days" },
      { key: "weMinSamples", anchor: "we-min" },
      { key: "weStatistic", anchor: "we-stat" },
      { key: "weRounding", anchor: "we-round" },
      { key: "weBuffer", anchor: "we-buffer" },
      { key: "weMinShown", anchor: "we-minshown" },
      { key: "weShowOnTicket" },
      { key: "weShowAsRange" },
      { key: "weLabel", anchor: "we-label-ar" },
      { key: "weUnit", anchor: "we-unit-ar" },
      { key: "weNextText", anchor: "we-next-ar" },
      { key: "weDisclaimer", anchor: "we-disc-ar" },
    ],
  },
  {
    id: "visitorStatus",
    group: "visitors",
    icon: Smartphone,
    scope: "organization",
    keywords: ["status page", "notification", "phone", "صفحة الزائر", "إشعار"],
    fields: [
      { key: "visitorStatusEnabled", anchor: "vs-enabled" },
      { key: "notifyTurnsAway", anchor: "vs-turns" },
    ],
  },
  {
    id: "feedback",
    group: "visitors",
    icon: MessageSquareHeart,
    scope: "branch",
    branchLevel: true,
    keywords: [
      "feedback",
      "csat",
      "satisfaction",
      "rating",
      "survey",
      "stars",
      "nps",
      "comment",
      "رأي",
      "تقييم",
      "رضا",
      "استبيان",
      "نجوم",
      "تعليق",
    ],
    fields: [
      { key: "feedbackScope", anchor: "fb-scope" },
      { key: "feedbackEnabled", anchor: "fb-enabled" },
      { key: "feedbackOnPage", anchor: "fb-page" },
      { key: "feedbackStyle", anchor: "fb-style" },
      { key: "feedbackLowScore", anchor: "fb-low" },
      { key: "feedbackAskComment", anchor: "fb-comment" },
      { key: "feedbackAskNps", anchor: "fb-nps" },
      { key: "feedbackPrompt", anchor: "fb-prompt-ar" },
      { key: "feedbackCommentPrompt", anchor: "fb-comment-prompt-ar" },
      { key: "feedbackNpsPrompt", anchor: "fb-nps-prompt-ar" },
      { key: "feedbackThanks", anchor: "fb-thanks-ar" },
    ],
  },
  {
    id: "priorities",
    group: "visitors",
    icon: Flag,
    scope: "organization",
    keywords: ["vip", "lane", "weight", "أولوية", "مسار"],
    fields: [{ key: "addPriority" }, { key: "priorityWeight" }, { key: "isLane" }],
  },
  {
    id: "agents",
    group: "service",
    icon: UsersRound,
    scope: "organization",
    keywords: ["shift", "workload", "parallel", "دوام", "موظف", "وردية"],
    fields: [
      { key: "multipleVisitors", anchor: "aw-multi" },
      { key: "visitorsPerAgent", anchor: "aw-per" },
      { key: "shiftMode", anchor: "aw-shift" },
      { key: "shiftEndGrace", anchor: "aw-grace" },
      { key: "shifts" },
      { key: "addShift" },
    ],
  },
  {
    id: "breakLimit",
    group: "service",
    icon: Coffee,
    scope: "organization",
    keywords: ["simultaneous", "concurrent", "استراحة", "حد"],
    fields: [
      { key: "breakLimitEnabled", anchor: "bl-enabled" },
      { key: "maxOnBreak", anchor: "bl-max" },
      { key: "holdMinutes", anchor: "bl-hold" },
    ],
  },
  {
    id: "breaks",
    group: "service",
    icon: ListChecks,
    scope: "organization",
    keywords: ["lunch", "prayer break", "استراحة", "غداء"],
    fields: [{ key: "addBreak" }, { key: "maxMinutes" }, { key: "productive" }],
  },
  {
    id: "wallboard",
    group: "screens",
    icon: MonitorPlay,
    scope: "organization",
    keywords: ["tv", "dashboard", "screen", "شاشة", "لوحة"],
    fields: [
      { key: "displayTheme", anchor: "dt-theme" },
      { key: "wallboardTheme", anchor: "wb-theme" },
      { key: "wallboardTextScale", anchor: "wb-scale" },
      { key: "wallboardTitle", anchor: "wb-title-ar" },
      { key: "wallboardShowLogo", anchor: "wb-logo" },
      { key: "wallboardShowCompanyName", anchor: "wb-company" },
      { key: "wallboardShowBranch", anchor: "wb-branch" },
      { key: "wallboardShowClock", anchor: "wb-clock" },
      { key: "wallboardShowCsat", anchor: "wb-csat" },
    ],
  },
  {
    id: "reports",
    group: "screens",
    icon: ChartColumn,
    scope: "organization",
    keywords: ["sla", "kpi", "service level", "forecast", "utilisation", "utilization", "تقارير", "مستوى الخدمة"],
    fields: [
      { key: "serviceLevelMinutes", anchor: "rp-slm" },
      { key: "serviceLevelTargetPct", anchor: "rp-slp" },
      { key: "targetUtilisationPct", anchor: "rp-util" },
      { key: "forecastHistoryDays", anchor: "rp-hist" },
    ],
  },
  {
    id: "alerts",
    group: "screens",
    icon: BellRing,
    scope: "organization",
    keywords: ["email", "notify", "threshold", "no-show", "تنبيه", "بريد", "غياب"],
    fields: [
      { key: "alertsEnabled", anchor: "al-enabled" },
      { key: "longWaitMinutes", anchor: "al-long" },
      { key: "queueLimit", anchor: "al-limit" },
      { key: "agentIdleMinutes", anchor: "al-idle" },
      { key: "noShowCount", anchor: "al-ns" },
      { key: "noShowWindowMinutes", anchor: "al-nsw" },
      { key: "lowScoreAlerts", anchor: "al-lowscore" },
      { key: "lowSatisfactionBelow", anchor: "al-lowsat" },
      { key: "lowSatisfactionMinResponses", anchor: "al-lowsat-min" },
      { key: "lowSatisfactionWindowHours", anchor: "al-lowsat-hours" },
      { key: "notifyEmails", anchor: "al-emails" },
    ],
  },
  {
    id: "security",
    group: "security",
    icon: ShieldCheck,
    scope: "organization",
    keywords: ["login", "lockout", "2fa", "two-step", "mfa", "كلمة المرور", "قفل", "تحقق"],
    fields: [
      { key: "passwordPolicy", anchor: "sc-policy" },
      { key: "minLength", anchor: "sc-min" },
      { key: "requireUpper", anchor: "sc-upper" },
      { key: "requireLower", anchor: "sc-lower" },
      { key: "requireDigit", anchor: "sc-digit" },
      { key: "requireSymbol", anchor: "sc-symbol" },
      { key: "maxFailedLogins", anchor: "sc-fail" },
      { key: "lockoutMinutes", anchor: "sc-lock" },
      { key: "inviteExpiryHours", anchor: "sc-inv" },
      { key: "require2faForRoles", anchor: "sc-2fa" },
    ],
  },
  {
    id: "privacy",
    group: "security",
    icon: Lock,
    scope: "organization",
    keywords: ["pdpl", "gdpr", "retention", "consent", "delete", "خصوصية", "موافقة", "حذف"],
    fields: [
      { key: "retentionDays", anchor: "pv-ret" },
      { key: "consentText", anchor: "pv-consent-ar" },
      { key: "requireConsent", anchor: "pv-require" },
    ],
  },
];

/** A city or branch admin only manages what a branch may own; organization settings are for org-wide admins. */
export function sectionsFor(organization: boolean): SectionDef[] {
  return organization ? SECTIONS : SECTIONS.filter((s) => s.branchLevel);
}
