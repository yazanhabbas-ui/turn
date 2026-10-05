import { BookOpen, ShieldAlert } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can } from "@/domain/rbac/permissions";
import { pickText } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { AREAS, type AreaKey } from "@/lib/areas";
import { cn } from "@/lib/utils";
import type { AuthContext } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { AreaMenu } from "./area-menu";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";
import { SignOutButton } from "./sign-out-button";
import { UserAvatar } from "./user-avatar";

/** Header shared by every signed-in workspace: brand, area switcher, language, account, sign out. */
export async function AppShell({
  auth,
  area,
  children,
  sidebar,
}: {
  auth: AuthContext;
  area?: AreaKey | "account" | "profile" | "help";
  children: React.ReactNode;
  sidebar?: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations("areas");
  const branding = await getBranding(auth.user.organizationId);
  const darkLogo = branding.logoDarkUrl && branding.logoDarkUrl !== branding.logoUrl ? branding.logoDarkUrl : null;
  const areas = AREAS.filter((a) => can(auth.grants, a.permission));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
          <Link href="/" className="text-brand flex min-w-0 shrink items-center gap-2 font-bold">
            {branding.logoUrl ? (
              <>
                {/* Both logos are rendered; CSS picks the one for the active theme, so there is no flash. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={branding.logoUrl}
                  alt={pickText(branding.companyName, locale)}
                  className={cn("h-8 w-auto min-w-0 object-contain", darkLogo && "dark:hidden")}
                />
                {darkLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={darkLogo} alt={pickText(branding.companyName, locale)} className="hidden h-8 w-auto min-w-0 object-contain dark:block" />
                )}
              </>
            ) : (
              <span className="bg-brand grid size-8 place-items-center rounded-lg text-sm text-white">
                {pickText(branding.companyName, locale).slice(0, 1)}
              </span>
            )}
            {/* With a logo the name is part of the logo: showing it again would repeat it. */}
            {!branding.logoUrl && <span className="hidden sm:inline">{pickText(branding.companyName, locale)}</span>}
          </Link>
          {areas.length > 1 && (
            <AreaMenu
              className="md:hidden"
              label={t("chooseArea")}
              current={area}
              areas={areas.map((a) => ({ key: a.key, href: a.href, label: t(a.key) }))}
            />
          )}
          <nav className="hidden items-center gap-1 overflow-x-auto md:flex" aria-label={t("chooseArea")}>
            {areas.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className={cn(
                  "text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                  area === a.key && "bg-brand/10 text-brand",
                )}
                aria-current={area === a.key ? "page" : undefined}
              >
                {t(a.key)}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <Link
              href="/help"
              title={t("help")}
              aria-label={t("help")}
              className={cn(
                "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-md",
                area === "help" && "bg-muted text-foreground",
              )}
            >
              <BookOpen className="size-4" aria-hidden />
            </Link>
            <ThemeToggle />
            <LanguageSwitcher signedIn compact />
            <Link
              href="/profile"
              title={t("profile")}
              className={cn(
                "hover:bg-muted inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                (area === "profile" || area === "account") && "bg-muted",
              )}
            >
              <UserAvatar user={{ ...auth.user, avatarVersion: auth.user.avatarVersion ?? null }} size="sm" />
              <span className="hidden max-w-40 truncate md:inline">
                {pickText(auth.user.displayName, locale, auth.user.email)}
              </span>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {sidebar}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export async function Forbidden() {
  const t = await getTranslations("common");
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <ShieldAlert className="text-muted-foreground mx-auto size-12" aria-hidden />
      <h1 className="mt-4 text-xl font-bold">{t("forbidden")}</h1>
      <p className="text-muted-foreground mt-2">{t("forbiddenBody")}</p>
      <Link href="/" className="text-brand mt-6 inline-block underline underline-offset-4">
        {t("goHome")}
      </Link>
    </div>
  );
}
