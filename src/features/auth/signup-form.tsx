"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, LocalizedInput } from "@/components/admin/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { usePasswordErrors } from "./invite-accept-form";

export function SignupForm({ locale }: { locale: string }) {
  const t = useTranslations("signupPage");
  const tAccount = useTranslations("account");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const passwordErrors = usePasswordErrors();
  const [name, setName] = useState<Record<string, string>>({});
  const [needsOrg, setNeedsOrg] = useState(false);
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
      await api("/api/v1/public/signup", {
        body: {
          email: String(form.get("email")),
          phone: form.get("phone") ? String(form.get("phone")) : undefined,
          organization: form.get("organization") ? String(form.get("organization")) : undefined,
          displayName: name,
          password,
          locale,
        },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "organization_required") {
        setNeedsOrg(true);
        setErrors([tAuth("organizationRequired")]);
      } else if (err instanceof ApiError && err.code === "not_found") {
        setErrors([t("disabled")]);
      } else if (err instanceof ApiError && err.code === "rate_limited") {
        setErrors([tAuth("rateLimited")]);
      } else {
        setErrors(passwordErrors(err));
      }
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
      <LocalizedInput id="su-name" label={t("name")} value={name} onChange={setName} required />
      <Field label={t("email")} htmlFor="su-email">
        <Input id="su-email" name="email" type="email" required dir="ltr" autoComplete="username" className="h-11" />
      </Field>
      <Field label={t("phone")} htmlFor="su-phone">
        <Input id="su-phone" name="phone" type="tel" dir="ltr" autoComplete="tel" className="h-11" />
      </Field>
      {needsOrg && (
        <Field label={tAuth("organization")} htmlFor="su-org">
          <Input id="su-org" name="organization" dir="ltr" required className="h-11" />
        </Field>
      )}
      <Field label={t("password")} htmlFor="su-password">
        <Input id="su-password" name="password" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Field label={t("confirm")} htmlFor="su-confirm">
        <Input id="su-confirm" name="confirm" type="password" required autoComplete="new-password" className="h-11" />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {t("submit")}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-brand underline">
          {tAuth("signIn")}
        </Link>
      </p>
    </form>
  );
}
