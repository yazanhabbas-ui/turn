import { z } from "zod";
import { DEFAULT_PASSWORD_POLICY } from "@/domain/auth/password-policy";

const localized = z.record(z.string(), z.string());

/** Fonts the interface, tickets and screens can use. "FF Hekaya Light" is bundled in public/fonts (see globals.css). */
export const BRAND_FONTS = ["IBM Plex Sans Arabic", "Cairo", "Tajawal", "FF Hekaya Light"] as const;

/**
 * Every configurable setting: key → schema with defaults. Values live in the `settings` table
 * (organization-wide, optionally overridden per branch) and are edited from Admin → Settings.
 */
export const SETTINGS = {
  branding: z
    .object({
      companyName: localized.default({ ar: "دور", en: "Dor" }),
      logoUrl: z.string().nullable().default(null),
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
      showHijri: z.boolean().default(true),
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
      /** Text and tile size for big screens, in percent. */
      textScale: z.number().int().min(80).max(160).default(100),
    })
    .prefault({}),
  /** Whether an agent can have several visitors at the same time. */
  agentWork: z
    .object({
      /** Off = every agent serves one visitor at a time. */
      multipleVisitors: z.boolean().default(false),
      /** Visitors at once for agents without their own limit (Admin → Users → agent profile). */
      visitorsPerAgent: z.number().int().min(1).max(20).default(2),
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
