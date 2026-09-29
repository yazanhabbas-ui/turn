"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, LocalizedInput } from "@/components/admin/form";
import { useErrorMessage } from "@/components/admin/use-api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";

/** Shows password-policy issues from a `weak_password` error as a list. */
export function usePasswordErrors() {
  const tIssues = useTranslations("passwordIssues");
  const message = useErrorMessage();
  return (err: unknown): string[] => {
    if (err instanceof ApiError && err.code === "weak_password") {
      return ((err.details?.issues as string[]) ?? []).map((i) =>
        tIssues(i as "tooShort", { min: Number(err.details?.minLength ?? 10) }),
      );
    }
    return [message(err)];
  };
}

export function InviteAcceptForm({
  token,
  email,
  displayName,
}: {
  token: string;
  email: string | null;
  displayName: Record<string, string> | null;
}) {
  const t = useTranslations("invitePage");
  const tAccount = useTranslations("account");
  const router = useRouter();
  const passwordErrors = usePasswordErrors();
  const [name, setName] = useState(displayName ?? {});
  const [mail, setMail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setErrors([tAccount("passwordsDontMatch")]);
    setBusy(true);
    setErrors([]);
    try {
      await api(`/api/v1/public/invites/${token}`, { body: { displayName: name, password, email: email ? undefined : mail } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setErrors(passwordErrors(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
      <Field label={t("email")} htmlFor="inv-email">
        {email ? (
          <Input id="inv-email" value={email} readOnly dir="ltr" />
        ) : (
          <Input
            id="inv-email"
            type="email"
            required
            dir="ltr"
            autoComplete="username"
            value={mail}
            onChange={(e) => setMail(e.target.value)}
          />
        )}
      </Field>
      <LocalizedInput id="inv-name" label={t("name")} value={name} onChange={setName} required />
      <Field label={t("password")} htmlFor="inv-password">
        <Input id="inv-password" name="password" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Field label={t("confirm")} htmlFor="inv-confirm">
        <Input id="inv-confirm" name="confirm" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("resetPage");
  const tAccount = useTranslations("account");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const passwordErrors = usePasswordErrors();
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setErrors([tAccount("passwordsDontMatch")]);
    setBusy(true);
    setErrors([]);
    try {
      await api(`/api/v1/public/password-reset/${token}`, { body: { password } });
      setDone(true);
    } catch (err) {
      setErrors(passwordErrors(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>{t("done")}</AlertDescription>
        </Alert>
        <Button className="h-11 w-full" onClick={() => router.replace("/login")}>
          {tAuth("signIn")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
      <Field label={tAccount("newPassword")} htmlFor="rp-password">
        <Input id="rp-password" name="password" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Field label={tAccount("confirmPassword")} htmlFor="rp-confirm">
        <Input id="rp-confirm" name="confirm" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
