import { z } from "zod";

export const DISPLAY_LAYOUTS = ["classic", "single", "multi"] as const;
export type DisplayLayout = (typeof DISPLAY_LAYOUTS)[number];

/**
 * Per-screen options, stored in `displays.config`. Every field has a default, so a freshly paired screen
 * works without any setup. Voice options set here override the organization-wide `voice` setting.
 */
export const displayConfigSchema = z.object({
  /** Interface languages the screen rotates through (a single entry = no rotation). */
  languages: z
    .array(z.enum(["ar", "en"]))
    .min(1)
    .max(2)
    .default(["ar", "en"]),
  rotateSeconds: z.number().int().min(5).max(120).default(15),
  /** Only show desks in these zones (empty = every desk of the branch). */
  zones: z.array(z.string().max(20)).max(20).default([]),
  showTicker: z.boolean().default(true),
  showSlides: z.boolean().default(true),
  showWaiting: z.boolean().default(true),
  showClock: z.boolean().default(true),
  voice: z
    .object({
      enabled: z.boolean().optional(),
      volume: z.number().min(0).max(1).optional(),
      rate: z.number().min(0.5).max(1.5).optional(),
    })
    .default({}),
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;

export function parseDisplayConfig(raw: unknown): DisplayConfig {
  const r = displayConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : displayConfigSchema.parse({});
}
