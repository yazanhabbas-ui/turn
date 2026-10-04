/**
 * Readable text on a brand colour. The brand colour is whatever the organization chose (it may be pale), so text on it
 * is white or near-black, whichever has the better contrast.
 */
const LIGHT = "#ffffff";
const DARK = "#0b1220";

/** WCAG relative luminance of a #rrggbb colour, or null when it is not one. */
export function luminanceOf(hex: string | null | undefined): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White on dark colours, near-black on pale ones (white is the choice when the colour is unknown). */
export function onColor(hex: string | null | undefined): string {
  const l = luminanceOf(hex);
  // White has the better contrast up to a luminance of about 0.19.
  return l === null || l <= 0.1925 ? LIGHT : DARK;
}

/**
 * Same, for large text (24 px and up, or 19 px bold), where WCAG asks for 3:1 instead of 4.5:1. The kiosk's headings and
 * buttons are that big, so a mid-tone brand colour keeps white text, which looks like the brand, instead of near-black.
 */
export function onColorLarge(hex: string | null | undefined): string {
  const l = luminanceOf(hex);
  return l === null || l <= 0.3 ? LIGHT : DARK;
}
