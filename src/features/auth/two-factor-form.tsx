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

export function TwoFactorForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/totp/verify", { body: { code } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "unauthorized") return router.replace("/login");
      setError(err instanceof ApiError && err.code === "rate_limited" ? t("rateLimited") : t("invalidCode"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="code">{t("code")}</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={10}
          required
          autoFocus
          className="tabular h-12 text-center text-2xl tracking-[0.4em]"
        />
      </div>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {t("verify")}
      </Button>
    </form>
  );
}
