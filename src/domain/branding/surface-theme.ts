/**
 * Looks shared by the themed screens (the waiting-room display and the wallboard).
 * dark = classic; light; brand = dark tinted with the primary brand colour.
 */
export const SURFACE_THEMES = ["dark", "light", "brand"] as const;
export type SurfaceTheme = (typeof SURFACE_THEMES)[number];

/** A display may follow the organization / branch default instead of choosing its own look. */
export const DISPLAY_THEME_CHOICES = ["default", ...SURFACE_THEMES] as const;
export type DisplayThemeChoice = (typeof DISPLAY_THEME_CHOICES)[number];

/** Page background of the brand theme: the primary colour mixed into a near-black (`primaryVar` is a CSS variable name). */
export const brandBackground = (primaryVar: string) => `color-mix(in srgb, var(${primaryVar}) 22%, #04060c)`;

/** The screen's own theme, or the default when it follows the default. */
export const resolveSurfaceTheme = (choice: DisplayThemeChoice | undefined, fallback: SurfaceTheme): SurfaceTheme =>
  choice && choice !== "default" ? choice : fallback;

/** Logo for a themed surface: dark and brand backgrounds use the dark-background logo when one was uploaded. */
export const logoForTheme = (
  theme: SurfaceTheme,
  logo: { logoUrl: string | null; logoDarkUrl?: string | null },
): string | null => (theme === "light" ? logo.logoUrl : (logo.logoDarkUrl ?? logo.logoUrl));
