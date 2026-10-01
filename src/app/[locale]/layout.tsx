import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Providers } from "@/components/app/providers";
import { dirOf, pickText } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { getAuth } from "@/server/auth/current";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  const branding = await getBranding();
  return {
    title: {
      default: pickText(branding.companyName, locale, t("name")),
      template: `%s · ${pickText(branding.companyName, locale, t("name"))}`,
    },
    description: t("tagline"),
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0f766e", width: "device-width", initialScale: 1 };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const auth = await getAuth();
  const branding = await getBranding(auth?.user.organizationId);
  const dir = dirOf(locale);
  const style = {
    "--brand-primary": branding.primaryColor,
    "--brand-accent": branding.accentColor,
    "--brand-font": `"${branding.font}"`,
  } as React.CSSProperties;

  return (
    <html lang={locale} dir={dir} style={style} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <NextIntlClientProvider>
          <Providers dir={dir} nonce={nonce}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
