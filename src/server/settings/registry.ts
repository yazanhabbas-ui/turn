import { z } from "zod";
import { DEFAULT_PASSWORD_POLICY } from "@/domain/auth/password-policy";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "@/domain/notifications/policy";

const localized = z.record(z.string(), z.string());

/** Fonts the interface, tickets and screens can use. "FF Hekaya Light" is bundled in public/fonts (see globals.css). */
export const BRAND_FONTS = ["IBM Plex Sans Arabic", "Cairo", "Tajawal", "FF Hekaya Light"] as const;

export { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS };
export type { NotificationEvent } from "@/domain/notifications/policy";

const notificationEvent = (enabled: boolean) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      /** Which channels may carry this event (the order they are tried in is `channelOrder`). */
      channels: z
        .object({
          whatsapp: z.boolean().default(true),
          sms: z.boolean().default(true),
          email: z.boolean().default(true),
        })
        .prefault({}),
    })
    .prefault({});

/**
 * Every configurable setting: key → schema with defaults. Values live in the `settings` table
 * (organization-wide, optionally overridden per branch) and are edited from Admin → Settings.
 */
export const SETTINGS = {
  branding: z
    .object({
      companyName: localized.default({ ar: "دور", en: "Dor" }),
      logoUrl: z.string().nullable().default(null),
      /** Logo for dark and brand-coloured backgrounds (display, wallboard); empty = use `logoUrl`. */
      logoDarkUrl: z.string().nullable().default(null),
      primaryColor: z.string().default("#0f766e"),
      accentColor: z.string().default("#b45309"),
      font: z.enum(BRAND_FONTS).default("IBM Plex Sans Arabic"),
      welcomeText: localized.default({ ar: "نرحب بكم، تفضلوا بالانتظار", en: "Welcome, please have a seat" }),
      ticketFooter: localized.default({ ar: "شكراً لزيارتكم", en: "Thank you for your visit" }),
    })
    .prefault({}),
  regional: z
    .object({
      /** Digit system per surface: Western (latn) or Eastern Arabic-Indic (arab). */
      digitsScreen: z.enum(["latn", "arab"]).default("latn"),
      digitsTicket: z.enum(["latn", "arab"]).default("latn"),
      digitsVoice: z.enum(["latn", "arab"]).default("latn"),
      timeFormat: z.enum(["12h", "24h"]).default("12h"),
      showHijri: z.boolean().default(false),
      /** Country calling code (no plus) used to complete local numbers such as 0944 123 456 → +963 944 123 456. */
      phoneCountryCode: z
        .string()
        .regex(/^\d{1,4}$/)
        .default("963"),
    })
    .prefault({}),
  ticketing: z
    .object({
      numberPad: z.number().int().min(0).max(6).default(3),
      separator: z.string().max(3).default("-"),
      /** Branch-local time at which the service day (and ticket numbering) rolls over. */
      dailyResetTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default("03:00"),
      showQrOnTicket: z.boolean().default(true),
    })
    .prefault({}),
  security: z
    .object({
      passwordPolicy: z
        .object({
          minLength: z.number().int().min(8).max(128).default(DEFAULT_PASSWORD_POLICY.minLength),
          requireUpper: z.boolean().default(DEFAULT_PASSWORD_POLICY.requireUpper),
          requireLower: z.boolean().default(DEFAULT_PASSWORD_POLICY.requireLower),
          requireDigit: z.boolean().default(DEFAULT_PASSWORD_POLICY.requireDigit),
          requireSymbol: z.boolean().default(DEFAULT_PASSWORD_POLICY.requireSymbol),
        })
        .prefault({}),
      maxFailedLogins: z.number().int().min(3).max(20).default(5),
      lockoutMinutes: z.number().int().min(1).max(1440).default(15),
      /** Role keys whose members must enable 2FA. */
      require2faForRoles: z.array(z.string()).default([]),
      inviteExpiryHours: z.number().int().min(1).max(720).default(72),
    })
    .prefault({}),
  privacy: z
    .object({
      /** Visitor personal data is anonymized after this many days (0 = keep until manually erased). */
      retentionDays: z.number().int().min(0).max(3650).default(90),
      consentText: localized.default({
        ar: "أوافق على استخدام بياناتي لغرض خدمتي في هذه الزيارة فقط.",
        en: "I agree that my data is used only to serve me during this visit.",
      }),
      requireConsent: z.boolean().default(true),
    })
    .prefault({}),
  visitorStatus: z
    .object({
      enabled: z.boolean().default(true),
      notifyTurnsAway: z.number().int().min(1).max(10).default(2),
    })
    .prefault({}),
  /** Visitor feedback (satisfaction): the card on the status page after a visit, its wording, and what counts as a low score. */
  feedback: z
    .object({
      enabled: z.boolean().default(true),
      /** Show the feedback card on the status page once the visit is completed (the direct link works either way). */
      showOnStatusPage: z.boolean().default(true),
      style: z.enum(["stars", "faces"]).default("faces"),
      askComment: z.boolean().default(true),
      /** Also ask "how likely are you to recommend us" on a 0-10 scale. */
      askNps: z.boolean().default(false),
      /** Scores at or below this raise a low-score alert (see Alerts). */
      lowScoreThreshold: z.number().int().min(1).max(4).default(2),
      prompt: localized.default({ ar: "كيف كانت تجربتك معنا؟", en: "How was your visit?" }),
      commentPrompt: localized.default({
        ar: "هل تودّ إضافة تعليق؟ (اختياري)",
        en: "Anything you would like to add? (optional)",
      }),
      npsPrompt: localized.default({
        ar: "ما مدى احتمال أن توصي بنا لأصدقائك؟",
        en: "How likely are you to recommend us to a friend?",
      }),
      thanks: localized.default({
        ar: "شكراً لك، رأيك يساعدنا على التحسّن.",
        en: "Thank you, your opinion helps us improve.",
      }),
    })
    .prefault({}),
  /**
   * Messages to visitors about their ticket (WhatsApp, SMS, email). Providers and their secrets are configured in the
   * server environment; everything else is here. A branch may override events and the channel order.
   */
  notifications: z
    .object({
      /** Master switch. */
      enabled: z.boolean().default(true),
      /** Send only when the visitor agreed at reception (the consent captured on the ticket). */
      requireConsent: z.boolean().default(true),
      events: z
        .object({
          ticket_issued: notificationEvent(true),
          turns_away: notificationEvent(true),
          called: notificationEvent(true),
          no_show: notificationEvent(true),
          completed_thanks: notificationEvent(false),
        })
        .prefault({}),
      /** Channels are tried in this order; the next one is used when a channel cannot be used or keeps failing. */
      channelOrder: z
        .array(z.enum(NOTIFICATION_CHANNELS))
        .min(1)
        .max(3)
        .default(["whatsapp", "sms", "email"])
        .transform((a) => [...new Set(a)]),
      /** Volume limits only (never a time-of-day rule). */
      limits: z
        .object({
          maxPerTicket: z.number().int().min(1).max(20).default(5),
          /** Attempts per channel before falling back to the next one, or giving up. */
          maxAttempts: z.number().int().min(1).max(10).default(4),
          /** The first retry waits this long, then it doubles each time. */
          retryBaseSeconds: z.number().int().min(5).max(3600).default(30),
          ratePerMinute: z
            .object({
              whatsapp: z.number().int().min(1).max(6000).default(60),
              sms: z.number().int().min(1).max(6000).default(60),
              email: z.number().int().min(1).max(6000).default(120),
            })
            .prefault({}),
        })
        .prefault({}),
      /** Added to every SMS and email so the visitor can opt out. {stopLink} is the signed opt-out link. */
      footer: localized.default({
        ar: "لإيقاف هذه الرسائل: {stopLink}",
        en: "To stop these messages: {stopLink}",
      }),
    })
    .prefault({}),
  /** The live operations screen (wallboard): look and content. Colours, logo and font come from Branding. */
  wallboard: z
    .object({
      /** dark = classic; light; brand = dark tinted with the primary brand colour. */
      theme: z.enum(["dark", "light", "brand"]).default("dark"),
      /** Optional own title (empty = the standard title). */
      title: localized.default({}),
      showLogo: z.boolean().default(true),
      showCompanyName: z.boolean().default(true),
      showBranch: z.boolean().default(true),
      showClock: z.boolean().default(true),
      /** Today's average satisfaction tile (when visitor feedback is on). */
      showCsat: z.boolean().default(true),
      /** Text and tile size for big screens, in percent. */
      textScale: z.number().int().min(80).max(160).default(100),
    })
    .prefault({}),
  /** The look of the waiting-room screens that do not choose their own: dark, light or brand (dark tinted with the primary colour). */
  displayTheme: z
    .object({
      theme: z.enum(["dark", "light", "brand"]).default("dark"),
    })
    .prefault({}),
  /**
   * The waiting time shown to a visitor: how long one visitor takes (a fixed time, each reason's own expected time,
   * or learned from completed services), and how the result is rounded and worded on the ticket and status page.
   */
  waitEstimate: z
    .object({
      /** fixed = the same minutes per visitor; reason = each reason's expected time; analytics = learned from real data. */
      mode: z.enum(["fixed", "reason", "analytics"]).default("reason"),
      fixedMinutesPerVisitor: z.number().min(0.5).max(120).default(5),
      /** Divide by the number of agents serving the queue. */
      divideByAgents: z.boolean().default(true),
      /** Analytics: days of completed services to learn from. */
      lookbackDays: z.number().int().min(1).max(90).default(14),
      /** Analytics: below this many samples the reason's own expected time is used. */
      minSamples: z.number().int().min(1).max(1000).default(20),
      statistic: z.enum(["average", "median", "p75"]).default("median"),
      /** Use only services from the same hour of the day (±1). */
      weightByHour: z.boolean().default(false),
      /** Drop the fastest and slowest 5% and services under 20 seconds or over 4 hours. */
      trimOutliers: z.boolean().default(true),
      /** Round the estimate up to a multiple of this many minutes. */
      rounding: z.union([z.literal(1), z.literal(5), z.literal(10)]).default(1),
      /** Safety margin added to the estimate. */
      bufferPercent: z.number().int().min(0).max(100).default(0),
      showOnTicket: z.boolean().default(true),
      showAsRange: z.boolean().default(false),
      /** Below this many minutes the visitor sees the "next" text instead of a number (0 = always a number). */
      minShown: z.number().int().min(0).max(60).default(0),
      label: localized.default({ ar: "الانتظار المتوقع", en: "Estimated wait" }),
      unitLabel: localized.default({ ar: "دقيقة", en: "min" }),
      nextText: localized.default({ ar: "خلال دقائق", en: "Within minutes" }),
      disclaimer: localized.default({}),
    })
    .prefault({}),
  /** Free public Wi-Fi details printed on the ticket. Can differ per branch. */
  wifi: z
    .object({
      enabled: z.boolean().default(false),
      ssid: z.string().trim().max(32).default(""),
      /** Leave empty for an open network. WPA passwords are 8-63 characters. */
      password: z.string().max(63).default(""),
      /** Also print a QR code that joins the network when scanned. */
      showQr: z.boolean().default(false),
      title: localized.default({ ar: "شبكة الواي فاي المجانية", en: "Free Wi-Fi" }),
      ssidLabel: localized.default({ ar: "اسم الشبكة", en: "Network" }),
      passwordLabel: localized.default({ ar: "كلمة المرور", en: "Password" }),
    })
    .prefault({}),
  /** Whether an agent can have several visitors at the same time. */
  agentWork: z
    .object({
      /** Off = every agent serves one visitor at a time. */
      multipleVisitors: z.boolean().default(false),
      /**
       * How shifts are used: off = ignored; guide = shown, used in reports, and agents outside their shift get no
       * automatic assignments; strict = an agent cannot become available outside their shift and is signed out
       * after it ends.
       */
      shiftMode: z.enum(["off", "guide", "strict"]).default("guide"),
      /** In strict mode: minutes after the shift end before an idle agent is signed out. */
      shiftEndGraceMinutes: z.number().int().min(0).max(120).default(10),
      /** Visitors at once for agents without their own limit (Admin → Users → agent profile). */
      visitorsPerAgent: z.number().int().min(1).max(20).default(2),
    })
    .prefault({}),
  /** Limits on agents being on a break at the same time. */
  breaks: z
    .object({
      enabled: z.boolean().default(true),
      /** The most agents of a branch that may be on a break at once: a number, or a share of the agents signed in. */
      maxOnBreak: z
        .object({
          mode: z.enum(["count", "percent"]).default("count"),
          value: z.number().int().min(1).max(100).default(2),
        })
        .prefault({}),
      /** When a place frees up, the next agent in line has this many minutes to take it. */
      holdMinutes: z.number().int().min(1).max(30).default(3),
    })
    .prefault({}),
  /** How fast the reception desk is: what happens when a reason is tapped and after a ticket is issued. */
  reception: z
    .object({
      /** A reason with no required fields issues its ticket on the first tap (no form, no extra click). */
      oneTapIssue: z.boolean().default(true),
      /** print = print at once and show a small confirmation; dialog = big confirmation to close first. */
      afterIssue: z.enum(["print", "dialog"]).default("print"),
      /** Default for new devices; each reception PC can override it. */
      autoPrint: z.boolean().default(true),
      /** Show the priority chips above the reasons (choose before tapping the reason). */
      askPriority: z.boolean().default(true),
      /** Show the language toggle above the reasons. */
      askLanguage: z.boolean().default(true),
      /** interface = the receptionist's own language. */
      defaultLanguage: z.enum(["interface", "ar", "en"]).default("interface"),
    })
    .prefault({}),
  /** Report definitions. */
  reports: z
    .object({
      /** "X% of visitors called within Y minutes". */
      serviceLevelMinutes: z.number().int().min(1).max(120).default(5),
      serviceLevelTargetPct: z.number().int().min(1).max(100).default(80),
      /** Share of an agent's working time that should be spent serving, used to size the staffing forecast. */
      targetUtilisationPct: z.number().int().min(30).max(100).default(80),
      /** Days of history the forecast averages. */
      forecastHistoryDays: z.number().int().min(7).max(90).default(28),
    })
    .prefault({}),
  /** Anomaly alert thresholds (evaluated every minute per branch). */
  alerts: z
    .object({
      enabled: z.boolean().default(true),
      /** A waiting visitor has waited this long. */
      longWaitMinutes: z.number().int().min(1).max(240).default(20),
      /** This many people are waiting in the branch. */
      queueLimit: z.number().int().min(1).max(500).default(15),
      /** An available agent has had nobody to serve for this long while people wait. */
      agentIdleMinutes: z.number().int().min(1).max(240).default(15),
      /** This many no-shows inside the window. */
      noShowCount: z.number().int().min(1).max(50).default(3),
      noShowWindowMinutes: z.number().int().min(5).max(240).default(30),
      /** Raise an alert for every response at or below the feedback low-score threshold. */
      lowScoreAlerts: z.boolean().default(true),
      /** Raise an alert when the average satisfaction over the window falls below this (0 = off). */
      lowSatisfactionBelow: z.number().min(0).max(5).default(0),
      lowSatisfactionMinResponses: z.number().int().min(1).max(500).default(5),
      lowSatisfactionWindowHours: z.number().int().min(1).max(168).default(24),
      /** Supervisors who also get an email (in-app alerts always appear). */
      notifyEmails: z.array(z.string().email()).max(20).default([]),
    })
    .prefault({}),
  /** Announcements on waiting-room screens. Individual screens can override volume and rate. */
  voice: z
    .object({
      enabled: z.boolean().default(true),
      /** browser = the screen's own speech engine; pack = pre-recorded clips; cloud = server-side TTS (extension point). */
      provider: z.enum(["browser", "pack", "cloud"]).default("browser"),
      /** sequence = speak every language in `languages`; ticket = only the visitor's language. */
      mode: z.enum(["sequence", "ticket"]).default("sequence"),
      languages: z
        .array(z.enum(["ar", "en"]))
        .min(1)
        .default(["ar", "en"]),
      repeat: z.number().int().min(1).max(5).default(2),
      repeatGapSeconds: z.number().min(0).max(30).default(3),
      chime: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(1),
      rate: z.number().min(0.5).max(1.5).default(0.9),
      /** Optional preferred voice names per language (matched by prefix against the engine's voices). */
      voiceNames: localized.default({}),
    })
    .prefault({}),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]>;

/** Parses a stored value, filling in defaults for any fields added since it was saved. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const parsed = SETTINGS[key].safeParse(raw ?? {});
  return (parsed.success ? parsed.data : SETTINGS[key].parse({})) as SettingValue<K>;
}

export function defaultSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].parse({}) as SettingValue<K>;
}

/** Settings a branch (and so a city admin) may override for their own branches. Everything else is organization-wide. */
export const BRANCH_OVERRIDABLE: readonly SettingKey[] = [
  "wifi",
  "reception",
  "alerts",
  "wallboard",
  "feedback",
  "displayTheme",
  "waitEstimate",
  "notifications",
];
