import type { MetadataRoute } from "next";
import { pickText } from "@/i18n/locales";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** Installable app (PWA) for reception tablets and agent PCs. Name and colour follow the branding settings. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding();
  const name = pickText(branding.companyName, "ar");
  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: pickText(branding.welcomeText, "ar"),
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: branding.primaryColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
