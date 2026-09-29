"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: "ok" | "totp_required" }>("/api/v1/auth/login", {
        body: {
          email: String(form.get("email")),
          password: String(form.get("password")),
          organization: form.get("organization") ? String(form.get("organization")) : undefined,
        },
      });
      if (res.status === "totp_required") {
        router.replace(`/login/two-factor?next=${encodeURIComponent(next)}`);
      } else {
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "server_error";
      if (code === "organization_required") setNeedsOrg(true);
      const messages: Record<string, string> = {
        account_locked: t("locked", { minutes: Number(err instanceof ApiError ? (err.details?.minutes ?? 15) : 15) }),
        rate_limited: t("rateLimited"),
        organization_required: t("organizationRequired"),
      };
      setError(messages[code] ?? t("invalidCredentials"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" dir="ltr" required autoFocus className="h-11" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
      </div>
      {needsOrg && (
        <div className="space-y-2">
          <Label htmlFor="organization">{t("organization")}</Label>
          <Input id="organization" name="organization" dir="ltr" className="h-11" />
        </div>
      )}
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {t("signIn")}
      </Button>
    </form>
  );
}
