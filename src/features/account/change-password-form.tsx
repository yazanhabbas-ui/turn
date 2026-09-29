"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const tIssues = useTranslations("passwordIssues");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) return setErrors([t("passwordsDontMatch")]);
    setBusy(true);
    setErrors([]);
    try {
      await api("/api/v1/auth/password", { body: { currentPassword: String(form.get("currentPassword")), newPassword } });
      toast.success(t("passwordChanged"));
      formEl.reset();
    } catch (err) {
      if (err instanceof ApiError && err.code === "weak_password") {
        const issues = (err.details?.issues as string[]) ?? [];
        setErrors(issues.map((i) => tIssues(i as "tooShort", { min: Number(err.details?.minLength ?? 10) })));
      } else if (err instanceof ApiError && err.code === "wrong_password") {
        setErrors([t("wrongPassword")]);
      } else {
        setErrors([String(err instanceof ApiError ? err.code : err)]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-3">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-inside list-disc">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {(["currentPassword", "newPassword", "confirmPassword"] as const).map((name) => (
        <div key={name} className="space-y-1.5">
          <Label htmlFor={name}>{t(name)}</Label>
          <Input
            id={name}
            name={name}
            type="password"
            required
            autoComplete={name === "currentPassword" ? "current-password" : "new-password"}
          />
        </div>
      ))}
      <Button type="submit" disabled={busy}>
        {t("changePassword")}
      </Button>
    </form>
  );
}
