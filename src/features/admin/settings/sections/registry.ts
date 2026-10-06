import {
  BellRing,
  BookOpen,
  Coffee,
  ConciergeBell,
  DatabaseZap,
  DoorOpen,
  Flag,
  Hourglass,
  Languages,
  ListChecks,
  Lock,
  MessageSquareHeart,
  MonitorPlay,
  Palette,
  PanelsTopLeft,
  ChartColumn,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Ticket,
  UsersRound,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { SettingKey } from "@/server/settings/registry";

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
  | "helpCenter"
  | "ticketing"
  | "reception"
  | "selfCheckin"
  | "wifi"
  | "waitEstimate"
  | "visitorStatus"
  | "pageContent"
  | "feedback"
  | "priorities"
  | "agents"
  | "halls"
  | "breakLimit"
  | "breaks"
  | "wallboard"
  | "reports"
  | "alerts"
  | "security"
  | "retention"
  | "privacy";

export type GroupId = "general" | "visitors" | "service" | "screens" | "security";

export type FieldRef = { key: string; anchor?: string };

export type SectionDef = {
  id: SectionId;
  group: GroupId;
  icon: LucideIcon;
  /**
   * The lowest level that may hold its own value: "organization" (never overridden), "city" (a city may override it)
   * or "branch" (a city or one of its branches may). Mirrors CITY_OVERRIDABLE / BRANCH_OVERRIDABLE on the server,
   * which enforce it; the API's `sources` answer is what the page trusts at run time.
   */
  scope: "organization" | "city" | "branch";
  /** The setting groups this section edits (empty = it edits other data, such as priority levels). */
  keys: SettingKey[];
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
    keys: ["branding"],
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
    id: "helpCenter",
    group: "general",
    icon: BookOpen,
    scope: "organization",
    keys: ["helpCenter"],
    keywords: ["help", "manual", "manuals", "guide", "knowledge base", "مساعدة", "دليل", "أدلة", "المعرفة"],
    fields: [{ key: "helpCenterEnabled", anchor: "hc-enabled" }],
  },
  {
    id: "regional",
    group: "general",
    icon: Languages,
    scope: "city",
    keys: ["regional"],
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
    scope: "city",
    keys: ["ticketing"],
    keywords: ["number", "prefix", "counter", "qr", "reset", "phone", "digits", "رقم", "تذكرة", "تصفير", "هاتف"],
    fields: [
      { key: "numberPad", anchor: "tk-pad" },
      { key: "separator", anchor: "tk-sep" },
      { key: "dailyResetTime", anchor: "tk-reset" },
      { key: "numberResetAfter", anchor: "tk-resetafter" },
      { key: "callByPhone", anchor: "tk-callphone" },
      { key: "callByPhoneDigits", anchor: "tk-calldigits" },
      { key: "showQrOnTicket", anchor: "tk-qr" },
    ],
  },
  {
    id: "reception",
    group: "visitors",
    icon: ConciergeBell,
    scope: "branch",
    keys: ["reception"],
    keywords: ["issue", "print", "kiosk", "desk", "طباعة", "استقبال", "إصدار"],
    fields: [
      { key: "oneTapIssue", anchor: "rc-onetap" },
      { key: "autoPrintDefault", anchor: "rc-print" },
      { key: "askPriority", anchor: "rc-prio" },
      { key: "askLanguage", anchor: "rc-ask-lang" },
      { key: "afterIssue", anchor: "rc-after" },
      { key: "defaultLanguage", anchor: "rc-lang" },
      { key: "agentIssuing", anchor: "rc-agent" },
    ],
  },
  {
    id: "selfCheckin",
    group: "visitors",
    icon: ScanLine,
    scope: "branch",
    keys: ["selfCheckin"],
    keywords: [
      "kiosk",
      "self service",
      "self-service",
      "check in",
      "check-in",
      "tablet",
      "touch",
      "walk-in",
      "no receptionist",
      "كشك",
      "تسجيل ذاتي",
      "خدمة ذاتية",
      "جهاز لوحي",
      "بدون موظف استقبال",
    ],
    fields: [
      { key: "selfCheckinEnabled", anchor: "sc-enabled" },
      { key: "selfCheckinPrint", anchor: "sc-print" },
      { key: "selfCheckinShowWait", anchor: "sc-wait" },
      { key: "selfCheckinShowQr", anchor: "sc-qr" },
      { key: "selfCheckinIdle", anchor: "sc-idle" },
      { key: "selfCheckinMaxWaiting", anchor: "sc-max" },
      { key: "selfCheckinRate", anchor: "sc-rate" },
      { key: "selfCheckinReasons", anchor: "sc-reasons" },
      { key: "selfCheckinWelcome", anchor: "sc-welcome-ar" },
    ],
  },
  {
    id: "wifi",
    group: "visitors",
    icon: Wifi,
    scope: "branch",
    keys: ["wifi"],
    keywords: ["wifi", "wi fi", "wireless", "internet", "network", "password", "شبكة", "انترنت", "إنترنت"],
    fields: [
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
    keys: ["waitEstimate"],
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
    scope: "city",
    keys: ["visitorStatus"],
    keywords: ["status page", "notification", "phone", "صفحة الزائر", "إشعار"],
    fields: [{ key: "visitorStatusEnabled", anchor: "vs-enabled" }],
  },
  {
    id: "pageContent",
    group: "visitors",
    icon: PanelsTopLeft,
    scope: "branch",
    keys: ["pageContent"],
    keywords: [
      "page content",
      "wording",
      "text",
      "texts",
      "message",
      "kiosk",
      "visitor page",
      "status page",
      "ticket page",
      "footer",
      "link",
      "contact",
      "heading",
      "welcome",
      "customize",
      "customise",
      "محتوى",
      "نص",
      "نصوص",
      "صياغة",
      "عبارات",
      "رسائل",
      "صفحة الزائر",
      "صفحة التذكرة",
      "الكشك",
      "تخصيص",
      "عنوان",
      "تذييل",
      "رابط",
    ],
    fields: [
      { key: "pcShowBranchName", anchor: "pc-k-branch" },
      { key: "pcShowLogo", anchor: "pc-k-logo" },
      { key: "pcShowLanguageButtons", anchor: "pc-k-lang" },
      { key: "pcShowReasonDescriptions", anchor: "pc-k-desc" },
      { key: "pcHeaderStyle", anchor: "pc-k-header" },
      { key: "pcSuccessStyle", anchor: "pc-k-success" },
      { key: "pcTiles", anchor: "pc-k-tiles" },
      { key: "pcVShowBranch", anchor: "pc-v-branch" },
      { key: "pcVShowQueuePosition", anchor: "pc-v-position" },
      { key: "pcVShowEstimatedWait", anchor: "pc-v-wait" },
      { key: "pcVShowDeskCard", anchor: "pc-v-desk" },
      { key: "pcVShowWifi", anchor: "pc-v-wifi" },
      { key: "pcSupportPhone", anchor: "pc-v-phone" },
      { key: "pcSupportEmail", anchor: "pc-v-email" },
      { key: "pcFooter", anchor: "pc-v-footer-ar" },
      { key: "pcLinks" },
    ],
  },
  {
    id: "feedback",
    group: "visitors",
    icon: MessageSquareHeart,
    scope: "branch",
    keys: ["feedback"],
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
    keys: [],
    keywords: ["vip", "lane", "weight", "أولوية", "مسار"],
    fields: [{ key: "addPriority" }, { key: "priorityWeight" }, { key: "isLane" }],
  },
  {
    id: "agents",
    group: "service",
    icon: UsersRound,
    scope: "city",
    keys: ["agentWork"],
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
    id: "halls",
    group: "service",
    icon: DoorOpen,
    scope: "branch",
    keys: ["halls"],
    keywords: [
      "hall",
      "halls",
      "group",
      "session",
      "capacity",
      "room",
      "orientation",
      "host",
      "seminar",
      "قاعة",
      "قاعات",
      "مجموعة",
      "جلسة",
      "سعة",
      "مضيف",
      "تعريفية",
    ],
    fields: [
      { key: "hallsEnabled", anchor: "hl-enabled" },
      { key: "hallsGroupMode", anchor: "hl-mode" },
      { key: "hallsMinGroup", anchor: "hl-min" },
      { key: "hallsMaxGroup", anchor: "hl-max" },
      { key: "hallsAllowTopUp", anchor: "hl-topup" },
      { key: "hallsAutoStart", anchor: "hl-auto" },
      { key: "hallsAnnounceMode", anchor: "hl-announce" },
      { key: "hallsMaxAnnounced", anchor: "hl-announced" },
    ],
  },
  {
    id: "breakLimit",
    group: "service",
    icon: Coffee,
    scope: "city",
    keys: ["breaks"],
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
    keys: [],
    keywords: ["lunch", "prayer break", "استراحة", "غداء"],
    fields: [{ key: "addBreak" }, { key: "maxMinutes" }, { key: "productive" }],
  },
  {
    id: "wallboard",
    group: "screens",
    icon: MonitorPlay,
    scope: "branch",
    keys: ["wallboard", "displayTheme"],
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
      { key: "wallboardShowNegative", anchor: "wb-neg" },
      { key: "wallboardNegativeCount", anchor: "wb-neg-count" },
      { key: "wallboardNegativeHours", anchor: "wb-neg-hours" },
      { key: "wallboardShowNegativeComment", anchor: "wb-neg-comment" },
    ],
  },
  {
    id: "reports",
    group: "screens",
    icon: ChartColumn,
    scope: "city",
    keys: ["reports"],
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
    scope: "branch",
    keys: ["alerts"],
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
    keys: ["security"],
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
    id: "retention",
    group: "security",
    icon: DatabaseZap,
    scope: "organization",
    keys: ["privacy"],
    keywords: [
      "pdpl",
      "gdpr",
      "retention",
      "anonymize",
      "anonymise",
      "delete",
      "erase",
      "purge",
      "احتفاظ",
      "حذف",
      "إخفاء",
      "مدة",
      "بيانات",
    ],
    fields: [
      { key: "retentionDays", anchor: "pv-ret" },
      { key: "ticketDataDays", anchor: "pv-tickets" },
      { key: "commentDays", anchor: "pv-comments" },
      { key: "notificationDays", anchor: "pv-notif" },
      { key: "auditDays", anchor: "pv-audit" },
      { key: "credentialDays", anchor: "pv-cred" },
    ],
  },
  {
    id: "privacy",
    group: "security",
    icon: Lock,
    scope: "organization",
    keys: ["privacy"],
    keywords: ["pdpl", "gdpr", "consent", "خصوصية", "موافقة"],
    fields: [
      { key: "consentText", anchor: "pv-consent-ar" },
      { key: "requireConsent", anchor: "pv-require" },
    ],
  },
];

/** Organization-wide admins see every section; city and branch admins only those a city or branch may override. */
export function sectionsFor(organization: boolean): SectionDef[] {
  return organization ? SECTIONS : SECTIONS.filter((s) => s.scope !== "organization");
}
