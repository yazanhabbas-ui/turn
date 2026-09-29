"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    try {
      setSetup(await api("/api/v1/auth/totp/setup", { body: {} }));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/totp/enable", { body: { code: String(new FormData(e.currentTarget).get("code")) } });
      toast.success(t("twoFactorEnabled"));
      setSetup(null);
      router.refresh();
    } catch {
      setError(tAuth("invalidCode"));
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/totp/disable", { body: { password: String(new FormData(e.currentTarget).get("password")) } });
      toast.success(t("twoFactorDisabled"));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "wrong_password" ? t("wrongPassword") : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <form onSubmit={disable} className="max-w-sm space-y-3">
        <p className="text-status-serving flex items-center gap-2 font-medium">
          <ShieldCheck className="size-5" aria-hidden />
          {t("twoFactorOn")}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="tfa-password">{t("currentPassword")}</Label>
          <Input id="tfa-password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" variant="destructive" disabled={busy}>
          {t("disable2fa")}
        </Button>
      </form>
    );
  }

  if (!setup) {
    return (
      <div className="max-w-md space-y-3">
        <p className="text-muted-foreground text-sm">{t("twoFactorOff")}</p>
        <Button onClick={start} disabled={busy}>
          {t("enable2fa")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="max-w-sm space-y-3">
      <p className="text-sm">{t("scanQr")}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qrDataUrl} alt="" className="size-48 rounded-lg border bg-white p-2" />
      <div className="text-muted-foreground text-xs">
        {t("manualKey")}:{" "}
        <code dir="ltr" className="break-all select-all">
          {setup.secret}
        </code>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tfa-code">{tAuth("code")}</Label>
        <Input
          id="tfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          required
          className="tabular text-center text-lg tracking-widest"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={busy}>
        {tAuth("verify")}
      </Button>
    </form>
  );
}
