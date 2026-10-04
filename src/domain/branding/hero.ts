import { onColorLarge } from "./contrast";

/**
 * The band an organization's screens put at the top (the self check-in kiosk, the visitor's turn page): its primary colour
 * as a gradient with the accent colour as a soft glow, and text that is white or near-black depending on the colour.
 * Pale primaries get a lighter gradient so dark text keeps its contrast.
 */
export function brandHero(branding: { primaryColor?: string | null; accentColor?: string | null }) {
  const primary = branding.primaryColor || "#0f766e";
  const accent = branding.accentColor || "#b45309";
  const on = onColorLarge(primary);
  const pale = on !== "#ffffff";
  const base = pale
    ? `linear-gradient(135deg, color-mix(in srgb, ${primary} 78%, #fff), ${primary})`
    : `linear-gradient(135deg, ${primary}, color-mix(in srgb, ${primary} 66%, #000))`;
  const hero = `radial-gradient(circle at 92% 8%, color-mix(in srgb, ${accent} 55%, transparent) 0, transparent 42%), ${base}`;
  return { primary, accent, on, hero, actionStyle: { backgroundColor: primary, color: on } };
}
