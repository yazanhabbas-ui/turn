import { getLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { getBranding } from "@/server/branding";

/** Centered card layout for sign-in, 2FA and invite acceptance pages. */
export async function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const locale = await getLocale();
  const branding = await getBranding();
  const companyName = pickText(branding.companyName, locale);
  const darkLogo = branding.logoDarkUrl && branding.logoDarkUrl !== branding.logoUrl ? branding.logoDarkUrl : null;
  return (
    <div className="from-brand/10 to-background flex min-h-dvh flex-col bg-gradient-to-b">
      <div className="flex justify-end gap-1 p-3">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pt-[8vh]">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            {branding.logoUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={branding.logoUrl} alt={companyName} className={cn("mx-auto h-14 w-auto", darkLogo && "dark:hidden")} />
                {darkLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={darkLogo} alt={companyName} className="mx-auto hidden h-14 w-auto dark:block" />
                )}
              </>
            ) : (
              <>
                <div className="bg-brand mx-auto grid size-14 place-items-center rounded-2xl text-2xl font-bold text-white">
                  {companyName.slice(0, 1)}
                </div>
                <p className="text-muted-foreground mt-3 text-sm font-medium">{companyName}</p>
              </>
            )}
          </div>
          <div className="bg-card rounded-2xl border p-6 shadow-sm">
            <h1 className="text-xl font-bold">{title}</h1>
            {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
