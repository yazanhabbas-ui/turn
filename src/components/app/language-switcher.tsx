"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LOCALE_CODES, LOCALES, type Locale } from "@/i18n/locales";
import { usePathname, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Toggles between UI languages; persists the choice on the user profile when signed in. */
export function LanguageSwitcher({
  signedIn = false,
  compact = false,
  className,
}: {
  signedIn?: boolean;
  /** Icon only on a phone (the app header has no room for the name). */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const next = LOCALE_CODES[(LOCALE_CODES.indexOf(locale) + 1) % LOCALE_CODES.length];

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending}
      aria-label={t("language")}
      lang={next}
      onClick={() =>
        startTransition(async () => {
          if (signedIn) await api("/api/v1/auth/locale", { body: { locale: next } }).catch(() => undefined);
          router.replace(pathname, { locale: next });
          router.refresh();
        })
      }
    >
      <Languages aria-hidden />
      <span className={cn(compact && "max-sm:sr-only")}>{LOCALES[next].label}</span>
    </Button>
  );
}
